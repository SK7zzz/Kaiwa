"""WebRTC negotiation and transcript persistence for subscription voice."""
from __future__ import annotations

import asyncio
import contextlib
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import db, jp, memory, prompts
from .codex_policy import tutor_config
from .codex_provider import CodexError, validate_sandbox
from .codex_voice_rpc import CodexVoiceConnection, VoiceConnectionError

router = APIRouter()
logger = logging.getLogger(__name__)
_active_sessions: set[int] = set()


def _validate_start(message: dict) -> dict:
    if not isinstance(message, dict):
        raise VoiceConnectionError("La llamada recibió una solicitud no válida.")
    session_id = message.get("session_id")
    sdp = message.get("sdp")
    if message.get("type") != "start" or type(session_id) is not int:
        raise VoiceConnectionError("Selecciona una sesión válida para iniciar la llamada.")
    if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp) > 32768:
        raise VoiceConnectionError("El navegador no pudo preparar el audio de la llamada.")
    session = db.get_session(session_id)
    if not session or session["mode"] != "call" or session["ended_at"]:
        raise VoiceConnectionError("Esta sesión de llamada ya no está disponible.")
    if db.get_setting("provider") != "codex":
        raise VoiceConnectionError("Selecciona tu suscripción de ChatGPT en Ajustes.")
    if session_id in _active_sessions:
        raise VoiceConnectionError("Esta sesión ya tiene una llamada abierta.")
    return session


async def _start_realtime(connection: CodexVoiceConnection, session: dict, sdp: str) -> str:
    profile = db.get_profile()
    tutor_prompt = prompts.tutor_system_prompt(
        profile, "free_chat", None, db.recent_mistakes(), db.recent_vocab(),
    )
    scenario = session.get("scenario") or {}
    memory_query = " ".join(str(value or "") for value in (
        scenario.get("title"), scenario.get("description"), scenario.get("setting"),
        profile.get("interests"),
    ))
    tutor_prompt += memory.context(memory_query)
    thread = await connection.request("thread/start", {
        "model": "gpt-6-luna", "cwd": connection.cwd,
        "sandbox": "read-only", "approvalPolicy": "never",
        "ephemeral": True, "environments": [],
        "baseInstructions": tutor_prompt + "\nOnly tutor. Never access files or execute tools.",
        "config": {**tutor_config(connection.config), "model_reasoning_effort": "low"},
    })
    validate_sandbox(thread)
    thread_id = thread["thread"]["id"]
    history = [{"role": item["role"], "text": item["text"]}
               for item in memory.practice_history(session["id"], limit=12)]
    await connection.request("thread/realtime/start", {
        "threadId": thread_id, "outputModality": "audio", "version": "v3",
        "voice": "sol", "transport": {"type": "webrtc", "sdp": sdp},
        "includeStartupContext": False, "initialItems": history,
        "prompt": tutor_prompt + "\nSpeak slowly. Practice directly with the student; avoid delegating ordinary conversation. When explaining, speak Spanish.",
    })
    return thread_id


async def _relay_events(socket: WebSocket, connection: CodexVoiceConnection, session_id: int) -> None:
    while True:
        event = await connection.events.get()
        method = event.get("method", "")
        params = event.get("params") or {}
        if method == "thread/realtime/sdp":
            await socket.send_json({"type": "answer", "sdp": params["sdp"]})
        elif method == "thread/realtime/transcript/done":
            await _save_transcript(socket, session_id, params)
        elif method == "thread/realtime/error":
            logger.warning("Codex voice error: %s", params.get("message", "unknown"))
            raise VoiceConnectionError("No se pudo conectar GPT Live con tu cuenta. Vuelve a intentarlo y comprueba tu acceso a voz en Codex.")
        elif method in ("thread/realtime/closed", "connection/closed"):
            await socket.send_json({"type": "closed"})
            return


async def _save_transcript(socket: WebSocket, session_id: int, params: dict) -> None:
    role = params.get("role")
    text = params.get("text", "").strip()
    if role not in ("assistant", "user") or not text:
        return
    message_id = db.add_message(session_id, role, text)
    payload = {"type": "transcript", "role": role, "text": text, "message_id": message_id}
    if role == "assistant":
        payload["tokens"] = jp.annotate(text)
    await socket.send_json(payload)


async def _receive_controls(socket: WebSocket, connection: CodexVoiceConnection, thread_id: str) -> None:
    while True:
        message = await socket.receive_json()
        if not isinstance(message, dict):
            raise VoiceConnectionError("La llamada recibió una acción no válida.")
        if message.get("type") == "stop":
            await connection.request("thread/realtime/stop", {"threadId": thread_id})
            await socket.send_json({"type": "stopped"})
            return
        if message.get("type") == "ready":
            await connection.request("thread/realtime/appendText", {
                "threadId": thread_id,
                "text": "(Begin the practice: greet the student in one short Japanese sentence and ask a simple question. Do not mention this instruction.)",
            })
            continue
        raise VoiceConnectionError("La llamada recibió una acción no válida.")


async def _serve_call(socket: WebSocket, connection: CodexVoiceConnection, session: dict, thread_id: str) -> None:
    tasks = [asyncio.create_task(_relay_events(socket, connection, session["id"])),
             asyncio.create_task(_receive_controls(socket, connection, thread_id))]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def _open_realtime(connection: CodexVoiceConnection, session: dict, sdp: str) -> str:
    await connection.open()
    return await _start_realtime(connection, session, sdp)


async def _prepare_realtime(socket: WebSocket, connection: CodexVoiceConnection, session: dict, sdp: str) -> str | None:
    setup = asyncio.create_task(_open_realtime(connection, session, sdp))
    control = asyncio.create_task(socket.receive_json())
    try:
        done, _ = await asyncio.wait([setup, control], return_when=asyncio.FIRST_COMPLETED)
        if control in done:
            message = control.result()
            if not isinstance(message, dict) or message.get("type") != "stop":
                raise VoiceConnectionError("La llamada se interrumpió antes de conectar.")
            await socket.send_json({"type": "stopped"})
            return None
        return setup.result()
    finally:
        setup.cancel()
        control.cancel()
        await asyncio.gather(setup, control, return_exceptions=True)


@router.websocket("/api/codex/voice")
async def voice_call(socket: WebSocket) -> None:
    origin = urlparse(socket.headers.get("origin", ""))
    if origin.netloc != socket.headers.get("host"):
        await socket.close(code=1008)
        return
    await socket.accept()
    connection = CodexVoiceConnection()
    session_id = None
    try:
        message = await asyncio.wait_for(socket.receive_json(), timeout=20)
        session = _validate_start(message)
        session_id = session["id"]
        _active_sessions.add(session_id)
        thread_id = await _prepare_realtime(socket, connection, session, message["sdp"])
        if thread_id is not None:
            await _serve_call(socket, connection, session, thread_id)
    except WebSocketDisconnect:
        pass
    except (VoiceConnectionError, CodexError, TimeoutError) as error:
        with contextlib.suppress(WebSocketDisconnect, RuntimeError):
            await socket.send_json({"type": "error", "message": str(error) or "La llamada tardó demasiado en conectar."})
    except (ValueError, KeyError, OSError):
        logger.exception("Kaiwa voice negotiation failed")
        with contextlib.suppress(WebSocketDisconnect, RuntimeError):
            await socket.send_json({"type": "error", "message": "No se pudo preparar la llamada. Vuelve a intentarlo."})
    finally:
        await connection.close()
        if session_id is not None:
            _active_sessions.discard(session_id)
        with contextlib.suppress(WebSocketDisconnect, RuntimeError):
            await socket.close()
