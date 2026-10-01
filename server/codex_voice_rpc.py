"""Async JSON-RPC connection owned by one browser voice call."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import shutil
import signal
import tempfile
from typing import Any


class VoiceConnectionError(RuntimeError):
    """An observable connection failure, safe to show in the tutor UI."""


class CodexVoiceConnection:
    def __init__(self) -> None:
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._sequence = 0
        self._process: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._directory: tempfile.TemporaryDirectory[str] | None = None
        self.config: dict[str, Any] = {}

    @property
    def cwd(self) -> str:
        if self._directory is None:
            raise VoiceConnectionError("La conexión de voz aún no está preparada.")
        return self._directory.name

    async def open(self) -> None:
        executable = shutil.which("codex")
        if executable is None:
            raise VoiceConnectionError("Instala Codex e inicia sesión con tu cuenta de ChatGPT.")
        self._directory = tempfile.TemporaryDirectory(prefix="kaiwa-voice-")
        environment = dict(os.environ)
        for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
            environment.pop(key, None)
        self._process = await asyncio.create_subprocess_exec(
            executable, "app-server", "--listen", "stdio://",
            "-c", 'web_search="disabled"', "-c", "features.shell_tool=false",
            "-c", "features.apps=false", "-c", "features.code_mode=false",
            cwd=self.cwd, env=environment, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            limit=2**22, start_new_session=True,
        )
        self._reader = asyncio.create_task(self._read_messages())
        await self.request("initialize", {
            "clientInfo": {"name": "kaiwa_voice", "version": "0.1.0"},
            "capabilities": {"experimentalApi": True},
        })
        await self._send({"method": "initialized"})
        account = await self.request("account/read", {"refreshToken": False})
        if (account.get("account") or {}).get("type") != "chatgpt":
            raise VoiceConnectionError("La voz con tu suscripción necesita iniciar sesión en Codex con ChatGPT.")
        response = await self.request("config/read", {"includeLayers": False})
        self.config = response.get("config") or {}

    async def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self._sequence += 1
        request_id = self._sequence
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._send({"id": request_id, "method": method, "params": params})
            return await asyncio.wait_for(future, timeout=45)
        except TimeoutError as error:
            raise VoiceConnectionError("Codex no respondió a tiempo. Vuelve a conectar la llamada.") from error
        finally:
            self._pending.pop(request_id, None)

    async def _send(self, message: dict[str, Any]) -> None:
        if self._process is None or self._process.stdin is None:
            raise VoiceConnectionError("La conexión con Codex se ha cerrado.")
        self._process.stdin.write((json.dumps(message) + "\n").encode())
        await self._process.stdin.drain()

    async def _read_messages(self) -> None:
        try:
            if self._process is None or self._process.stdout is None:
                return
            while line := await self._process.stdout.readline():
                message = json.loads(line)
                await self._dispatch(message)
        except (ValueError, OSError, VoiceConnectionError):
            self._fail_pending()
        finally:
            self._fail_pending()
            if not self.events.full():
                self.events.put_nowait({"method": "connection/closed"})

    async def _dispatch(self, message: dict[str, Any]) -> None:
        if "id" in message and "method" in message:
            await self._send({"id": message["id"], "error": {
                "code": -32601, "message": "Kaiwa voice does not authorize this tool.",
            }})
            return
        if "id" in message:
            future = self._pending.get(message["id"])
            if future is None or future.done():
                return
            if "error" in message:
                future.set_exception(VoiceConnectionError("Codex rechazó la solicitud de voz. Revisa su versión y tu acceso."))
            else:
                future.set_result(message.get("result") or {})
            return
        if message.get("method", "").startswith("thread/realtime/"):
            await self.events.put(message)

    def _fail_pending(self) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(VoiceConnectionError("Se perdió la conexión con Codex."))

    async def close(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader
        if self._process is not None and self._process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self._process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self._process.pid, signal.SIGKILL)
                await self._process.wait()
        if self._process is not None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self._process.pid, signal.SIGTERM)
        self._fail_pending()
        if self._directory is not None:
            self._directory.cleanup()
