"""Fail-closed, single-user Cloudflare Access policy for hosted Kaiwa."""
import asyncio
import os
import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

ACCESS_VARIABLES = (
    "KAIWA_PUBLIC_ORIGIN", "KAIWA_ACCESS_TEAM_DOMAIN",
    "KAIWA_ACCESS_AUD", "KAIWA_ALLOWED_EMAIL",
)
SAFE_METHODS = frozenset(("GET", "HEAD", "OPTIONS"))
SECURITY_HEADERS = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy": "microphone=(self), camera=(), geolocation=()",
    "content-security-policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    "strict-transport-security": "max-age=31536000",
}


@dataclass(frozen=True)
class AccessConfiguration:
    public_origin: str
    team_domain: str
    audience: str
    allowed_email: str

    @property
    def issuer(self) -> str:
        return f"https://{self.team_domain}"

    @property
    def host(self) -> str:
        return urlparse(self.public_origin).netloc


def configuration_from_environment() -> AccessConfiguration | None:
    mode = os.environ.get("KAIWA_DEPLOYMENT", "local")
    settings = [os.environ.get(name, "").strip() for name in ACCESS_VARIABLES]
    if mode == "local" and not any(settings):
        return None
    if mode != "production" or not all(settings):
        raise RuntimeError("Hosted Kaiwa requires production mode and complete Cloudflare Access settings.")
    configuration = AccessConfiguration(*settings)
    validate_configuration(configuration)
    return configuration


def validate_configuration(configuration: AccessConfiguration) -> None:
    validate_public_origin(configuration.public_origin)
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com", configuration.team_domain):
        raise RuntimeError("KAIWA_ACCESS_TEAM_DOMAIN must be a Cloudflare Access team hostname.")
    if not re.fullmatch(r"[^\s@,]+@[^\s@,]+\.[^\s@,]+", configuration.allowed_email):
        raise RuntimeError("KAIWA_ALLOWED_EMAIL must contain exactly one email address.")
    if len(configuration.audience) > 256 or any(character.isspace() for character in configuration.audience):
        raise RuntimeError("KAIWA_ACCESS_AUD must contain one application audience.")


def validate_public_origin(public_origin: str) -> None:
    origin = urlparse(public_origin)
    if (origin.scheme != "https" or not origin.hostname or origin.username
            or origin.password or origin.port or origin.path or origin.query or origin.fragment):
        raise RuntimeError("KAIWA_PUBLIC_ORIGIN must be an HTTPS origin without a path or port.")


class AccessDenied(Exception):
    """Denial excluding credentials and provider diagnostics."""


class AccessTokenVerifier:
    def __init__(self, configuration: AccessConfiguration):
        # Local development never needs Access or its optional crypto dependency.
        # A hosted process without this package fails before serving requests.
        import jwt

        self.configuration = configuration
        self.keys = jwt.PyJWKClient(
            f"{configuration.issuer}/cdn-cgi/access/certs",
            cache_jwk_set=True, lifespan=300, timeout=5,
        )

    def verify(self, token: str) -> float:
        import jwt

        if not token or len(token) > 16_384:
            raise AccessDenied()
        try:
            if jwt.get_unverified_header(token).get("alg") != "RS256":
                raise AccessDenied()
            key = self.keys.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token, key.key, algorithms=["RS256"],
                audience=self.configuration.audience, issuer=self.configuration.issuer,
                options={"require": ["exp", "iat", "iss", "aud", "email", "type"]},
            )
            if claims["email"] != self.configuration.allowed_email or claims["type"] != "app":
                raise AccessDenied()
            return float(claims["exp"])
        except (jwt.PyJWTError, ValueError, TypeError, KeyError) as error:
            raise AccessDenied() from error


def is_local_healthcheck(scope: Scope, headers: Headers) -> bool:
    if scope["type"] != "http" or scope.get("path") != "/healthz" or scope.get("method") != "GET":
        return False
    client = scope.get("client")
    if not client or client[0] not in ("127.0.0.1", "::1"):
        return False
    return not any(
        name == "forwarded" or name.startswith(("x-forwarded-", "cf-"))
        for name in headers
    )


def validate_request_origin(scope: Scope, headers: Headers, configuration: AccessConfiguration) -> None:
    if headers.get("host", "") != configuration.host:
        raise AccessDenied()
    if any(len(headers.getlist(name)) > 1 for name in ("host", "origin", "cf-access-jwt-assertion")):
        raise AccessDenied()
    requires_origin = scope["type"] == "websocket" or scope.get("method") not in SAFE_METHODS
    if requires_origin and headers.get("origin") != configuration.public_origin:
        raise AccessDenied()
    if requires_origin and headers.get("sec-fetch-site") == "cross-site":
        raise AccessDenied()


async def deny(scope: Scope, receive: Receive, send: Send) -> None:
    if scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": 1008})
        return
    response = JSONResponse({"error": "Acceso no autorizado."}, status_code=403, headers=SECURITY_HEADERS)
    await response(scope, receive, send)


class CloudflareAccessMiddleware:
    def __init__(self, app: ASGIApp, configuration: AccessConfiguration):
        self.app = app
        self.configuration = configuration
        self.verifier = AccessTokenVerifier(configuration)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        if is_local_healthcheck(scope, headers):
            await self.app(scope, receive, send)
            return
        try:
            validate_request_origin(scope, headers, self.configuration)
            expires_at = await run_in_threadpool(self.verifier.verify, headers.get("cf-access-jwt-assertion", ""))
        except AccessDenied:
            await deny(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await self.websocket_until_expiry(scope, receive, send, expires_at)
            return
        await self.app(scope, receive, self.secure_send(send))

    async def websocket_until_expiry(self, scope: Scope, receive: Receive, send: Send, expires_at: float) -> None:
        closed = False

        async def send_until_expiry(message: Message) -> None:
            nonlocal closed
            if message["type"] == "websocket.close":
                closed = True
                if time.time() >= expires_at:
                    message = {**message, "code": 1008}
            await send(message)

        try:
            async with asyncio.timeout(max(0, expires_at - time.time())):
                await self.app(scope, receive, send_until_expiry)
        except TimeoutError:
            if not closed:
                await send({"type": "websocket.close", "code": 1008})

    @staticmethod
    def secure_send(send: Send) -> Send:
        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(name, value) for name, value in message.get("headers", [])
                           if name.decode("latin-1").lower() not in SECURITY_HEADERS]
                headers.extend((name.encode(), value.encode()) for name, value in SECURITY_HEADERS.items())
                message = {**message, "headers": headers}
            await send(message)
        return send_with_headers
