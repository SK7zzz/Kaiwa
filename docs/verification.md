# Verificación de la adaptación personal

Fecha: 2 de octubre de 2026, Asia/Seoul. macOS, Python 3.12.14, Codex CLI 0.159.3 con sesión ChatGPT, Chrome y Playwright 1.62.1. Proveedor de texto `gpt-6-luna`; voz experimental GPT Live v3 por WebRTC.

## Resultado integrado

**11 E2E pasan**, sin reintentos automáticos y con una base nueva aislada. Las conversaciones, correcciones, traducciones, pistas y resúmenes se generaron mediante Codex real con la suscripción. La entrada de micrófono usa una frase japonesa sintetizada con Kyoko; la conexión, transcripción, respuesta hablada y persistencia son reales.

Comandos de la ejecución final, desde la raíz del repo:

```sh
KAIWA_DB_PATH=/Users/ado/Documents/Codex/2026-09-25/hay/work/e2e/kaiwa-003.db ./run.sh --no-browser
KAIWA_E2E_VOICE_FIXTURE_DIR=/Users/ado/Documents/Codex/2026-09-25/hay/work/voice-final node tests/e2e/run.mjs
```

En otro equipo sustituir esas rutas por directorios de prueba locales y seguir [el procedimiento](../tests/e2e/README.md). Nunca usar ni borrar la base personal para repetir pruebas.

Cobertura comprobada:

- Onboarding español, perfil/nivel persistentes y estados vacíos.
- Conversación japonesa transmitida, error de pasado corregido en español, traducción y pista utilizable.
- Guardar y deduplicar vocabulario, revelar tarjeta y modificar su vencimiento real.
- Informe, historial y navegación en móvil sin desbordamiento horizontal.
- Escena de ramen y lección de saludos con turno, traducción e informe.
- Lectura hiragana completa: título separado, saltos persistidos, tres respuestas, navegación y cierre.
- Voz en ambos sentidos: bytes/energía RTP, transcripción del alumno, respuesta posterior, silencio, subtítulos y resumen. El cliente espera `session.started` antes de iniciar el tutor.
- Negativos HTTP reales; representación y recuperación de CLI/login ausentes; permiso de micrófono denegado; errores de corrección/informe y cierre durante creación retrasada. Los estados de CLI/login, permiso y HTTP 503 de los negativos se simulan expresamente; los proveedores del resto de recorridos son reales.

Evidencia local, excluida del commit:

- `tests/e2e/artifacts/report/index.html`: informe con pasos y adjuntos.
- `tests/e2e/artifacts/result.json`: resultado estructurado.
- `tests/e2e/artifacts/results/`: trazas, capturas desktop/móvil y resultados pedagógicos.
- Adjuntos `voice-evidence` y `voice-diagnostics`: intervención sintética, métricas y secuencia temporal, sin SDP ni credenciales.

## Incidencias y límites

Se corrigió un fallo del lector que eliminaba saltos al convertir a hiragana y pegaba título/cuerpo. Se reprodujo mediante E2E antes de corregirlo; la ejecución final verifica texto persistido y presentación.

Una pasada anterior conectó voz pero no produjo transcripciones. La investigación mostró que el saludo se enviaba antes del aviso `session.started`; se corrigió ese orden y se añadió una aserción temporal. La causa exacta de aquel fallo no quedó demostrada; el registro anterior se conserva localmente en `work/e2e/pre-ready-artifacts`, fuera del repo. La suite integrada final pasa con diagnósticos activados. La voz sigue siendo experimental y su reconocimiento puede confundir palabras.

No se evaluaron pronunciación humana, ruido ambiental, interrupciones frecuentes ni el micrófono de un móvil físico. La revisión móvil usa emulación de iPhone 13 en Chrome. Tampoco se activó Tailscale ni se probaron proveedores/recursos offline, instaladores o despliegue. JMdict offline conserva definiciones japonés–inglés.

## Controles adicionales

Pasan los seis contratos de fallos del proveedor, escritos antes de implementarlo, la compilación Python, sintaxis JavaScript, `bash -n`, `pip check` y `git diff --check`. También se ejecutaron `./setup.sh` y el arranque real `./run.sh --no-browser`.

AnyIO se declara como dependencia directa `>=4.1` porque la cancelación del streaming usa `abandon_on_cancel`, incorporado con ese nombre en [AnyIO 4.1](https://anyio.readthedocs.io/en/latest/versionhistory.html). Los controles estáticos no sustituyen los E2E anteriores.
