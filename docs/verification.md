# Verificación de la adaptación personal

Fecha: 2 de octubre de 2026, Asia/Seoul. macOS, Python 3.12.14, Codex CLI 0.159.3 con sesión ChatGPT, Chrome y Playwright 1.62.1. Proveedor de texto `gpt-6-luna`; voz experimental GPT Live v3 por WebRTC.

## Actualización: asistente, memoria y práctica por tema

La ejecución integrada del 2 de octubre de 2026 pasa **32 E2E** sin reintentos ni casos omitidos, sobre la base sintética nueva `work/personal-memory/kaiwa-002.db` fuera del repo. Duración: 279 segundos. Mantiene los recorridos anteriores y añade:

- Crear, recargar, editar, cancelar olvido y olvidar memorias mediante UI y API reales.
- Asistente con Codex real: aprender una banda ficticia, recuperarla después de recargar y reutilizarla en una lección de música sin volver a escribir su nombre.
- Peluquería como escena y música como lección, con respuestas e informes completos; los presets sólo rellenan el formulario.
- Editar la banda y usar sólo la versión vigente; olvidarla y no recuperar ninguna versión anterior del historial conservado. Los personajes de práctica no se guardan como hechos personales.
- Errores HTTP de validación y referencias; recuperación del cliente ante un 503 representado, sin mutar el historial real.
- Asistente y memoria extensa a 320/390 px sin desbordamiento horizontal.
- Exportar/restaurar memoria e historial exactos y migrar un snapshot antiguo sin las tablas nuevas. Los bytes SQLite quedan fuera de trazas e informe; la evidencia contiene hashes y comprobaciones.
- Voz real en ambos sentidos con el backend integrado, transcripciones e informe.

Comandos reproducibles desde la raíz; elegir una DB nueva al repetir:

```sh
KAIWA_DB_PATH=/Users/ado/Documents/Codex/2026-09-25/hay/work/personal-memory/kaiwa-002.db .venv/bin/python -m uvicorn server.main:app --host 127.0.0.1 --port 8130
KAIWA_E2E_VOICE_FIXTURE_DIR=/Users/ado/Documents/Codex/2026-09-25/hay/work/ui-review/voice node tests/e2e/run.mjs
```

Después de la pasada completa, la revisión visual ajustó los campos de tema/modo/categoría a una altura mínima de 46 px. Se repitieron los dos E2E móviles afectados, con aserciones de tamaño táctil, acceso a editar/olvidar y capturas tras desplazar la vista hasta los botones. Comando:

```sh
KAIWA_E2E_ARTIFACTS=/Users/ado/Documents/Codex/2026-09-25/hay/work/personal-memory/form-controls-final node tests/e2e/run.mjs personal.spec.mjs --grep 'móvil'
```

Evidencia completa en `tests/e2e/artifacts/report/index.html`, `result.json` y `results/`; comprobaciones táctiles finales en `work/personal-memory/form-controls-final` fuera del repo. La primera pasada detectó pérdida de espacios en el nombre latino de la banda al añadir furigana: se corrigió la anotación y el recorrido real final exige conservar el nombre exacto. La evidencia anterior se conserva en `work/personal-memory/before-whitespace-fix` fuera del repo.

Memoria significa persistencia del historial y recuperación limitada de contexto. La extracción automática usa citas de lo que el usuario afirma en su última intervención, puede omitir hechos y debe poder corregirse. Editar/olvidar revoca contexto de conversaciones, prácticas y errores antiguos sin borrar transcripciones o estadísticas. Una llamada abierta conserva su contexto inicial; hay que iniciar otra para usar cambios. El perfil y vocabulario guardado siguen siendo fuentes independientes y no se borran al olvidar un recuerdo. No se importan conversaciones de ChatGPT ni se sincroniza Bunpro.

El E2E de voz comprueba el recorrido con la integración de memoria presente, pero no evalúa una preferencia concreta mediante audio. Tampoco se acredita recuerdo perfecto, pronunciación humana, una importación directa de Bunpro ni uso en un móvil físico. Los seis contratos existentes del proveedor, compilación Python, sintaxis JavaScript, dependencias y diff pasan.

## Resultado integrado anterior


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
