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

El recorrido `voice.spec.mjs` usa GPT Live real con la cuenta ChatGPT autenticada. Sólo el dispositivo de entrada es sintético: el archivo contiene «こんにちは。私はアドです。ラーメンが好きです。», generado por macOS Kyoko, con 12 segundos de silencio inicial para negociar la conexión y 10 segundos al terminar. No se sustituyen el proveedor, la transcripción, los mensajes ni el resumen.

Generación reproducible del WAV en un directorio **fuera del repo**:

```sh
node tests/e2e/speech-fixture.mjs /ruta/absoluta/work/voice-input
```

El helper ejecuta `/usr/bin/say` y `/usr/bin/afconvert`, convierte a PCM mono de 16 bits/48 kHz y escribe `speech.wav` junto a `speech.json` con texto y condiciones exactas. Requiere macOS y la voz Kyoko instalada. Chrome recibe `--use-file-for-fake-audio-capture=.../speech.wav%noloop`; la opción `%noloop` impide repetir la intervención. [Implementación oficial de Chromium](https://chromium.googlesource.com/chromium/src/+/main/media/audio/fake_audio_input_stream.cc).

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

```sh
node tests/e2e/run.mjs ui.spec.mjs
```

`ui.spec.mjs` verifica la aplicación servida, el catálogo real y la carga real del logo/ilustración. Combina búsqueda con categorías, comprueba filtrado de lecciones y recuperación de resultados vacíos, abre las opciones de escena/historia con teclado y valida Tab/Shift+Tab, Escape y devolución del foco. Recorre las seis pantallas con `aria-current`, edita y guarda el perfil desde Ajustes y conserva el onboarding al pulsar Escape.

Este recorrido **intercepta en el navegador** `/api/profile` y `/api/settings` para representar un perfil sintético editable, `/api/vocab`, `/api/srs/due` y `/api/dashboard` para mostrar colecciones vacías, y los metadatos de `/api/backup/status` y `/api/setup/phone` para evitar incluir rutas/hosts personales en las capturas. Los recorridos de catálogo/navegación bloquean y cuentan `/api/sessions`, exigiendo cero intentos. Catálogo, archivos de imagen, HTML/CSS/JavaScript y las demás consultas de lectura siguen siendo reales. No acredita persistencia backend ni conexión desde un teléfono: esos límites no se sustituyen por los mocks.

Tres negativos adicionales comprueban que Ajustes no muestre éxito después de un PUT 503 y permita reintentar conservando el formulario, que vocabulario presente un GET 503 con acción de recuperación, y que Enter durante la composición japonesa (`isComposing` o código 229) conserve el texto sin enviarlo. Este último recorrido sustituye `/api/sessions`, `/api/chat` mediante SSE y `/api/correct` con una conversación sintética: confirma la lógica de los eventos y un envío posterior con Enter normal; no demuestra un IME nativo ni respuestas/persistencia reales del tutor.

Los recorridos de recuperación representan además una sesión/SSE/informe sintéticos y consultas de palabra/diccionario para comprobar sesión POST 503, pistas 503, guardar vocabulario 503 en popup/informe/diccionario y sus reintentos. Todas las mutaciones y llamadas de aprendizaje se interceptan, sin crear sesiones reales ni consumir IA. Verifican estados y acciones del cliente; la integración/persistencia sigue cubierta por los recorridos reales. Otros dos controles verifican Escape en el informe terminado y la conservación del borrador de Ajustes al navegar, con selecciones `aria-pressed` y guardado global. La lectura real en `modes.spec.mjs` exige ocultar el formulario en la última página y mostrar una sola acción para finalizar.

La evidencia incluye capturas de escritorio y de las seis pantallas a **320 y 390 px**, un diálogo móvil, Progreso con informe/barras sintéticas a 320 px, errores JavaScript y payloads sintéticos de guardado. Los adjuntos `ui-layout-metrics` y `ui-populated-layout-metrics` registran ancho del viewport/documento, ancho visible/total de `#main` y vista visible por pantalla; exigen ausencia de desbordamiento horizontal de la página y de su contenedor principal. Las capturas se acompañan de acciones y comprobaciones de foco, navegación y formularios. Se ejecuta también en la suite completa sobre la base aislada nueva usada por los recorridos reales.
