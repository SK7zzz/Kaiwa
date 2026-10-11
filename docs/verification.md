# Verificación de la adaptación personal

## Estado actual desplegado — 11 de octubre de 2026, Asia/Tokyo

[Registro saneado de este despliegue](evidence/tailscale-deployment-2026-10-11.json):
resultados, imagen, procedimientos y límites sin credenciales ni contenido personal.

Kaiwa está desplegada mediante Dokploy en Rushia, con acceso privado en
`https://rushia-1.tail7bb611.ts.net` por Tailscale Serve y nginx loopback.
La app exige el secreto del proxy y la identidad Tailscale exacta; Kaiwa y
VOICEVOX no publican puertos. No está habilitado Funnel.

El commit desplegado es `4139ff9`. La inspección real registra la configuración
de imagen del contenedor
`sha256:39c08366c7074cb7f78f790dc8de399c89a0daaebdc1c8677b3697eaa0c43017`
y el índice inmutable
`sha256:11b3e1654b030128792854ed13139b253647bd2c0c352345df904266dc029d09`.
Son identificadores distintos del almacén containerd; no representan dos
versiones diferentes de la aplicación.

Comprobaciones actuales sobre el resultado integrado:

| Recorrido | Resultado | Evidencia fuera de Git |
| --- | --- | --- |
| Autenticación Tailscale sintética: HTTP/WS, identidad, secreto, CSRF, configuración, memoria y backup/reinicio | 7/7, 3,38 s | `work/deploy/tailscale-security-r2/report/index.html` |
| Regresión Cloudflare JWT/JWKS | 7/7, 5,23 s | `work/deploy/cloudflare-regression-ts-r1/report/index.html` |
| Ingreso Linux real: servicios, puertos, redes, restricciones, TLS, Serve y denegaciones | 11 controles aprobados | `work/deploy/tailscale-ingress-runtime-r2.json` |
| HTTPS escritorio/móvil, memoria, Codex/SSE/corrección/WAV/informe y GPT Live | 5 casos aprobados: 2 en R2 y 3 en R3 | Remoto: `evidence/tailscale-live-r2/report/index.html` y `evidence/tailscale-live-r3/report/index.html` |
| Importación personal y persistencia tras reinicio | Ambas fases aprobadas; integridad SQLite correcta | `work/deploy/private/personal-migration-import-result.json` y `work/deploy/private/personal-migration-restart-result.json` |
| Descarga SSH real al Mac | Integridad y comparación exacta aprobadas; archivo privado fuera de Rushia | `work/deploy/private/offsite-verification-result.json` |
| Compatibilidad del descargador en macOS | 8/8, SSH y SQLite sintéticos | `work/deploy/pull-backup-macos-after/result.json` |

Las rutas locales anteriores son relativas al workspace. La raíz de la evidencia
remota es `/home/ado/.local/share/kaiwa-deploy/`. En R3 pasaron memoria en
6,8 s, Codex en 27,9 s y GPT Live en 30,6 s. Estas pasadas de navegador utilizaron
exclusivamente datos sintéticos **antes de migrar el perfil personal**. Verifican
TLS real, contexto seguro y micrófono disponible; navegación sin desbordamiento
a 1440/390 px; memoria persistente; SSE completo; corrección; reproducción WAV;
voz japonesa real por WebRTC, subtítulos/mute e informes persistidos. El
micrófono es sintético; no acreditan un móvil o altavoz físico ni latencia
incremental del SSE. Procedimiento y límites:
[E2E repetibles](../tests/e2e/README.md#despliegue-real-https-navegador-y-proveedores-sobre-tailscale).

La importación y el reinicio comparan exactamente ocho tablas: perfil,
sesiones, mensajes, vocabulario, errores, recuerdos personales, mensajes del
compañero y estado de contexto. Conservan **una sesión, 17 mensajes y cinco
recuerdos**, sin cambios de ajustes de plataforma; el login oficial de Codex
permanece preparado. Los informes privados sólo conservan resultados/conteos,
no contenido personal ni credenciales. No repetir los E2E sintéticos sobre esta
base de producción ya migrada.

El Mac volvió a conectarse a Tailscale y la **descarga SSH real pasó**:
archivo privado `0600`, integridad SQLite correcta y comparación exacta de las
ocho tablas con los datos originales (una sesión, 17 mensajes y cinco recuerdos),
incluidos todos sus ajustes. Evidencia
saneada: `work/deploy/private/offsite-verification-result.json`. El snapshot
comprobado está fuera de Rushia; no se incluyen datos personales en el informe.

El timer de backups está **activo**; la próxima ejecución observada fue
`2026-10-11T18:04:57Z`. Se inició el servicio mediante systemd y terminó con
`ExecMainStatus=0`, `Result=success` y marca de salida `2026-10-11T03:29:11Z`.
Su **primer snapshot del servidor está verificado**: un archivo presente,
modo `0600` e integridad SQLite correcta. Esto comprueba el servicio real y su
archivo, además del timer activo; no equivale a haber esperado la siguiente
ejecución programada.

La copia externa comparada exactamente arriba corresponde a la descarga previa
a ese backup. La segunda descarga, posterior al nuevo snapshot, también pasó:
conserva las ocho tablas y sólo cambia el ajuste operativo `backup_last`.
Evidencia privada: `work/deploy/private/offsite-after-server-backup-result.json`.
La descarga fuera de Rushia es manual; no hay automatización del pull instalada.
La compatibilidad del descargador macOS pasó **8/8** con SSH y
SQLite sintéticos, después de reproducir siete fallos de ocho casos por el uso
incompatible de `chmod --` en BSD.
Evidencia: `work/deploy/pull-backup-macos-before/result.json` y
`work/deploy/pull-backup-macos-after/result.json`. Este recorrido aislado se
distingue de la descarga real aprobada arriba.

La arquitectura Cloudflare/Tunnel se abandonó a favor de Tailscale Serve. Su
código y pruebas se conservan como alternativa; no se publica Kaiwa mediante
`kaiwa.adonain.dev` ni se afirma haber comprobado Access/Tunnel real. Los
resultados del 10 de octubre que siguen son históricos y no sustituyen la
verificación actual por HTTPS.

## Histórico: Linux integrado — 10 de octubre de 2026, Asia/Tokyo

La imagen final reconstruida es
`sha256:3e2dd66c081bf212b54a5e2788df67890350ef42549b7accd4308e061d0f9339`.
Sobre ella pasan **8/8 TTS en 14,2 segundos**, **7/7 seguridad en 14,3 segundos**,
**2/2 GPT Live en 34,7 segundos** y **15/15 recorridos integrados en 3,7 minutos**,
sin casos omitidos. La suite integrada incluye el lector corregido, cuyo caso
pasó en 47,7 segundos. Evidencia remota bajo
`/home/ado/.local/share/kaiwa-deploy/evidence/`:

- `tts-final-e2e-r2/report/index.html`.
- `security-final-e2e/report/index.html`.
- `voice-final-e2e/report/index.html`.
- `integrated-final-e2e/report/index.html`.

Los resultados de la tabla siguiente corresponden a las pasadas anteriores,
conservadas como evidencia.

Se construyó Kaiwa en Rushia y se verificaron Node 24.21.0, Python 3.12.15,
Codex CLI 0.159.3 y usuario de contenedor 1000. El login oficial de ChatGPT
está completado en el volumen rootful persistente `kaiwa-codex`; no se copiaron
credenciales del Mac. Docker rootful, usado por Dokploy, y el daemon rootless
del usuario `ado` mantienen imágenes y volúmenes independientes.

Las pasadas Linux siguientes usaron instancias temporales por loopback y datos
sintéticos. Los cuatro `result.json` de UI, seguridad, voz y migración fueron
comprobados: no contienen omitidos, fallos inesperados ni reintentos exitosos.

| Recorrido | Resultado | Duración | Evidencia local fuera del repo |
| --- | --- | --- | --- |
| UI escritorio/móvil, navegación, formularios y errores recuperables | 15/15 | 50,832 s | `work/deploy/ui-e2e/ui-e2e/report/index.html` |
| JWT/Host/Origin, configuración, expiración de voz y persistencia | 7/7 | 14,286 s | `work/deploy/security-linux/report/index.html` |
| GPT Live: audio real, transcripción, controles, cierre y permiso denegado | 2/2 | 36,268 s | `work/deploy/voice-e2e/voice-e2e/report/index.html` |
| Backup: memoria/historial exactos y migración de esquema antiguo | 1/1 | 2,211 s | `work/deploy/backup-migration-r2/backup-migration-r2/report/index.html` |
| VOICEVOX real y reproducción en navegador | 6/6 | 15,832 s | `work/deploy/tts-e2e-r3/tts-e2e-r3/report/index.html` |

GPT Live utiliza micrófono sintético y proveedor real; comprueba voz japonesa
en ambos sentidos, transcripciones y cierre persistente. Acredita el recorrido
Linux por loopback, sin evaluar un micrófono/altavoz físico ni el dominio final.
La UI cubre 320/390 px y escritorio, IME japonés, foco/teclado y recuperación
de errores HTTP representados en el cliente; esos negativos no acreditan una
caída real del proveedor. Los procedimientos están en
[E2E repetibles](../tests/e2e/README.md).

También **pasó** el E2E final real Docker/Compose de helpers de backup rootful.
Creó proyectos y volúmenes aislados, añadió servicios distractores, exportó
un snapshot consistente privado, restauró perfil/memoria y comprobó su
persistencia tras reiniciar. Ambos helpers rechazaron proyecto ausente,
selección duplicada y socket incorrecto. La ampliación final aprobó selección
exacta desde archivo de proyecto, archivo ausente/malformado y prioridad de la
variable explícita. No montó datos de producción ni usó IA.
Evidencia remota:
`/home/ado/.local/share/kaiwa-deploy/evidence/backup-rootful-final-e2e/result.json`.
Procedimiento: [backups rootful](deployment.md#migración-backups-y-rollback).
Los helpers, el servicio de sistema, el timer y la configuración
`/etc/kaiwa/compose-project` están instalados; el proyecto configurado es
`kaiwa-private-imwlmy` y el timer permanece deshabilitado.

En esta fase histórica, Dokploy privado estaba verificado por Tailscale y el
túnel local `kaiwa-rushia` no tenía DNS ni conexión activa. El conector
Cloudflare pasó únicamente el preflight de ingress/rutas, lectura de credencial
como UID 65532 y Compose sin puertos, con AUD sintético; no se comprobó tráfico
por Access/Tunnel real. Esa arquitectura se abandonó a favor de Tailscale Serve;
no hay un paso pendiente de activación de Cloudflare. El código de esta pasada
histórica se subió en `4c607ed`, y el preflight del conector en `0863952`.
En aquella fase aún faltaban la migración, el acceso HTTPS y la descarga SSH
de producción; sus comprobaciones actuales están al principio del documento.

## Seguridad del origen — 10 de octubre de 2026, Asia/Tokyo

Pasan **7 E2E**, sin reintentos ni casos omitidos, en **5,394 segundos**. La
prueba arranca FastAPI/Uvicorn en un puerto loopback efímero, con SQLite nueva,
modo producción y JWT/JWKS sintéticos servidos sobre HTTPS. No usa el servidor
personal en 8130, no importa datos personales ni inicia Codex.

Comando ejecutado desde la raíz del repositorio:

```sh
KAIWA_E2E_ARTIFACTS=/Users/ado/Documents/Codex/2026-09-25/hay/work/deploy-security-2026-10-10-r2 node tests/e2e/deploy-security-run.mjs
```

Entorno comprobado: macOS, Node 24.14.1, Python 3.12.14 y Playwright 1.62.1.
Para ejecutar producción se instalaron PyJWT 2.15.1, cryptography 50.0.2,
cffi 2.1.1 y pycparser 3.11 en `.venv`. Esas son las versiones de esta pasada;
las dependencias fijadas de la imagen Linux se deben verificar por separado.

Cobertura comprobada:

- HTML, estáticos, documentación, API, exportación y WebSocket rechazan acceso
  anónimo y headers de identidad sin JWT firmado.
- Firma, algoritmo, emisor, audiencia, correo, vigencia, `nbf`, claims
  obligatorios y key ID desconocido se verifican contra el JWKS HTTPS real de
  la fixture. Un token válido accede y conserva headers de privacidad.
- Host alternativo y mutaciones con Origin ausente/ajeno o `Sec-Fetch-Site`
  cross-site devuelven denegación sin modificar el perfil.
- `/healthz` local devuelve sólo el estado; los headers que representan un
  proxy impiden eludir la autorización.
- Cada variable de identidad ausente impide construir la aplicación.
- Una voz conectada sin SDP cierra con código 1008 al expirar un token de tres
  segundos; ese token deja también de autorizar HTTP. No se inicia el proveedor.
- Perfil y memoria se guardan, el snapshot SQLite restaura el contenido exacto
  y ambos sobreviven al reinicio del proceso con la misma base.

La primera ejecución dejó 4 aprobados y 3 fallidos: el `fetch` de Node eliminaba
el Host público al conectar con loopback y el origen lo rechazaba correctamente.
Se confirmó el header saliente y se corrigió únicamente el transporte del
harness para usar `node:http`. El informe inicial se conserva en
`work/deploy-security-2026-10-10`; la pasada final está en
`work/deploy-security-2026-10-10-r2`, ambos fuera del repositorio.

Evidencia final: `report/index.html`, `result.json`, trazas en `results/` y
adjuntos de denegaciones, validación JWT, configuración, expiración de voz y
backup/persistencia. Los adjuntos de backup contienen tamaño y SHA-256 del
snapshot sintético; no incluyen SQLite, tokens, claves privadas ni credenciales.
El runner elimina sus bases y certificados temporales al terminar.

Esta pasada macOS **no acredita Docker, Cloudflare Access/Tunnel real, login de
Google, GPT Live activo al expirar la autorización, audio VOICEVOX Linux ni un
móvil físico**. El reinicio comprobado es del proceso con SQLite persistente;
la recreación del contenedor y sus volúmenes necesita su propio recorrido. El
build y recorridos Linux comprobados están registrados por separado arriba.
El acceso final aún no se había comprobado en esta pasada histórica; su estado
actual figura al principio de este documento.

## Lectura japonesa en Linux — 10 de octubre de 2026, Asia/Tokyo

Pasan **6 E2E**, cero omitidos y cero reintentos, en **15,832 segundos**,
contra una instancia temporal de la imagen Linux en Rushia, con SQLite y
volúmenes de prueba independientes. Se ejecutó Chromium **151.0.7922.34** con
Playwright **1.62.1**, Node **24.21.0** y Python del contenedor **3.12.15**
sobre Linux. La imagen `kaiwa:local` comprobada tiene ID
`sha256:760c4e02e636eb977ca44d96373965cf47a92305f74b7ab04e21513f00bef703`. No se usó la base personal ni el servidor del Mac en 8130,
no se copiaron credenciales y no se consumió cuota de Codex/GPT Live.

El modo local se habilitó únicamente en el contenedor temporal de pruebas,
publicado en `127.0.0.1:18133`, sin túnel. No se desactivó la autorización de
producción. El [procedimiento repetible](../tests/e2e/README.md#lectura-japonesa-real-en-linux)
describe sus volúmenes nuevos, motor real y acceso mediante SSH.

Cobertura y evidencia comprobadas:

- VOICEVOX CPU genera un WAV japonés válido con `vv:8`: **2,805 segundos** a
  velocidad 1 y **3,989 segundos** a velocidad 0,7. El WAV normal tiene
  **134.700 bytes**; repetir la petición devuelve los mismos bytes.
- El backend declara `system: "Linux"` y un perfil migrado con `say:Kyoko`
  obtiene audio japonés mediante el motor disponible.
- Texto vacío tras limpiar formato, voz inválida y velocidad fuera de rango
  devuelven `422`. Un estilo inexistente del motor devuelve `503` con mensaje
  explícito, sin intentar ejecutar utilidades de macOS.
- «Escuchar» y la muestra de Ajustes reproducen audio real en Chromium a
  **1440 y 390 px**. Los eventos `playing` registran **2,805 y 3,627 segundos**
  de audio; no se sustituye `Audio` por un reproductor simulado.
- Un `503` representado sólo en el navegador muestra el error; Reintentar
  recupera la reproducción real. Este negativo acredita el cliente, no una
  caída real del servicio VOICEVOX.
- Se revisaron las capturas finales de escritorio y móvil: selector y botón
  de muestra son accesibles, el crédito de VOICEVOX es visible y el nombre
  japonés largo queda truncado dentro del selector móvil sin ensanchar la página.

Evidencia final fuera del repositorio:
`work/deploy/tts-e2e-r3/tts-e2e-r3/report/index.html`, `result.json`, trazas y
adjuntos WAV/capturas/métricas. SHA-256 del WAV sintético normal:
`5b1e31135aaddc37af057652e0514034cdaa537009651ff69a3a07b4ae122432`.

La primera ejecución local no pudo iniciar Chrome por un fallo del sandbox
macOS (`SIGABRT`). En Linux faltaba inicialmente el navegador requerido por
Playwright; se instaló Chromium antes de la pasada final. El entrypoint del
contenedor oficial VOICEVOX intentaba ejecutar `gosu` y fallaba con todas las
capacidades eliminadas: se corrigió el arranque a usuario `1000:1000`, ejecutable
`/opt/voicevox_engine/run` y argumento `--host 0.0.0.0`. La pasada final usa ese
motor sin privilegios; no se añadieron capacidades para obtener un resultado
verde.

Este recorrido acredita generación y reproducción por navegador, no la calidad
fonética evaluada por una persona ni un altavoz/móvil físico. Tampoco acredita
Cloudflare Access/Tunnel real, login de Google, migración de datos personales o
recreación/restauración completa de producción. GPT Live en Linux se comprobó
en su pasada independiente, registrada arriba. El texto
de ayuda para instalar AivisSpeech sigue orientado al uso local y debe adaptarse
si se incorpora ese motor al servidor.

## Fixture de micrófono compatible con Linux

Se reprodujo otro fallo del entorno macOS el 10 de octubre: `say` y `afconvert`
terminaban con código 0 pero producían PCM vacío. La fixture anterior añadía
22 segundos de silencio y podía presentar ese archivo como una intervención.
El helper ahora rechaza esa salida antes de crear el micrófono sintético.
La reproducción local con el helper corregido termina explícitamente con
«El WAV de voz no contiene muestras PCM completas», sin generar `speech.wav`.

Antes de implementar la validación se enumeraron archivo ausente/ajeno a WAV,
chunks truncados, PCM incompatible, muestras vacías, silencio y fuente demasiado
corta. Se escribió primero `tests/e2e/speech-fixture.test.mjs`; su caso positivo
falló contra el comportamiento anterior. Después pasan **10 contratos aislados**
con `node --test tests/e2e/speech-fixture.test.mjs`. No sustituyen la conversación
E2E ni acreditan calidad fonética: usan PCM sintético para comprobar el adaptador.

`KAIWA_E2E_VOICE_SOURCE_WAV` permite aportar en Linux un WAV japonés ya generado,
PCM mono de 16 bits/48000 Hz. La misma validación aplica al flujo nativo macOS;
ambos exigen duración de fuente mayor que un segundo y RMS positivo antes de
los silencios de negociación. Los metadatos conservan frase declarada, duración,
RMS y hashes SHA-256 de fuente y fixture. El hash identifica el audio; no
reconoce el contenido verbal de una fuente externa. La ejecución GPT Live en
Linux terminó y está registrada por separado arriba.

## Contexto de las verificaciones anteriores

El 8 de octubre la ejecución había quedado bloqueada por permisos de bind y
transferencia SSH, y no se crearon DNS, Tunnel ni Access. La concesión de red del
10 de octubre permitió ejecutar este recorrido desde el entorno principal.
Los resultados históricos siguientes pertenecen a la adaptación anterior y no
sustituyen las pruebas del despliegue. Consultar el
[procedimiento de despliegue](deployment.md) y los
[E2E repetibles](../tests/e2e/README.md).

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

No se evaluaron pronunciación humana, ruido ambiental, interrupciones frecuentes ni el micrófono de un móvil físico. La revisión móvil usa emulación de iPhone 13 en Chrome. En aquella pasada no se activó Tailscale ni se probaron proveedores/recursos offline, instaladores o despliegue; Tailscale y el despliegue actuales se verifican en la sección inicial. JMdict offline conserva definiciones japonés–inglés.

## Controles adicionales

Pasan los seis contratos de fallos del proveedor, escritos antes de implementarlo, la compilación Python, sintaxis JavaScript, `bash -n`, `pip check` y `git diff --check`. También se ejecutaron `./setup.sh` y el arranque real `./run.sh --no-browser`.

AnyIO se declara como dependencia directa `>=4.1` porque la cancelación del streaming usa `abandon_on_cancel`, incorporado con ese nombre en [AnyIO 4.1](https://anyio.readthedocs.io/en/latest/versionhistory.html). Los controles estáticos no sustituyen los E2E anteriores.
