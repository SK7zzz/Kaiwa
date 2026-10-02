# Kaiwa para Ado — japonés con tu suscripción de ChatGPT

Fork personal de [Kaiwa](https://github.com/yeshsanchez/Kaiwa), con interfaz y ayudas en español, conversación en japonés, situaciones prácticas, palabras guardadas y repaso espaciado. El nivel, los intereses y los objetivos se eligen al entrar y se pueden cambiar en Ajustes. El nivel inicial no presupone que conozcas hiragana, katakana o kanji.

El proveedor predeterminado utiliza el **Codex app-server oficial**, autenticado con tu cuenta de **ChatGPT Pro**. Este recorrido no solicita API keys ni requiere saldo de la API: consume los límites de uso que tenga disponibles tu cuenta. OpenAI documenta el uso de [app-server en aplicaciones locales y de código abierto](https://learn.chatgpt.com/docs/app-server#auth-endpoints) y la [autenticación con ChatGPT](https://learn.chatgpt.com/docs/auth#sign-in-with-chatgpt). Las funciones de API de otros proveedores siguen disponibles como opción independiente en Ajustes.

Las conversaciones y el audio de GPT Live se envían a OpenAI. El perfil, las palabras y el historial de aprendizaje se guardan en la base de datos local. Codex gestiona sus credenciales; Kaiwa no copia ni muestra los tokens.

## Arrancar en tu Mac

Requisitos: Python **3.10 o posterior**, Codex CLI y un navegador actual. Para GPT Live utiliza una CLI compatible con los métodos experimentales de voz; la integración se ha desarrollado con **Codex 0.159.3**. No asumas que una CLI distinta mantiene el mismo contrato experimental.

La adaptación está en la rama `ado/spanish-codex-tutor` de [este fork](https://github.com/SK7zzz/Kaiwa/tree/ado/spanish-codex-tutor). Para descargarla en otro equipo:

```sh
git clone --branch ado/spanish-codex-tutor https://github.com/SK7zzz/Kaiwa.git
cd Kaiwa
```

```sh
codex --version
codex login
codex login status
./setup.sh
./run.sh
```

Si necesitas instalar esa versión de Codex mediante npm:

```sh
npm install -g @openai/codex@0.159.3
```

`codex login status` debe indicar que utilizas **ChatGPT**. Una sesión con API key no habilita este recorrido de suscripción. La app te guiará si falta Codex o el inicio de sesión; en el asistente elige «Mi suscripción de ChatGPT» cuando se muestre. Si ya existe un proveedor funcionando, puedes seleccionar la suscripción en Ajustes → Proveedor.

Abre [http://127.0.0.1:8130](http://127.0.0.1:8130). `run.sh` escucha sólo en el ordenador local. No arranca Ollama ni publica enlaces al móvil por defecto. `setup.sh` prepara el entorno Python y las dependencias sin descargar el modelo de reconocimiento de voz de 466 MB.

Si el Mac resuelve `python3` a Python 3.9 de Apple, el instalador busca otra versión compatible automáticamente. También puedes indicarla:

```sh
KAIWA_PYTHON=/opt/homebrew/bin/python3 ./setup.sh
```

Un `.venv` existente con Python antiguo se conserva y produce un error explícito; renómbralo antes de volver a ejecutar el instalador. No hace falta volver a descargar los datos de aprendizaje.

## Tu recorrido de práctica

1. Elige nombre, nivel N5–N1, intereses y objetivos. N5 es un punto de partida sencillo; no necesitas tener una certificación JLPT.
2. Empieza con conversación libre, una lección, lectura o una situación de la vida real.
3. Pide pistas o traducción al español cuando lo necesites; furigana y romaji se pueden activar.
4. Guarda palabras útiles, repásalas y termina la sesión para obtener su informe en español. El tutor reutiliza tus palabras y errores recientes.

**Conversación por voz** conecta GPT Live mediante WebRTC y la interfaz experimental `thread/realtime` de Codex. Necesita micrófono, audio habilitado, acceso a voz en tu cuenta y una CLI compatible. Las transcripciones disponibles se guardan para el informe. Que el texto o `/api/codex/status` funcione no demuestra por sí solo que la cuenta disponga de voz ni acredita la calidad de pronunciación; verifica una conversación completa. Esta vía puede cambiar con nuevas versiones de Codex.

El diccionario contextual del tutor explica las palabras en español. El diccionario offline JMdict del proyecto original conserva definiciones japonés–inglés y se instala únicamente al optar por los recursos offline.

## Opciones explícitas

```sh
./setup.sh --offline       # whisper.cpp (~466 MB) + JMdict japonés–inglés
./run.sh --offline         # inicia Ollama y motores locales de voz ya instalados
./run.sh --no-browser      # servidor sin abrir el navegador
KAIWA_PORT=8131 ./run.sh    # otro puerto local
```

Para conversaciones completamente locales necesitas instalar Ollama, descargar un modelo y seleccionarlo en Ajustes. La entrada de voz local requiere `whisper-cli` (`brew install whisper-cpp`); VOICEVOX y AivisSpeech son opcionales. El modo `--offline` inicia motores instalados en `vendor/macos-x64/run` y `vendor/aivisspeech-engine/run`. Sus logs quedan en `data/logs/`.

`./run.sh --phone` activa un enlace HTTPS de **Tailscale** expresamente. Requiere Tailscale conectado y la misma cuenta en el móvil. El servidor sigue escuchando en `127.0.0.1`; el enlace permite llegar desde tu red privada de Tailscale. Consulta Ajustes → En tu móvil para el QR. Tailscale conserva la configuración de `serve` en segundo plano: para desactivarla, ejecuta `tailscale serve reset` (o usa el ejecutable de la app Tailscale). La exposición pública y un despliegue alojado requieren un diseño de autenticación separado.

## Verificación E2E y evidencia

La ejecución integrada de la UI renovada pasa **26 E2E**, incluido audio de entrada/salida con transcripciones e informe. Consulta [la revisión de UI/UX, identidad personalizada y evidencia](docs/ui-ux-review.md), con las revisiones de Opus 5.5 en high y los prompts de GPT Image. El [registro anterior de integración](docs/verification.md) conserva sus resultados y límites.

Consulta [tests/e2e/README.md](tests/e2e/README.md) para requisitos y alcance detallados. Necesitas Node.js 22+, Playwright y Chrome, además de Codex con sesión ChatGPT. Usa siempre una **base de datos nueva y aislada** con datos sintéticos; nunca la base personal de `data/kaiwa.db`.

Terminal del servidor de pruebas:

```sh
mkdir -p work/e2e
KAIWA_DB_PATH="$PWD/work/e2e/kaiwa-001.db" .venv/bin/python -m uvicorn server.main:app --host 127.0.0.1 --port 8130
```

En otro terminal, desde la raíz del repo:

```sh
node tests/e2e/run.mjs
```

La prueba de texto usa el proveedor real y consume cuota de tu suscripción. Comprueba onboarding, correcciones/traducción/pistas en español, vocabulario persistente, repaso, informe e historial en escritorio y móvil. Genera informe HTML, resultados JSON, capturas y trazas en `tests/e2e/artifacts/` por defecto. Para repetir, elige un archivo de base de datos nuevo (`kaiwa-002.db`, etc.). Los estados de instalación/login interceptados sólo prueban la UI; los E2E de texto no demuestran funcionamiento de voz. Mantén la evidencia y las bases sintéticas fuera del commit.

Esta guía describe el fork y tiene prioridad sobre los comandos, proveedores predeterminados y afirmaciones de privacidad del README original, conservado a continuación como referencia. Se mantiene la licencia [AGPL-3.0](LICENSE) y la atribución al autor original.

<details>
<summary>Documentación original de Kaiwa — referencia upstream</summary>

<div align="center">

<img src="docs/cover.jpg" alt="Kaiwa! 会話 — Your Private Japanese Conversation Tutor" width="100%">

**Your private Japanese tutor — chat, voice calls, roleplay, corrections, and spaced repetition, running entirely on your own computer.**

[![Release](https://img.shields.io/github/v/release/yeshsanchez/Kaiwa)](https://github.com/yeshsanchez/Kaiwa/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![Local first](https://img.shields.io/badge/AI-100%25%20local%20by%20default-success)

</div>

No subscriptions. No account. Your conversations never leave your machine
(unless *you* plug in a cloud AI key — see [Choose your AI](#choose-your-ai)).

## Get it

### Install (recommended — no terminal)

Download the installer for your OS from the **[latest release](https://github.com/yeshsanchez/Kaiwa/releases/latest)**:

- **macOS** — open **`Kaiwa-macos.dmg`** and drag Kaiwa into Applications.
  (Intel build; runs on Apple Silicon via Rosetta.) First launch needs one
  extra click — see [Opening it the first time on macOS](#opening-it-the-first-time-on-macos).
- **Windows** — run **`Kaiwa-Setup.exe`** and follow the prompts.

Offline speech-to-text (whisper.cpp), VOICEVOX voices, and the JMdict
dictionary are **bundled** — nothing else to download. The only external piece
is the local AI: on first launch an onboarding wizard sets up **Ollama** for
you, checks your hardware, recommends a model that will actually be responsive
on it, and takes ~30s to warm up.

### Opening it the first time on macOS

The Mac app is **ad-hoc signed** (not notarized by Apple), so on first launch
Gatekeeper will refuse to open it — *"Apple cannot check it for malicious
software."* This is normal for a free, independently distributed app. Open it
with any one of these (you only do it once):

- **Right-click (or Control-click) the app → Open**, then click **Open** in the
  dialog. macOS remembers the choice and opens it normally after that.
- Or double-click it, dismiss the warning, then go to **System Settings →
  Privacy & Security**, scroll down, and click **Open Anyway** next to the
  Kaiwa message.
- Or from Terminal, clear the quarantine flag:
  `xattr -dr com.apple.quarantine /Applications/Kaiwa.app`
  (point it at wherever you put the app / .dmg).

### From source (developers)

`git clone` this repo instead (`main` is the stable release; work happens on
short-lived feature branches off it) — then:

**macOS**
```bash
./setup.sh    # venv + dependencies + speech model + dictionary (~600 MB)
./run.sh      # starts everything → http://localhost:8130
```
Voice input additionally needs whisper.cpp: `brew install whisper-cpp`

**Windows** — in PowerShell:
```powershell
.\setup.ps1
.\run.ps1     # → http://localhost:8130
```

This path needs [Ollama](https://ollama.com) installed separately (the free
local AI that powers Kaiwa by default). First launch opens the same onboarding
wizard: it checks your hardware, recommends a responsive model, and warms up in
~30s.

## What it does

| Feature | How |
|---|---|
| 💬 **Free Chat** | Natural conversation with Kaiwa, your AI tutor, at your JLPT level (N5–N1) |
| 📞 **Voice Call** | Real-time spoken conversation — just talk, no typing |
| 🎬 **36 roleplay scenarios** | Ramen shop, job interview, izakaya, kōban, ryokan… |
| 🎭 **Custom roleplay** | Define any scene, any roles |
| 📖 **10 guided lessons** | Structured mini-lessons (greetings → keigo) |
| ✏️ **Live corrections** | Every message checked; mistakes explained in English & remembered — and correctly-used advanced kanji gets praised, not "corrected" |
| 💡 **Hints** | Stuck? Get 3 suggested replies at your level |
| ふ **Furigana / romaji / translation** | Toggle per conversation, tap any word for its meaning |
| 📚 **Dictionary** | JMdict (490k+ entries) — tap words in chat, or search Japanese/English in the Dictionary tab. Fully offline |
| 🃏 **SRS review** | Anki-style spaced repetition — grade buttons show exactly when each word comes back |
| 📝 **Session reports** | Summary, strengths, focus areas — expandable in Progress, savable as PDF |
| 📈 **Progress** | Streaks, minutes practiced, mistake patterns |
| 🧠 **Memory** | Your recent mistakes & words feed back into the tutor's brain |
| 💾 **Backups** | Automatic daily/weekly backups + one-click export/import — moves cleanly between macOS and Windows |

## Choose your AI

Kaiwa works with either:

- **Local AI (default)** — [Ollama](https://ollama.com) running a small model on
  your computer. Free, 100% private, works offline. The first-run wizard checks
  your hardware and recommends a model that will actually be responsive on it.
  Realistic minimum: ~8 GB RAM; a CPU-only machine runs a 4B model at
  conversational (not instant) speed.
- **Cloud AI (optional)** — paste an API key for **Google Gemini** (has a free
  tier), **OpenAI**, or **Anthropic Claude** in Settings. Much faster and
  smarter; your messages go to that provider. Keys are stored only in your
  local database and are never shown to the browser again.

Speech recognition, speech synthesis, the dictionary, and all your data stay
local either way.

### Better voices (optional)

Out of the box Kaiwa speaks with your OS's built-in Japanese voice. For much
nicer voices, download the [VOICEVOX engine](https://github.com/VOICEVOX/voicevox_engine/releases)
(CPU build for your OS) and unzip it into `vendor/` (e.g. `vendor/macos-x64/`
so that `vendor/macos-x64/run` exists). `run.sh` picks it up automatically, and
a voice picker (with preview) appears in Settings. Every VOICEVOX character ×
emotion style (sweet, tsundere, whisper…) shows up there, and the
**Expressiveness** slider in Settings makes any of them swing harder.

### Anime-style voices (optional)

For the most natural, emotional voices, install [AivisSpeech](https://aivis-project.com/)
(free, Windows/macOS) and add character voice models from
[AivisHub](https://hub.aivis-project.com/) inside the app — 60+ free
anime-style voices. Its engine speaks the VOICEVOX API, so Kaiwa detects it
automatically (`run.sh` even starts it for you if installed) and its voices
appear in the same Settings picker. Heads-up: it's a heavier model than
VOICEVOX — on older CPU-only machines each sentence takes a few seconds to
synthesize (cached after the first time). Headless alternative: unzip
[AivisSpeech-Engine](https://github.com/Aivis-Project/AivisSpeech-Engine/releases)
into `vendor/aivisspeech-engine/`.

## Use it on your phone 📱

Your computer does all the AI work; the phone is just a screen. The free
[Tailscale](https://tailscale.com) app connects them securely from anywhere:

1. Install Tailscale on this computer and sign in
2. Install Tailscale on your phone, sign in with the **same account**
3. Restart Kaiwa (`./run.sh`), open **Settings → On your phone**, and scan the QR code
4. On the phone: Share → **Add to Home Screen** → Kaiwa installs like a real app

Why not plain Wi-Fi? Phone browsers block the microphone on insecure HTTP —
Tailscale provides the HTTPS link that makes voice work.

## Your data

Everything lives in one file: `data/kaiwa.db`. In **Settings → Your data** you
can export it, import it on a new machine (macOS ↔ Windows both ways), turn on
automatic daily/weekly backups (kept in `~/Documents/Kaiwa Backups`, last 8
rotated), or reset everything for a fresh start. Tip: point your backups at a
folder inside iCloud Drive/Dropbox and they sync off-machine too.

## Configuration

| Env var | Default | What |
|---|---|---|
| `KAIWA_PORT` | `8130` | Web app port |
| `KAIWA_OLLAMA_URL` | `http://localhost:11434` | Ollama server |

Logs land in `/tmp/ollama.log` and `/tmp/voicevox.log`.

## The stack

FastAPI + SQLite + vanilla JS (no build step). STT: whisper.cpp. TTS: VOICEVOX,
AivisSpeech, macOS `say`, or Windows SAPI. Tokenizer/furigana: fugashi (UniDic).
LLM: Ollama or Gemini/OpenAI/Anthropic over plain HTTP.

## Contributing

Issues and PRs welcome — branch off `main`. If Kaiwa helps your Japanese, a ⭐
helps other learners find it.

## Credits & data licenses

- Dictionary data from [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html)
  (via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)),
  property of the [EDRDG](https://www.edrdg.org/), used under
  [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html)
- [VOICEVOX](https://voicevox.hiroshiba.jp/) — generated audio must be credited
  per each voice library's terms (e.g. `VOICEVOX:四国めたん`)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (MIT),
  [Ollama](https://ollama.com) (MIT)
- Icons: [Lucide](https://lucide.dev) (ISC) ·
  QR: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT)

## License

[AGPL-3.0](LICENSE) — free to use, modify, and share; if you run a modified
version as a service, you must share your changes.

</details>
