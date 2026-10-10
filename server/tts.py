"""Japanese speech from VOICEVOX-compatible engines or native macOS voices.

Engine URLs and cache location are deployment settings, never browser input.
Linux deployments provide VOICEVOX; missing speech is an explicit error.
"""
import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("KAIWA_TTS_CACHE_PATH", os.path.join(ROOT, "data", "tts_cache"))
ENGINES = {
    "vv": ("VOICEVOX", os.environ.get("KAIWA_VOICEVOX_URL", "http://localhost:50021").rstrip("/")),
    "aivis": ("AivisSpeech", os.environ.get("KAIWA_AIVIS_URL", "http://localhost:10101").rstrip("/")),
}
PREFERRED_VV_STYLES = [8, 2, 3, 13, 14]
LOGGER = logging.getLogger(__name__)


class SpeechUnavailableError(RuntimeError):
    """The configured speech engine cannot produce usable audio."""


def engine_up(prefix: str) -> bool:
    try:
        response = requests.get(f"{ENGINES[prefix][1]}/version", timeout=2)
        response.raise_for_status()
        return True
    except requests.RequestException:
        return False


def voicevox_up() -> bool:
    return engine_up("vv")


def _clean(text: str) -> str:
    text = re.sub(r"[*_#`~>|]", "", text)
    text = re.sub(r"[😀-🿿🀀-🯿☀-➿✀-➿]", "", text)
    return text.strip()


def _engine_voices(prefix: str) -> list[dict[str, str]]:
    label, base = ENGINES[prefix]
    try:
        response = requests.get(f"{base}/speakers", timeout=5)
        response.raise_for_status()
        speakers = response.json()
        return [
            {"id": f"{prefix}:{style['id']}", "label": f"{speaker['name']}({style['name']})", "engine": label}
            for speaker in speakers for style in speaker["styles"]
        ]
    except (requests.RequestException, ValueError, KeyError, TypeError):
        LOGGER.debug("Speech catalogue unavailable: %s", label)
        return []


def _macos_voices() -> list[dict[str, str]]:
    if not shutil.which("say") or not shutil.which("afconvert"):
        return []
    try:
        response = subprocess.run(["say", "-v", "?"], capture_output=True, text=True,
                                  timeout=10, check=True)
    except (subprocess.SubprocessError, OSError):
        LOGGER.warning("Native Japanese speech catalogue unavailable")
        return []
    return [
        {"id": f"say:{line.split()[0]}", "label": line.split()[0], "engine": "macOS"}
        for line in response.stdout.splitlines() if "ja_JP" in line
    ]


def list_voices() -> list[dict[str, str]]:
    voices = [voice for prefix in ENGINES for voice in _engine_voices(prefix)]
    return voices + _macos_voices()


def default_voice() -> str:
    voices = list_voices()
    available_ids = {voice["id"] for voice in voices}
    for style_id in PREFERRED_VV_STYLES:
        if f"vv:{style_id}" in available_ids:
            return f"vv:{style_id}"
    return voices[0]["id"] if voices else ""


def _resolve_voice(voice: str) -> str:
    # A migrated Mac profile may still contain say:Kyoko. Pick the server's
    # Japanese engine, while retaining explicit failures for selected engines.
    native_available = shutil.which("say") and shutil.which("afconvert")
    if not voice or (voice.startswith("say:") and not native_available):
        voice = default_voice()
    if not voice:
        raise SpeechUnavailableError("La lectura en japonés no está disponible. Revisa el motor de voz y reintenta.")
    if not re.fullmatch(r"(?:vv|aivis):[0-9]+|say:[A-Za-z][A-Za-z0-9 _-]*", voice):
        raise ValueError("Selecciona una voz válida en Ajustes.")
    return voice


def synthesize(text: str, voice: str, speed: float = 1.0, intonation: float = 1.0) -> bytes:
    text = _clean(text)
    if not text:
        raise ValueError("Escribe una frase para escucharla.")
    if not 0.4 <= speed <= 2.0 or not 0.0 <= intonation <= 2.0:
        raise ValueError("La velocidad o la expresividad están fuera del rango permitido.")
    voice = _resolve_voice(voice)
    key_source = f"{voice}|{speed}|{text}" if intonation == 1.0 else f"{voice}|{speed}|{intonation}|{text}"
    cache_path = os.path.join(CACHE, hashlib.sha1(key_source.encode()).hexdigest() + ".wav")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as cached:
            return cached.read()
    try:
        wav = (_say(text, voice[4:], speed) if voice.startswith("say:")
               else _vv_engine(text, voice, speed, intonation))
    except (requests.RequestException, subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError) as error:
        LOGGER.warning("Speech synthesis failed for %s (%s)", voice, type(error).__name__)
        raise SpeechUnavailableError("No se pudo generar la voz japonesa. Revisa el motor de voz y reintenta.") from error
    if len(wav) < 44 or not wav.startswith(b"RIFF") or wav[8:12] != b"WAVE":
        raise SpeechUnavailableError("El motor de voz no devolvió un audio válido. Reintenta.")
    _cache_audio(cache_path, wav)
    return wav


def _cache_audio(cache_path: str, wav: bytes) -> None:
    temporary_path = None
    try:
        os.makedirs(CACHE, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=CACHE, suffix=".tmp", delete=False) as temporary:
            temporary_path = temporary.name
            temporary.write(wav)
        os.replace(temporary_path, cache_path)
    except OSError:
        # Caching is optional: preserve actual playback when storage is full.
        LOGGER.warning("Could not cache synthesized speech")
    finally:
        if temporary_path and os.path.exists(temporary_path):
            try:
                os.unlink(temporary_path)
            except OSError:
                LOGGER.warning("Could not remove temporary speech cache file")


def _vv_engine(text: str, voice: str, speed: float, intonation: float) -> bytes:
    prefix, style = voice.split(":", 1)
    base = ENGINES[prefix][1]
    query_response = requests.post(f"{base}/audio_query", params={"text": text, "speaker": int(style)}, timeout=30)
    query_response.raise_for_status()
    query = query_response.json()
    query["speedScale"] = speed
    query["intonationScale"] = intonation
    response = requests.post(f"{base}/synthesis", params={"speaker": int(style)}, json=query, timeout=120)
    response.raise_for_status()
    return response.content


def _say(text: str, name: str, speed: float) -> bytes:
    rate = int(180 * speed)
    with tempfile.TemporaryDirectory() as directory:
        aiff = os.path.join(directory, "speech.aiff")
        wav = os.path.join(directory, "speech.wav")
        subprocess.run(["say", "-v", name, "-r", str(rate), "-o", aiff, text], check=True, timeout=60)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@22050", aiff, wav], check=True, timeout=60)
        with open(wav, "rb") as audio:
            return audio.read()
