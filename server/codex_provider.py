"""ChatGPT subscription adapter through the official local Codex app-server.

Only login status and the documented JSON-RPC protocol are used. Credentials stay
inside Codex. Every inference uses a disposable directory and ephemeral thread.
"""
import json
import os
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
from threading import Event
from collections import deque
from collections.abc import Iterator
from typing import TypedDict

from .codex_policy import tutor_config


DEFAULT_MODEL = 'gpt-6-luna'
REQUEST_TIMEOUT_SECONDS = 180


class CodexStatus(TypedDict):
    ready: bool
    installed: bool
    logged_in: bool
    message: str


class CodexError(RuntimeError):
    """User-facing failure without provider diagnostics or credentials."""


def status() -> CodexStatus:
    executable = shutil.which('codex')
    if not executable:
        return {'ready': False, 'installed': False, 'logged_in': False,
                'message': 'Instala Codex CLI y ejecuta codex login con tu cuenta ChatGPT.'}
    try:
        result = subprocess.run([executable, 'login', 'status'], capture_output=True,
                                text=True, timeout=8, env=_environment())
    except (OSError, subprocess.TimeoutExpired):
        return {'ready': False, 'installed': True, 'logged_in': False,
                'message': 'Codex no responde. Comprueba codex login status en Terminal.'}
    logged_in = result.returncode == 0 and 'using ChatGPT' in result.stdout + result.stderr
    return {'ready': logged_in, 'installed': True, 'logged_in': logged_in,
            'message': 'Conectado a tu suscripción de ChatGPT mediante Codex.' if logged_in else
                       'Ejecuta codex login e inicia sesión con ChatGPT para usar tu suscripción.'}


def _environment() -> dict[str, str]:
    # An inherited API key must never change subscription requests into API billing.
    environment = os.environ.copy()
    for name in ('OPENAI_API_KEY', 'CODEX_API_KEY'):
        environment.pop(name, None)
    return environment


def parse_json_object(content: str) -> dict:
    try:
        value = json.loads(content)
    except json.JSONDecodeError as error:
        raise CodexError('Codex devolvió JSON inválido. Vuelve a intentarlo.') from error
    if not isinstance(value, dict):
        raise CodexError('Codex devolvió un formato inesperado. Se esperaba un objeto JSON.')
    return value


def validate_sandbox(thread: dict) -> None:
    sandbox = thread.get('sandbox') or {}
    if sandbox.get('type') != 'readOnly' or sandbox.get('networkAccess', False):
        raise CodexError('Codex no aplicó el entorno de solo lectura requerido por el tutor.')


class AppServer:
    """One stdio transport; its owner always closes it, including cancellation."""

    def __init__(self, cwd: str, cancellation: Event | None = None):
        executable = shutil.which('codex')
        if not executable:
            raise CodexError('Codex CLI no está instalado. Instálalo y ejecuta codex login.')
        self.cwd = cwd
        self.cancellation = cancellation
        self.process = subprocess.Popen(
            [executable, 'app-server', '--listen', 'stdio://'], cwd=cwd,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=_environment(), bufsize=0, start_new_session=True,
        )
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = b''
        self.deadline = time.monotonic() + REQUEST_TIMEOUT_SECONDS
        self.request_id = 0
        self.thread_id = None
        self.turn_id = None
        self.config = {}
        self.pending_events = deque()

    def send(self, message: dict) -> None:
        try:
            self.process.stdin.write((json.dumps(message) + '\n').encode())
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise CodexError('Se perdió la conexión con Codex. Vuelve a intentarlo.') from error

    def receive(self) -> dict:
        while b'\n' not in self.buffer:
            if self.cancellation is not None and self.cancellation.is_set():
                raise CodexError('Conversación cancelada.')
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise CodexError('Codex agotó el tiempo de respuesta. Vuelve a intentarlo.')
            if not self.selector.select(min(remaining, 0.5)):
                continue
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise CodexError('Codex se cerró antes de terminar. Comprueba tu inicio de sesión.')
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b'\n', 1)
        try:
            message = json.loads(line)
        except json.JSONDecodeError as error:
            raise CodexError('Codex devolvió una respuesta de protocolo inválida.') from error
        if not isinstance(message, dict):
            raise CodexError('Codex devolvió una respuesta de protocolo inesperada.')
        return message

    def request(self, method: str, params: dict) -> dict:
        self.request_id += 1
        request_id = self.request_id
        self.send({'id': request_id, 'method': method, 'params': params})
        while True:
            message = self.receive()
            if message.get('id') == request_id:
                if 'error' in message:
                    raise CodexError(_error_message(message['error']))
                return message.get('result') or {}
            self.reject_server_request(message)
            if message.get("method", "").startswith(("item/", "turn/", "error")):
                self.pending_events.append(message)

    def reject_server_request(self, message: dict) -> None:
        if 'id' in message and 'method' in message:
            self.send({'id': message['id'], 'error': {'code': -32601,
                      'message': 'Kaiwa does not authorize tools or external actions.'}})

    def initialize(self) -> None:
        self.request('initialize', {'clientInfo': {'name': 'kaiwa_tutor',
                     'title': 'Kaiwa Japanese Tutor', 'version': '0.1.0'}})
        self.send({'method': 'initialized'})
        account = self.request('account/read', {'refreshToken': False}).get('account') or {}
        if account.get('type') != 'chatgpt':
            raise CodexError('Inicia sesión en Codex con ChatGPT para usar tu suscripción.')
        self.config = self.request('config/read', {'includeLayers': False}).get('config') or {}

    def start(self, messages: list[dict], model: str) -> None:
        system = '\n\n'.join(m['content'] for m in messages if m['role'] == 'system')
        thread = self.request('thread/start', {
            'model': model, 'cwd': self.cwd,
            'approvalPolicy': 'never', 'sandbox': 'read-only', 'ephemeral': True,
            'baseInstructions': 'You are Kaiwa, a Japanese conversation tutor. '
                                'Answer directly. Never call tools or perform external actions.',
            'developerInstructions': system, 'config': tutor_config(self.config),
        })
        validate_sandbox(thread)
        self.thread_id = thread['thread']['id']
        conversation = [{'role': m['role'], 'content': m['content']}
                        for m in messages if m['role'] != 'system']
        turn = self.request('turn/start', {
            'threadId': self.thread_id, 'effort': 'low',
            'approvalPolicy': 'never',
            'sandboxPolicy': {'type': 'readOnly', 'networkAccess': False},
            'input': [{'type': 'text', 'text': 'Conversation history as JSON. '
                       'Reply to the last learner turn only:\n' + json.dumps(conversation,
                       ensure_ascii=False)}],
        })
        self.turn_id = turn['turn']['id']

    def deltas(self) -> Iterator[str]:
        while True:
            event = self.pending_events.popleft() if self.pending_events else self.receive()
            self.reject_server_request(event)
            method = event.get('method')
            params = event.get('params') or {}
            if method == 'item/agentMessage/delta' and params.get('delta'):
                yield params['delta']
            elif method == 'turn/completed':
                turn = params.get('turn') or {}
                self.turn_id = None
                if turn.get('status') != 'completed':
                    raise CodexError(_error_message(turn.get('error') or {}))
                return
            elif method == 'error' and not params.get('willRetry'):
                raise CodexError(_error_message(params.get('error') or {}))

    def close(self) -> None:
        if self.process.poll() is None:
            if self.thread_id and self.turn_id:
                try:
                    self.send({'id': self.request_id + 1, 'method': 'turn/interrupt',
                               'params': {'threadId': self.thread_id, 'turnId': self.turn_id}})
                except CodexError:
                    pass  # Process termination below is the fallback cancellation.
            _signal_process_group(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                _signal_process_group(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=3)
        # npm installs use a Node launcher: the app-server can outlive its parent.
        _signal_process_group(self.process.pid, signal.SIGTERM)
        self.selector.close()
        self.process.stdin.close()
        self.process.stdout.close()


def _signal_process_group(process_id: int, signal_number: int) -> None:
    try:
        os.killpg(process_id, signal_number)
    except ProcessLookupError:
        pass  # The process and its children have already exited.


def _error_message(error: dict) -> str:
    message = str(error.get('message', '')).lower()
    if any(word in message for word in ('usage limit', 'rate limit', 'quota', '429')):
        return 'Has alcanzado un límite de tu suscripción. Espera al reinicio y vuelve a intentarlo.'
    if any(word in message for word in ('auth', 'login', '401', '403')):
        return 'Codex no pudo autenticar tu cuenta. Ejecuta codex login de nuevo.'
    return 'Codex no pudo completar la respuesta. Comprueba tu conexión y vuelve a intentarlo.'


def chat_stream(messages: list[dict], model: str, cancellation: Event | None = None) -> Iterator[str]:
    with tempfile.TemporaryDirectory(prefix='kaiwa-codex-') as workspace:
        transport = AppServer(workspace, cancellation)
        try:
            transport.initialize()
            transport.start(messages, model)
            yield from transport.deltas()
        finally:
            transport.close()


def chat_json(prompt: str, model: str) -> dict:
    messages = [{'role': 'system', 'content': 'Return only one valid JSON object. '
                 'No Markdown fences, commentary, tools, or code execution.'},
                {'role': 'user', 'content': prompt}]
    return parse_json_object(''.join(chat_stream(messages, model)))
