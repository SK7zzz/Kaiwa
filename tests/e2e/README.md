# E2E de Kaiwa personalizado

Antes de escribir los tests se enumeraron los riesgos en `FAILURE-MODES.md`. El recorrido principal verifica la integración real con Codex; no reemplaza las respuestas del tutor. Consume cuota de la suscripción y utiliza exclusivamente perfil/conversación sintéticos.

## Condiciones

- Node.js >= 22 y Playwright 1.62.1 con Google Chrome instalado (canal predeterminado `chrome`; usa `KAIWA_E2E_CHANNEL=chromium` para el Chromium de Playwright). El launcher resuelve primero una instalación local de Playwright y después el runtime incluido con Codex. En otro equipo establece `KAIWA_PLAYWRIGHT_ROOT` al directorio `node_modules` que contiene Playwright.
- Codex CLI instalado y sesión ChatGPT iniciada; el endpoint `/api/health` debe devolver `provider: "codex"` y `llm_ready: true`.
- Servidor con **base de datos aislada y nueva**: `KAIWA_DB_PATH` debe apuntar a un archivo de pruebas fuera de `data/kaiwa.db`. El recorrido rechaza nombres/perfiles ya creados para proteger datos reales. Antes de repetir el recorrido, arranca con otra base nueva.
- El primer perfil del servidor debe estar vacío; la prueba crea `Ado E2E`, N5, intereses ficticios y un objetivo marcado expresamente como sintético.
- El autoplay de audio se desactiva para el recorrido de texto. Los controles de voz se documentan en su recorrido independiente; estas pruebas de texto no acreditan GPT Live, acceso al micrófono ni calidad de pronunciación.

## Ejecución repetible

Desde la raíz del repo, con el servidor dedicado en `127.0.0.1:8130`:

```sh
KAIWA_DB_PATH=/ruta/absoluta/work/e2e/kaiwa-001.db .venv/bin/python -m uvicorn server.main:app --host 127.0.0.1 --port 8130
```

En otro terminal:

```sh
node tests/e2e/run.mjs
```

Cambiar servidor o ubicación de la evidencia:

```sh
KAIWA_E2E_BASE_URL=http://127.0.0.1:8130 KAIWA_E2E_ARTIFACTS=/ruta/absoluta/evidencia node tests/e2e/run.mjs
```

La base aislada se debe renovar también después de un fallo parcial: el onboarding ya puede haber creado el perfil y el test rechazará reutilizarlo. Nunca renueves ni borres `data/kaiwa.db` para repetir las pruebas.

No se ejecutan tests en paralelo ni se reintenta una operación de IA automáticamente. Los timeouts largos permiten arranque/frío de Codex sin añadir esperas arbitrarias.

## Qué comprueba

1. Desktop: onboarding en español, perfil N5 persistente, estados vacíos, saludo japonés transmitido por el proveedor real, error gramatical corregido en español, traducción y sugerencia utilizable.
2. Palabra guardada desde el texto: lectura/significado, persistencia, deduplicación, tarjeta oculta/revelada y nueva fecha de repaso tras calificar.
3. Resumen real, registro del historial y lectura/navegación del mismo contenido en móvil sin desbordamiento horizontal.
4. Negativos HTTP reales: sesión/mensaje inexistentes devuelven 404 con un error explícito.
5. Estados móviles de Codex ausente y sin login: se intercepta **sólo el estado** en el navegador, se bloquea continuar y se verifica recuperar la conexión. Esto demuestra presentación/acciones de UI; no acredita que la CLI haya fallado realmente.
6. Escena de ramen y lección de saludos: respuesta, traducción e informe reales. Lectura hiragana: título separado, saltos persistidos, tres preguntas respondidas, navegación y cierre con informe.
7. Recuperación de errores: se simulan respuestas HTTP 503 de corrección/informe y se comprueba que no haya una felicitación falsa ni pérdida de sesión; al reintentar, el informe lo genera Codex real. Colgar durante una creación retrasada cierra la sesión sin reabrir recursos.
8. GPT Live real: intervención japonesa sintética por micrófono, respuesta hablada, transcripciones persistidas, audio en ambos sentidos, silencio, subtítulos y cierre. Condiciones detalladas abajo.

## Evidencia

- `artifacts/report/index.html`: informe navegable con pasos y adjuntos.
- `artifacts/result.json`: resultado estructurado.
- `artifacts/results/`: `trace.zip` generado automáticamente por Playwright Test, con los contextos desktop/móvil del recorrido, y capturas de estados relevantes. El runner inicia y exporta las trazas; los tests no llaman a `context.tracing.start()` sobre esos contextos administrados.
- `synthetic-learning-results`: corrección, traducción, sugerencias y resumen reales para comprobar idioma y utilidad pedagógica.

Abrir una traza usando el mismo runtime de Playwright:

```sh
node /ruta/node_modules/playwright/cli.js show-trace /ruta/evidencia/results/test/trace.zip
```

Las trazas contienen tráfico HTTP y texto sintético; no se deben ejecutar contra la base/perfil real ni subir credenciales, bases SQLite o directorios de sesión de Codex. El test no lee archivos de autenticación.

## Voz experimental: una intervención hablada real

El recorrido `voice.spec.mjs` usa GPT Live real con la cuenta ChatGPT autenticada. Sólo el dispositivo de entrada es sintético: el archivo contiene «こんにちは。私はアドです。ラーメンが好きです。», generado por macOS Kyoko o por un motor japonés como VOICEVOX, con 12 segundos de silencio inicial para negociar la conexión y 10 segundos al terminar. No se sustituyen el proveedor, la transcripción, los mensajes ni el resumen.

Generación reproducible del WAV en un directorio **fuera del repo**:

```sh
node tests/e2e/speech-fixture.mjs /ruta/absoluta/work/voice-input
```

Sin una fuente externa, el helper ejecuta `/usr/bin/say` y `/usr/bin/afconvert`; ese flujo requiere macOS y Kyoko. También admite `KAIWA_E2E_VOICE_SOURCE_WAV` para leer un WAV ya generado en PCM mono de 16 bits/48 kHz, sin ejecutar utilidades macOS. Ambos flujos validan el audio antes de añadir silencio y escriben `speech.wav` junto a `speech.json` con texto, formato, duración de la fuente, RMS y hashes SHA-256 de fuente/salida. Chrome recibe `--use-file-for-fake-audio-capture=.../speech.wav%noloop`; la opción `%noloop` impide repetir la intervención. [Implementación oficial de Chromium](https://chromium.googlesource.com/chromium/src/+/main/media/audio/fake_audio_input_stream.cc).

Para Linux, generar fuera del repo una fuente con **la frase japonesa exacta
indicada arriba**, nunca una grabación personal ni el WAV ya rellenado con
silencio. Ejemplo con el motor privado de la instancia TTS de prueba descrita
más abajo (la red del motor no publica puertos):

```sh
mkdir -p /ruta/absoluta/work/voice-input
docker exec -i kaiwa-tts-e2e python - <<'PYVOICE' > /ruta/absoluta/work/voice-input/voicevox-source.wav
import json
import sys
import urllib.parse
import urllib.request

base = "http://voicevox:50021"
params = urllib.parse.urlencode({"text": "こんにちは。私はアドです。ラーメンが好きです。", "speaker": 8})
with urllib.request.urlopen(base + "/audio_query?" + params, data=b"", timeout=30) as response:
    query = json.load(response)
query.update(outputSamplingRate=48000, outputStereo=False, speedScale=0.85)
request = urllib.request.Request(
    base + "/synthesis?speaker=8", data=json.dumps(query).encode(),
    headers={"Content-Type": "application/json"}, method="POST",
)
with urllib.request.urlopen(request, timeout=120) as response:
    sys.stdout.buffer.write(response.read())
PYVOICE
KAIWA_E2E_VOICE_SOURCE_WAV=/ruta/absoluta/work/voice-input/voicevox-source.wav \
node tests/e2e/speech-fixture.mjs /ruta/absoluta/work/voice-input/fixture
```

El helper exige RIFF/WAVE completo, PCM lineal mono de 16 bits a 48000 Hz,
muestras completas, **más de un segundo** de fuente y RMS positivo. Rechaza
silencio, datos vacíos, formato incompatible y archivos truncados, aunque el
sintetizador/conversor haya terminado con código 0. Añade después 12 segundos
iniciales y 10 finales; los 22 segundos de silencio por sí solos nunca pasan
como una intervención válida. El hash identifica los bytes utilizados, pero no
verifica qué palabras dice un WAV externo: quien genera la fuente debe usar la
frase indicada. Conservar el comando y el motor/voz usados como evidencia.

Antes de modificar este helper se enumeraron esos fallos y se escribió
`speech-fixture.test.mjs`: el contrato positivo falló con el comportamiento
anterior y después pasan diez controles aislados. Usan PCM sintético para
verificar formato, rechazo de fuentes inválidas, padding e identidad; **no son
pruebas de GPT Live ni de pronunciación**.

```sh
node --test tests/e2e/speech-fixture.test.mjs
```

Al ejecutar `voice.spec.mjs` en Linux, conservar también
`KAIWA_E2E_VOICE_SOURCE_WAV=/ruta/absoluta/work/voice-input/voicevox-source.wav`
en el entorno del runner: el test regenera su fixture antes de abrir el navegador.
No basta con generar `speech.wav` manualmente y omitir la variable.

Con el servidor dedicado ya iniciado y el perfil sintético creado por el recorrido principal (el test comprueba nombre `Ado E2E`, objetivo marcado `Datos sintéticos E2E` y proveedor `codex` antes de abrir la página):

```sh
KAIWA_E2E_VOICE_FIXTURE_DIR=/ruta/absoluta/work/voice-input KAIWA_E2E_ARTIFACTS=/ruta/absoluta/work/voice-input/artifacts node tests/e2e/run.mjs voice.spec.mjs
```

El test regenera el WAV antes de lanzar Chrome y exige:

- Conexión WebRTC establecida, bytes RTP transmitidos y recibidos, y energía positiva de las muestras de micrófono y del audio remoto.
- Transcripción japonesa `user` persistida y relacionada con la frase conocida; respuesta `assistant` posterior dentro de la misma sesión.
- Mute después de completar la intervención, cambio de estado real de la pista, subtítulos activados/desactivados y cierre con historial y resumen.
- Negativo independiente de micrófono denegado: exclusivamente se inyecta `NotAllowedError` en `getUserMedia`. Comprueba mensaje, cierre y ausencia de sesión creada; no comprueba la ventana de permisos nativa de macOS.

La evidencia `voice-evidence` incluye la especificación del audio sintético, las métricas RTP y el historial. La conexión de voz de Codex es experimental: estas pruebas demuestran su funcionamiento con esta cuenta/versión/fecha, sin convertirlo en garantía de disponibilidad futura ni en evaluación de pronunciación humana.

## Diagnóstico de fallos de voz

Cada test de voz adjunta `voice-diagnostics` también cuando falla. Incluye el hash y condiciones del WAV, tiempos de solicitud/disponibilidad del micrófono, cambios de ICE/conexión, tipos de eventos del canal de datos, tipos/roles y tiempos de frames WebSocket, y muestras RTP/energía cada segundo. No contiene SDP, payloads del canal, credenciales ni direcciones del proveedor. Si la llamada sigue activa al fallar, añade su historial sintético y estado de pistas.

La instrumentación observa las APIs reales; no cambia audio, conexión, proveedor ni respuestas. Permite distinguir una captura vacía, negociación lenta, falta de eventos/transcripción o persistencia incompleta antes de aumentar tiempos o alterar la prueba. Los timestamps del navegador y del runner conservan su instante inicial para correlacionarlos. Una repetición satisfactoria aislada no borra un fallo observado en la suite integrada ni demuestra su causa.

## Revisión visual y UX sin llamadas al tutor

### Tema Amadeus: preparado antes de implementar la UI

`amadeus.spec.mjs` añade cinco recorridos para los riesgos 52–57: las siete vistas a 1440/390/320 px, assets reales de Kurisu, contraste de texto/inputs/placeholders, fondo oscuro y acento ámbar visible, japonés con furigana y nombres latinos con espacios, compositor utilizable, carga/error 503/recuperación vacía, preferencia de movimiento reducido y foco de diálogos/voz. Los contratos de imagen usan `img.amadeus-portrait` en Inicio, Asistente y `#call-avatar`, con alternativa textual y carga real. Las comprobaciones usan acciones y geometría/colores computados; no dependen de una captura CSS fija ni de los textos editoriales del tema anterior.

La nueva suite intercepta perfil, ajustes, salud, proveedores, voces, memoria, asistente, dashboard y vocabulario con datos sintéticos. Sesión, streaming y corrección del recorrido de japonés son sintéticos; toda otra mutación se bloquea. Para inspeccionar la llamada se deja pendiente exclusivamente `getUserMedia`, sin obtener micrófono, crear sesión, abrir WebRTC o consumir IA. Esto prueba representación/acciones del cliente; no sustituye la integración real con Codex ni acredita voz real. El cálculo de contraste compone fondos CSS sólidos y alfas: no certifica todas las posiciones de imágenes/gradientes.

Ejecutar junto con los **15 E2E existentes de `ui.spec.mjs`**, que comprueban búsquedas, formularios, borradores/guardado de Ajustes, recuperación de errores, diálogos, IME y navegación. Ambos archivos suman 20 tests y no consumen cuota de IA. Usar un servidor dedicado con una base nueva, nunca el perfil personal ni el despliegue de producción:

```sh
KAIWA_DB_PATH=/ruta/absoluta/work/amadeus/synthetic-001.db \
.venv/bin/python -m uvicorn server.main:app --host 127.0.0.1 --port 18145

KAIWA_E2E_BASE_URL=http://127.0.0.1:18145 \
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/work/amadeus/ui \
node tests/e2e/run.mjs ui.spec.mjs amadeus.spec.mjs
```

En Linux especificar `KAIWA_PLAYWRIGHT_ROOT` y `KAIWA_E2E_CHANNEL=chromium` cuando el runtime no esté en la ruta Mac predeterminada. El directorio `work/amadeus/ui`, fuera del repo, recoge informe HTML, resultados JSON, trazas y capturas. Los nuevos adjuntos conservan ratios de contraste, colores efectivos, tipografía, geometría de vistas/controles/retratos, animaciones activas y mutaciones sintéticas observadas. Abrir las capturas/trazas para complementar las comprobaciones automáticas.

**Estado de preparación:** sintaxis y listado de los 20 tests comprobados; los E2E de Amadeus todavía no se han ejecutado sobre una implementación. Su resultado no se declara verde hasta que el tema esté integrado y exista un servidor de pruebas accesible. `personal.spec.mjs`, `kaiwa.spec.mjs`, `modes.spec.mjs` y `voice.spec.mjs` siguen disponibles para la regresión funcional real posterior; requieren su perfil/base sintéticos y algunos consumen cuota, por lo que no forman parte de este comando visual sin IA.

### UI E2E en GitHub Actions y Linux

`.github/workflows/ui-e2e.yml` ejecuta esos 20 E2E después de pushes a `ado/spanish-codex-tutor`, en pull requests y de forma manual. Usa Ubuntu 24.04, Python 3.12, Node 24, `requirements.lock` y Playwright 1.62.1 con Chromium instalado en el directorio temporal del runner. No instala ni autentica Codex, no necesita secretos y sólo concede `contents: read`. Los jobs anteriores de la misma rama/PR se cancelan; el límite total es de 15 minutos.

`ci-run.mjs` arranca Uvicorn en loopback 18145 con una SQLite nueva dentro de `mkdtemp`, limpia configuración de despliegue/proveedores heredada y elimina API keys del entorno del proceso aislado. Usa **`KAIWA_DEPLOYMENT=local`**, el modo local admitido por `server/security.py`; `development` no es un valor admitido. Rechaza un puerto ocupado, espera `/healthz` con un límite de 60 segundos y verifica que el perfil esté vacío antes de ejecutar exclusivamente `ui.spec.mjs` y `amadeus.spec.mjs`. Devuelve el código de Playwright, falla ante errores/cancelación, termina sus grupos de procesos y elimina sólo su directorio temporal. No abre ni borra `data/kaiwa.db`.

Repetición con un runtime Playwright ya instalado en Linux (también sirve macOS cuando permita iniciar el servidor):

```sh
KAIWA_E2E_PYTHON=python \
KAIWA_PLAYWRIGHT_ROOT=/ruta/absoluta/runtime/node_modules \
KAIWA_E2E_CHANNEL=chromium \
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/work/amadeus/ci-001 \
node tests/e2e/ci-run.mjs
```

Requiere instalar primero `requirements.lock` y `playwright@1.62.1`, y ejecutar `npx --no-install playwright install chromium --with-deps` desde el directorio donde se instaló Playwright. Si Chromium se instaló con `PLAYWRIGHT_BROWSERS_PATH` personalizado, conservar esa variable al lanzar el runner. El script usa grupos POSIX y rechaza Windows explícitamente.

El artefacto de Actions conserva durante siete días `report/`, `results/` (trazas/capturas), `result.json`, `server.log` y `run.json`, incluso cuando los E2E fallan. La SQLite y la configuración quedan fuera del upload; `run.json` registra condiciones, tiempos, estado y código de salida sin valores de autenticación. Un fallo anterior a la instalación/arranque puede no producir informe de Playwright y debe revisarse en el log del job. La sintaxis y el listado locales no acreditan CI: confirmar el resultado del job y abrir su artefacto antes de declarar estos E2E verificados.

```sh
node tests/e2e/run.mjs ui.spec.mjs
```

`ui.spec.mjs` verifica la aplicación servida, el catálogo real y la carga real del logo/ilustración. Combina búsqueda con categorías, comprueba filtrado de lecciones y recuperación de resultados vacíos, abre las opciones de escena/historia con teclado y valida Tab/Shift+Tab, Escape y devolución del foco. Recorre las seis pantallas con `aria-current`, edita y guarda el perfil desde Ajustes y conserva el onboarding al pulsar Escape.

Este recorrido **intercepta en el navegador** `/api/profile` y `/api/settings` para representar un perfil sintético editable, `/api/vocab`, `/api/srs/due` y `/api/dashboard` para mostrar colecciones vacías, y los metadatos de `/api/backup/status` y `/api/setup/phone` para evitar incluir rutas/hosts personales en las capturas. Los recorridos de catálogo/navegación bloquean y cuentan `/api/sessions`, exigiendo cero intentos. Catálogo, archivos de imagen, HTML/CSS/JavaScript y las demás consultas de lectura siguen siendo reales. No acredita persistencia backend ni conexión desde un teléfono: esos límites no se sustituyen por los mocks.

Tres negativos adicionales comprueban que Ajustes no muestre éxito después de un PUT 503 y permita reintentar conservando el formulario, que vocabulario presente un GET 503 con acción de recuperación, y que Enter durante la composición japonesa (`isComposing` o código 229) conserve el texto sin enviarlo. Este último recorrido sustituye `/api/sessions`, `/api/chat` mediante SSE y `/api/correct` con una conversación sintética: confirma la lógica de los eventos y un envío posterior con Enter normal; no demuestra un IME nativo ni respuestas/persistencia reales del tutor.

Los recorridos de recuperación representan además una sesión/SSE/informe sintéticos y consultas de palabra/diccionario para comprobar sesión POST 503, pistas 503, guardar vocabulario 503 en popup/informe/diccionario y sus reintentos. Todas las mutaciones y llamadas de aprendizaje se interceptan, sin crear sesiones reales ni consumir IA. Verifican estados y acciones del cliente; la integración/persistencia sigue cubierta por los recorridos reales. Otros dos controles verifican Escape en el informe terminado y la conservación del borrador de Ajustes al navegar, con selecciones `aria-pressed` y guardado global. La lectura real en `modes.spec.mjs` exige ocultar el formulario en la última página y mostrar una sola acción para finalizar.

La evidencia incluye capturas de escritorio y de las seis pantallas a **320 y 390 px**, un diálogo móvil, Progreso con informe/barras sintéticas a 320 px, errores JavaScript y payloads sintéticos de guardado. Los adjuntos `ui-layout-metrics` y `ui-populated-layout-metrics` registran ancho del viewport/documento, ancho visible/total de `#main` y vista visible por pantalla; exigen ausencia de desbordamiento horizontal de la página y de su contenedor principal. Las capturas se acompañan de acciones y comprobaciones de foco, navegación y formularios. Se ejecuta también en la suite completa sobre la base aislada nueva usada por los recorridos reales.

## Asistente personal, memoria y práctica por tema

`personal.spec.mjs` fue escrito después de enumerar los fallos 35–42 y antes de implementar los handlers. En la suite completa se ejecuta después de los recorridos de onboarding y lectura. Su primera prueba exige perfil `Ado E2E`, objetivo `Datos sintéticos E2E`, autoplay desactivado, proveedor Codex preparado y memoria inicialmente vacía. **No ejecutarlo contra la base personal**: crea y modifica exclusivamente recuerdos ficticios en SQLite y consume cuota para conversaciones, prácticas e informes reales.

Ejecución independiente tras crear el perfil sintético con el primer recorrido, en una base aislada cuya memoria todavía esté vacía:

```sh
node tests/e2e/run.mjs kaiwa.spec.mjs
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/work/personal-e2e node tests/e2e/run.mjs personal.spec.mjs
```

El recorrido comprueba guardar, recargar, editar y olvidar un plan manual, incluida la cancelación de la confirmación. El asistente real aprende la banda ficticia «Nebula Prisma E2E», recupera su nombre después de recargar y pasa esa preferencia a una lección de música cuyo tema no repite el nombre. El preset de peluquería inicia una escena real y el de música una lección; los presets rellenan el formulario sin iniciar automáticamente. Ambos se completan con respuestas e informes reales. Una profesión explícitamente inventada dentro del roleplay no se convierte en memoria personal.

Después de esas prácticas, el recorrido cambia la banda a «Nebula Coral E2E» y exige que el asistente real use sólo el dato vigente. Al olvidar esa memoria, exige una respuesta sin ninguno de los dos nombres y ausencia del recuerdo en la API. Esto verifica que conservar el historial no vuelve a inyectar el dato olvidado en el contexto; no acredita borrado del historial ni de los backups históricos.

Los negativos de validación y referencias inexistentes usan HTTP reales y exigen un historial intacto. El control 503 **intercepta POST `/api/companion` y el GET del navegador posterior al éxito simulado**: primero devuelve un error y luego una respuesta e historial sintéticos de recuperación. Exige conservar el texto, permitir reintentar, no inventar éxito y no modificar el historial del servidor; acredita la recuperación del cliente, no una caída real de Codex. Los dos controles móviles usan memoria sintética extensa a 320/390 px, la séptima opción de navegación y un tema vacío: no deben crear una sesión ni desbordar el documento o `#main`. Exigen al menos 44 px de altura en los campos de tema/modo/categoría y desplazan la vista hasta Editar/Olvidar para comprobar que las acciones quedan dentro del viewport.

La evidencia `personal-real-learning-results` incluye respuestas reales, memoria extraída, diálogos, mensajes e informes sintéticos. Las capturas `personal-assistant-memory-recalled`, `personal-memory-persisted`, `personal-hairdresser-practice` y `personal-music-lesson-memory` permiten revisar el contexto; `personal-mobile-layout` deja las medidas de ancho reproducibles. El runner conserva informe HTML, resultados JSON y trazas como en los demás recorridos. Si el recorrido real falla parcialmente, renovar la base aislada antes de repetirlo; no borrar datos personales para volver a dejar la memoria vacía.

El sexto control verifica los endpoints reales de exportación/importación. Conserva un snapshot original en memoria, crea un recuerdo sintético y exporta un snapshot moderno, modifica el recuerdo y restaura para comparar exactamente memoria e historial. Con el Python de `.venv` y SQLite transforma sólo una copia temporal fuera del repo: elimina las tres tablas nuevas (`personal_memories`, `companion_messages`, `memory_context_state`), verifica integridad e importa esa copia como backup antiguo. Exige memoria y asistente vacíos y permite guardar un recuerdo nuevo después de la migración. En `finally` restaura el snapshot original, verifica ambas colecciones y elimina los ficheros temporales, incluso si falla una comprobación.

Los bytes de backup se transfieren mediante `fetch` nativo de Node, fuera del contexto trazado de Playwright, y **no se adjuntan ni se guardan en el repo**. La evidencia `personal-backup-migration-evidence` contiene sólo tamaños/hashes de snapshots sintéticos, nombres de tablas y resultados de las comprobaciones. El control requiere que el historial sintético del asistente ya exista, por lo que se ejecuta con `personal.spec.mjs` completo o tras su primer recorrido; no consume IA adicional.

## Seguridad del origen para despliegue

Los riesgos 45–50 y `deploy-security.spec.mjs` se escribieron antes del middleware de producción. El launcher exige Python con las dependencias del proyecto, Node >=22, Playwright y OpenSSL; no necesita iniciar sesión en Codex ni llama a un modelo.

```sh
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/evidencia-seguridad node tests/e2e/deploy-security-run.mjs
```

`deploy-security-run.mjs` crea una SQLite vacía y arranca Uvicorn en un puerto loopback efímero, con `KAIWA_DEPLOYMENT=production` y el origen HTTPS esperado. **No conecta ni modifica el servidor personal en 8130**. Genera una clave RSA y un certificado TLS sintéticos efímeros. El servidor HTTPS sirve el JWKS; un proxy CONNECT de pruebas transporta la consulta fija a `https://synthetic-team.cloudflareaccess.com/cdn-cgi/access/certs`. El proceso Uvicorn confía sólo en ese certificado durante esta ejecución mediante `SSL_CERT_FILE`. No se añade una URL de claves configurable ni un bypass al código de producción.

Las peticiones HTTP y upgrades WebSocket son reales. `node:http` conserva el Host público al conectar con el puerto loopback aislado; el `fetch` de Node sustituye ese header por el del transporte y no sirve para este recorrido. Los tokens de prueba comprueban firma inventada, algoritmo, emisor, audiencia, correo, expiración, `nbf`, claims ausentes y tipo de token. Se verifican también HTML/assets/docs/API denegados, protección de Host/Origin, liveness local mínimo, configuración incompleta rechazada y handshake autorizado sin enviar SDP. Un token nuevo de tres segundos exige cierre 1008 al expirar. Las operaciones legítimas comprueban memoria, exportación/importación SQLite consistentes y persistencia tras reiniciar el proceso con la misma base. Los backups sólo se transfieren en memoria mediante HTTP de Node y quedan fuera de las trazas. Los adjuntos contienen únicamente nombres de casos, estados HTTP y tamaños/hashes del snapshot sintético; las claves, tokens y SQLite se eliminan al terminar.

Este recorrido acredita el middleware integrado con transporte HTTPS/JWKS real y SQLite. **No acredita Cloudflare Access real, autorización de la cuenta de Google, Docker/volúmenes, audio GPT Live ni un teléfono físico en Rushia**. Esas comprobaciones se realizan sobre el despliegue final y se registran por separado. Para los recorridos reales de aprendizaje en Linux se usa una instancia temporal privada con SQLite nueva accesible sólo mediante un forward SSH; no se desactiva la seguridad del servicio publicado.

Resultado comprobado el **10 de octubre de 2026, Asia/Tokyo**: **7/7 aprobados**, cero reintentos y cero omitidos, en 5,394 segundos. Se ejecutó sobre macOS, Node 24.14.1, Python 3.12.14 y Playwright 1.62.1, con PyJWT 2.15.1, cryptography 50.0.2, cffi 2.1.1 y pycparser 3.11 instalados en `.venv`.

```sh
KAIWA_E2E_ARTIFACTS=/Users/ado/Documents/Codex/2026-09-25/hay/work/deploy-security-2026-10-10-r2 node tests/e2e/deploy-security-run.mjs
```

La evidencia final está en ese directorio: `report/index.html`, `result.json`, trazas `results/` y adjuntos de estados, configuración, cierre 1008 y hash/tamaño del snapshot. La primera pasada (4 aprobados, 3 fallidos) se conserva en `work/deploy-security-2026-10-10`, fuera del repo: el harness usaba `fetch`, que descartaba el Host esperado. Se corrigió el transporte a `node:http` y se repitió la suite completa sobre una SQLite nueva. El control de expiración conecta sin SDP: no acredita todavía la cancelación de un proceso Codex con GPT Live activo ni el audio de esa llamada.

## Lectura japonesa real en Linux

`tts.spec.mjs` necesita el backend Linux construido con el Dockerfile del repo,
VOICEVOX CPU real y Playwright 1.62.1 con su navegador instalado. No requiere
login de Codex y no consume cuota del tutor. **Nunca usar el servidor personal
ni desactivar Access en el servicio publicado para estas pruebas.** Crear una
instancia independiente, volúmenes nuevos y un puerto sólo en loopback, sin
Cloudflare Tunnel. La instancia de producción conserva sus cuatro variables de
Access y su validación JWT.

Ejemplo en Rushia con Docker rootless, desde una copia de este repo. Sustituir
el tag de la app por la imagen construida que se quiere verificar; el motor usa
el digest oficial ya inspeccionado en `.env.example`:

```sh
KAIWA_TTS_APP_IMAGE=kaiwa:local
KAIWA_TTS_VOICEVOX_IMAGE=voicevox/voicevox_engine@sha256:4a9f0f5b3d3ed7438975f2b277cdfb805c6f8d5ed5d7258ac2988abbeae032a0

docker network create kaiwa-tts-e2e-egress
docker network create --internal kaiwa-tts-e2e-speech

docker run -d --name kaiwa-tts-e2e-voicevox \
  --network kaiwa-tts-e2e-speech --network-alias voicevox \
  --user 1000:1000 --entrypoint /opt/voicevox_engine/run \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 4g --cpus 2 --pids-limit 256 \
  "$KAIWA_TTS_VOICEVOX_IMAGE" --host 0.0.0.0

docker run -d --name kaiwa-tts-e2e \
  --network kaiwa-tts-e2e-egress \
  -p 127.0.0.1:18133:8130 \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m,mode=1777 \
  --memory 1g --cpus 2 --pids-limit 256 \
  -e KAIWA_DEPLOYMENT=local \
  -e KAIWA_PUBLIC_ORIGIN= -e KAIWA_ACCESS_TEAM_DOMAIN= \
  -e KAIWA_ACCESS_AUD= -e KAIWA_ALLOWED_EMAIL= \
  -e KAIWA_VOICEVOX_URL=http://voicevox:50021 \
  -v kaiwa-tts-e2e-data:/app/data \
  -v kaiwa-tts-e2e-codex:/home/kaiwa/.codex \
  -v 'kaiwa-tts-e2e-backups:/home/kaiwa/Documents/Kaiwa Backups' \
  "$KAIWA_TTS_APP_IMAGE"

docker network connect kaiwa-tts-e2e-speech kaiwa-tts-e2e
```

No montar la base ni el volumen Codex de producción. Los cuatro ajustes de
Access vacíos son exclusivos de este contenedor nuevo en modo local: un proceso
en modo producción sigue rechazando esa configuración. No publicar ningún
puerto de VOICEVOX. El arranque explícito como UID 1000 evita el `gosu` del
entrypoint original, incompatible con eliminar todas las capacidades; no se
necesita otorgar capacidades al motor.

Esperar a que el proceso del motor haya arrancado. Antes del runner,
`http://127.0.0.1:18133/healthz` debe responder y `/api/voices` debe contener
voces con `engine: "VOICEVOX"`. Un catálogo vacío impide pasar los tests y no
cuenta como éxito. Usar una ruta de evidencia nueva en cada pasada.

Se puede ejecutar el navegador en un equipo cliente con Node/Playwright/Chrome:
abrir primero un forward SSH privado, manteniéndolo durante el recorrido.

```sh
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -N \
  -L 127.0.0.1:18133:127.0.0.1:18133 rushia
```

En otro terminal, desde el repo cliente:

```sh
KAIWA_E2E_TTS=1 \
KAIWA_E2E_BASE_URL=http://127.0.0.1:18133 \
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/evidencia-tts-linux \
node tests/e2e/run.mjs tts.spec.mjs
```

Si el navegador local no puede arrancar, ejecutar el runner directamente en
Rushia. Preparar fuera del repo un runtime de Playwright y el navegador requerido
por **esa misma versión**, además de sus bibliotecas Linux. No basta con tener
una versión distinta de Chromium instalada:

```sh
npm install --prefix /home/ado/.local/share/kaiwa-deploy/e2e-runtime playwright@1.62.1
PLAYWRIGHT_BROWSERS_PATH=/home/ado/.local/share/kaiwa-deploy/browsers \
node /home/ado/.local/share/kaiwa-deploy/e2e-runtime/node_modules/playwright/cli.js install chromium
```

Comando de la pasada final comprobada el **10 de octubre de 2026, Asia/Tokyo**:

```sh
cd /home/ado/.local/share/kaiwa-deploy/source
PLAYWRIGHT_BROWSERS_PATH=/home/ado/.local/share/kaiwa-deploy/browsers \
KAIWA_PLAYWRIGHT_ROOT=/home/ado/.local/share/kaiwa-deploy/e2e-runtime/node_modules \
KAIWA_E2E_CHANNEL=chromium \
KAIWA_E2E_TTS=1 \
KAIWA_E2E_BASE_URL=http://127.0.0.1:18133 \
KAIWA_E2E_ARTIFACTS=/home/ado/.local/share/kaiwa-deploy/evidence/tts-e2e-r3 \
node tests/e2e/run.mjs tts.spec.mjs
```

Pasan **6/6**, cero omitidos y cero reintentos, en **15,832 segundos**:
Node 24.21.0, Python del contenedor 3.12.15, Chromium 151.0.7922.34 y Playwright
1.62.1. Imagen comprobada `kaiwa:local`, ID
`sha256:760c4e02e636eb977ca44d96373965cf47a92305f74b7ab04e21513f00bef703`.

La suite exige WAV real, mayor duración a velocidad 0,7, repetición del audio,
perfil `say:Kyoko` migrado sobre backend que declara Linux, errores 422/503,
reproducción de «Escuchar» y muestra de Ajustes a 1440/390 px, y recuperación
tras un 503 representado en el navegador. La UI usa perfil y vocabulario
sintéticos interceptados; `/api/voices`, `/api/tts`, WAV y reproducción HTMLAudio
siguen siendo reales. El caso 503 del motor usa un estilo inexistente real;
la recuperación de UI sustituye sólo la respuesta fallida. No demuestra una
caída/reinicio del motor, calidad fonética humana ni salida por un altavoz o
móvil físico. Tampoco comprueba GPT Live o Cloudflare real.

El informe incluye WAV, duración/hash, eventos `playing`, capturas de escritorio
y móvil, trazas y resultados JSON. Copia local de la pasada R3, fuera del repo:
`work/deploy/tts-e2e-r3/tts-e2e-r3/report/index.html`. Al terminar, conservar la
evidencia y eliminar únicamente los contenedores, redes y volúmenes de prueba
que se acaban de crear; no usar limpieza global de Docker ni nombres de
producción.

## Autenticación mediante Tailscale Serve y proxy privado

Los fallos se definieron primero en `tailscale-failures.md`. La suite nueva
arranca una aplicación de producción real sobre loopback efímero, SQLite nuevo,
login `owner-e2e@example.invalid` y secreto aleatorio de 256 bits. No usa el
servidor personal ni inicia Codex, GPT Live o ningún modelo.

```sh
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/evidencia-tailscale \
node tests/e2e/tailscale-security-run.mjs
```

Requiere el Python del proyecto con dependencias instaladas; se puede indicar
otro mediante `KAIWA_E2E_PYTHON`. Playwright se resuelve como en los recorridos
anteriores. El runner limpia sus archivos y SQLite temporales al terminar.
Los siete casos verifican denegaciones HTTP y WS para identidad falsificada,
secreto incorrecto, cabeceras duplicadas e identidad ajena; Host, Origin y
CSRF; liveness exclusivamente local; diez configuraciones inválidas; handshake
WS autorizado; y memoria, snapshot/restauración y reinicio reales. El rechazo
de cabeceras Host/Origin duplicadas puede producir 400 antes de ASGI; el
middleware devuelve 403 cuando la petición llega hasta él.

El archivo `KAIWA_PROXY_SECRET_FILE` contiene exactamente 64 caracteres hex
minúsculos (32 bytes), con un salto de línea final opcional. La app exige un
archivo regular sin enlace simbólico y carga el secreto una vez al arrancar.
El proxy debe sobrescribir `X-Kaiwa-Proxy-Secret` y pasar la identidad inyectada
por Tailscale Serve. Sólo permite el login configurado mediante comparación
exacta: no acepta listas, cambio de mayúsculas ni repetición de cabeceras.
El secreto se compara con `hmac.compare_digest`. Su rotación requiere recrear
la app y el proxy con el mismo valor.

Las peticiones de esta suite usan Node HTTP para conservar Host y mantener
credenciales y bytes SQLite fuera de las trazas Playwright. El informe contiene
únicamente resultados de casos, códigos HTTP/WS y tamaño/hash del snapshot;
la base y el secreto no se adjuntan. Las trazas no acreditan un recorrido visual:
estos E2E verifican transporte, autenticación y persistencia del servidor.

Para comprobar que Cloudflare sigue funcionando, ejecutar también su suite
independiente con proveedor explícito:

```sh
KAIWA_AUTH_PROVIDER=cloudflare \
KAIWA_E2E_ARTIFACTS=/ruta/absoluta/evidencia-cloudflare-regresion \
node tests/e2e/deploy-security-run.mjs
```

Esta suite sintética no acredita Tailscale Serve, nginx, TLS, las reglas del
tailnet ni un cliente real. Esas comprobaciones se hacen sobre el despliegue
Linux integrado. El host y los procesos locales capaces de alcanzar el proxy
loopback forman parte de la frontera de confianza. La identidad WS se verifica
al conectar: Tailscale no aporta aquí un JWT con expiración propia de la app.

Comprobado el **11 de octubre de 2026, Asia/Tokyo**, mediante el agente principal:
Tailscale **7/7** en **3,38 s**, Cloudflare **7/7** en **5,23 s**, sin omisiones
ni reintentos. Evidencia fuera de Git:
`work/deploy/tailscale-security-r2/report/index.html` y
`work/deploy/cloudflare-regression-ts-r1/report/index.html` (relativas al workspace,
no a la raíz del repo). La primera pasada Tailscale obtuvo 6/7 por una expectativa
demasiado estricta de 403 ante Origin duplicado WS; el protocolo devuelve 400
antes del middleware. Se corrigió únicamente esa expectativa, manteniendo las
denegaciones y repitiendo los siete casos. Python compila los módulos cambiados;
`node --check` y `git diff --check` pasan.

## Despliegue real: HTTPS, navegador y proveedores sobre Tailscale

`tailscale-live.spec.mjs` contiene **cinco casos**: navegación y contexto seguro
a 1440 px y 390 px (dos casos); memoria creada/editada, cancelación de olvido y
borrado persistente; conversación con Codex real, corrección, SSE, reproducción
WAV e informe persistido; y GPT Live real con WebRTC, audio bidireccional,
transcripción japonesa, mute/subtítulos y cierre con informe.

Ejecutar únicamente **antes de migrar los datos personales**, con el perfil
sintético `Ado E2E`, objetivos que contengan `Datos sintéticos E2E`, proveedor
`codex`, autoplay desactivado y CLI autenticada. Cada caso comprueba esas
condiciones antes de operar. El navegador debe pertenecer al tailnet con la
identidad autorizada: no se falsifican cabeceras Tailscale ni se inyecta el
secreto del proxy en el navegador. TLS se verifica normalmente, sin ignorar
errores de certificado. Los casos Codex y GPT Live consumen cuota real.

Comando en Rushia desde el checkout de verificación, con Node/Playwright y el
Chromium ya instalados en las rutas del recorrido Linux:

```sh
cd /home/ado/.local/share/kaiwa-deploy/source
PLAYWRIGHT_BROWSERS_PATH=/home/ado/.local/share/kaiwa-deploy/browsers \
KAIWA_PLAYWRIGHT_ROOT=/home/ado/.local/share/kaiwa-deploy/e2e-runtime/node_modules \
KAIWA_E2E_CHANNEL=chromium \
KAIWA_E2E_TAILSCALE=1 \
KAIWA_E2E_BASE_URL=https://rushia-1.tail7bb611.ts.net \
KAIWA_E2E_VOICE_SOURCE_WAV=/home/ado/.local/share/kaiwa-deploy/voice-input/source.wav \
KAIWA_E2E_VOICE_FIXTURE_DIR=/home/ado/.local/share/kaiwa-deploy/voice-input/tailscale-fixture \
KAIWA_E2E_ARTIFACTS=/home/ado/.local/share/kaiwa-deploy/evidence/tailscale-live-r3 \
node tests/e2e/run.mjs tailscale-live.spec.mjs --grep 'Memoria|Codex real|GPT Live'
```

Este es el comando de la pasada R3 para los **tres casos afectados**. La pasada
R2 ya comprobó los dos casos de navegación de escritorio/móvil sobre el
commit desplegado `4139ff9`. Para una primera comprobación completa, usar otra
ruta nueva de evidencia y omitir `--grep`; para repetir sólo navegación, usar
`--grep 'HTTPS válido'`. No repetir casos ya satisfactorios sin un cambio o
riesgo nuevo que lo justifique. No ejecutar la suite después de migrar el
perfil personal ni desactivar su guarda para hacerla pasar.

La fuente WAV contiene «こんにちは。私はアドです。ラーメンが好きです。» en PCM mono
16 bits, 48 kHz, **sin padding**. `speech-fixture.mjs` valida formato y energía,
y añade 12 segundos iniciales y 10 finales para negociar la conexión. La fuente
no contiene una grabación personal. Chromium utiliza ese micrófono sintético;
el proveedor, WebRTC y respuestas siguen siendo reales.

El informe conserva capturas, trazas, errores de página, orígenes reales de
las mutaciones (`allHeaders()`), SSE observado mediante un clon sin retrasar
la respuesta de la UI, WAV y sus métricas, corrección, historial/informes y
diagnósticos de voz. Los eventos SSE se comprueban al terminar el stream;
no es una medición de latencia incremental. Las trazas sólo deben conservar
contenido sintético y nunca credenciales o una base de datos personal.
La pasada R3 **pasó 3/3**: memoria en **6,8 s**, conversación Codex con
SSE/corrección/WAV/informe en **27,9 s** y GPT Live en **30,6 s** (suite de
aproximadamente 1,2 minutos). Sumada a los dos casos de escritorio/móvil ya
aprobados en R2, quedan comprobados los **cinco recorridos HTTPS** del
commit desplegado `4139ff9`. Evidencia remota fuera de Git:
`/home/ado/.local/share/kaiwa-deploy/evidence/tailscale-live-r2/report/index.html`
y `/home/ado/.local/share/kaiwa-deploy/evidence/tailscale-live-r3/report/index.html`.
Las correcciones de instrumentación usan `allHeaders()` para observar Origin y
un clon del stream SSE para observarlo sin retrasar a la UI. Después de estas
pasadas se migraron los datos personales: **no volver a ejecutar esta suite
contra la base de producción**.

### Renderer e ingreso reales en Linux

El renderer se verifica como root por su CLI real en directorios temporales
independientes; no modifica la configuración privada de producción:

```sh
cd /home/ado/.local/share/kaiwa-deploy/source
sudo python3 deploy/check-tailscale-renderer.py \
  --evidence-dir /home/ado/.local/share/kaiwa-deploy/evidence/tailscale-renderer
```

Comprueba secreto de 256 bits y permisos/propietarios privados, configuración
con el mismo secreto, reejecución estable, secretos inválidos, symlinks,
propietario ajeno y marcadores de plantilla incorrectos. El informe no conserva
secreto ni configuración renderizada.

El ingreso se verifica **antes de la migración personal**, sobre los servicios
desplegados y el socket Docker del sistema, también como root:

```sh
cd /home/ado/.local/share/kaiwa-deploy/source
sudo python3 deploy/check-tailscale-ingress.py \
  --evidence-dir /home/ado/.local/share/kaiwa-deploy/evidence/tailscale-ingress-runtime-r2
```

La pasada real utilizó la misma herramienta copiada como
`/tmp/kaiwa-check-tailscale-ingress.py`. El **11 de octubre de 2026, Asia/Tokyo**,
pasaron sus **11 comprobaciones**, con evidencia local saneada en
`work/deploy/tailscale-ingress-runtime-r2.json` y copia remota en el directorio
del comando. Comprueba servicios exactos, puertos configurados y efectivos,
restricciones de contenedores, separación de cuatro redes, HTTPS persistente
sin Funnel, perfil por TLS válido, cabeceras falsas sobrescritas por Serve/proxy,
CSRF rechazado sin cambiar el perfil, identidad ausente/ajena rechazada en
loopback, acceso directo a la app sin secreto rechazado y proxy inaccesible
desde la red de salida de la app.

La última comprobación usa un cliente Docker desechable, sin capacidades y con
imagen local fijada por digest; lo elimina al terminar, incluso tras un timeout.
Los errores de herramientas o transporte hacen fallar el control y no cuentan
como denegación segura. El JSON conserva nombres de controles, resultado y
referencias inmutables de imagen, sin cuerpos HTTP, perfil, secretos ni
inspecciones Docker completas. Este control no sustituye los cinco recorridos
de navegador ni demuestra la denegación a otra identidad real del tailnet.

### Descargador SSH compatible con macOS

`deploy/check-pull-backup.py` ejecuta el **script shell real** de descarga con
un endpoint SSH sintético y snapshots SQLite temporales. Los ocho escenarios
se definieron antes de corregir la incompatibilidad de BSD `chmod`: rutas
absolutas con espacios, relativas con espacios y relativas que comienzan por
un guion; salida parcial de SSH seguida de error; cabecera SQLite inválida;
esquema incompleto; snapshot corrupto; y directorio destino que es un symlink.

Ejecutar desde la raíz del repo, en macOS o Linux, sin root ni conexión a
producción, y con evidencia fuera de Git:

```sh
python3 deploy/check-pull-backup.py \
  --evidence-dir /ruta/absoluta/privada/pull-backup-check
```

Los casos válidos exigen un único snapshot publicado, directorio `0700`,
archivo `0600`, integridad correcta y contenido sintético exacto. Los negativos
exigen error explícito, ninguna salida de éxito y ningún archivo publicado o
temporal abandonado. El caso symlink se rechaza antes de intentar SSH. El
endpoint simulado comprueba además los argumentos SSH y el comando remoto;
no se leen claves privadas ni se establece una conexión de red.

El **11 de octubre de 2026, Asia/Tokyo**, la pasada inicial en macOS falló
**7/8** antes de alcanzar la frontera SSH: BSD `chmod` rechaza `--`. La
corrección conserva la protección frente a rutas que parecen opciones mediante
su normalización, y la repetición pasó **8/8**. Evidencia local fuera del repo:
`work/deploy/pull-backup-macos-before/result.json` y
`work/deploy/pull-backup-macos-after/result.json`. Los JSON sólo contienen
plataforma, nombres de casos, resultados y errores saneados.

Esta suite acredita la portabilidad y los fallos del descargador aislado. La
descarga **real** posterior al Mac se comprobó por separado: permisos `0600`,
integridad y comparación exacta de ocho tablas con los datos originales,
incluidos ajustes salvo `backup_last`. Su informe privado saneado está en
`work/deploy/private/offsite-verification-result.json`; no contiene filas
personales ni credenciales. Ninguno de esos dos controles demuestra por sí
solo que un snapshot programado posterior del servidor se haya generado.
