# Despliegue privado de Kaiwa en Rushia

## Estado real — 10 de octubre de 2026

Resultados finales y límites comprobados: [evidencia reproducible](evidence/deployment-2026-10-10.json).

**Dokploy está instalado y su panel privado funciona. Kaiwa aún no está
publicada en `kaiwa.adonain.dev`.** Se consiguió acceso administrativo a Rushia
y se instaló Dokploy v0.30.8 con Docker 29.8.2 rootful, conservando el daemon
rootless del usuario `ado`. Son motores independientes: sus imágenes,
contenedores y volúmenes no se comparten automáticamente.

El panel responde en `http://100.75.30.119:3000` por Tailscale. Se verificaron
el registro del propietario, el rechazo de un segundo registro (`400`, administrador
ya creado), el login (`200`) y la lectura autenticada de proyectos (`200`).
Postgres y el servicio Dokploy no publican puertos; el proxy publica el 3000
exclusivamente sobre la IP Tailscale. El acceso a ese puerto por la IP pública
agotó el tiempo de conexión. Las reglas de firewall IPv4/IPv6 y su servicio
persistente están habilitados. No se instaló Traefik ni se publicaron 80/443.

La imagen Kaiwa se construyó en Linux y se verificaron Node 24.21.0, Codex CLI
0.159.3 y ejecución como UID 1000. El login oficial de ChatGPT está completado
en el volumen rootful persistente `kaiwa-codex`. Sobre la imagen final pasaron
TTS real **8/8**, seguridad del origen **7/7**, GPT Live real **2/2** y la suite
integrada **15/15**, incluido el lector corregido. Las pasadas previas
acreditaron UI **15/15** y migración de backup sintético **1/1**. También pasó
el E2E final de helpers de backup rootful con Compose aislado, incluida la
configuración del proyecto Dokploy mediante archivo. Las suites de navegador
usaron loopback y datos sintéticos; **no acreditan el dominio HTTPS final,
Cloudflare Access real ni migración
de datos personales**.

La zona `adonain.dev` pertenece a otra cuenta que la del conector Cloudflare.
El login oficial del CLI ya está completado en la cuenta correcta; su
certificado tiene permisos `0600`. Se creó el túnel local `kaiwa-rushia`,
sin arrancarlo ni añadir DNS. Su credencial específica está en un directorio
privado del host, con propietario/grupo `root:65532` y modo `0440`.

La cuenta no tiene un plan activo de Zero Trust. El checkout de Free muestra
`$0/month`, pero exige aceptar términos y posibles cargos por superar los
límites gratuitos. Se dejó abierto para que el propietario complete ese
consentimiento de facturación. Access, DNS, conexión del túnel y HTTPS final
siguen pendientes. No se publicó una ruta alternativa.

La imagen oficial del conector validó ingress y las reglas de hostname;
también se verificaron lectura del JSON como UID 65532 y Compose sin puertos
publicados. Estas comprobaciones usaron un AUD sintético, sin red: no acreditan
una aplicación Access real. [Evidencia del conector](evidence/tunnel-preflight-2026-10-10.json).

### Referencias de imágenes comprobadas

| Componente | Versión o referencia |
| --- | --- |
| Dokploy | `dokploy/dokploy:v0.30.8@sha256:e8789a3f71a1e50d817836ad222ee0eab8ee69fc1b0451fee189a880b5602871` |
| PostgreSQL | `postgres:16@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d` |
| Proxy privado | `nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94` |
| Node del build | `node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20` — 24.21.0 |
| Python del build | `python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258` — 3.12.15 |
| VOICEVOX CPU | `voicevox/voicevox_engine@sha256:4a9f0f5b3d3ed7438975f2b277cdfb805c6f8d5ed5d7258ac2988abbeae032a0` |
| Cloudflared | `cloudflare/cloudflared:2026.10.0@sha256:9b49eed8f62806d5d45ddf59ecefb5710429598ea6d3fcccd2af938f621b2b07` |
| Kaiwa final construida | Image ID local `sha256:3e2dd66c081bf212b54a5e2788df67890350ef42549b7accd4308e061d0f9339` |

El Image ID de Kaiwa identifica el contenido construido; no es un digest de
registro ni acredita que la imagen exista en ambos motores Docker. Comprobar
la imagen en el socket rootful que controla Dokploy antes de desplegarla.

## Arquitectura y datos

`Navegador HTTPS → Cloudflare Access → Tunnel → Kaiwa:8130`

Access debe autorizar únicamente el correo definido en `KAIWA_ALLOWED_EMAIL`.
Toda la aplicación queda protegida, incluidos estáticos, documentación, API,
exportaciones y WebSocket. La app verifica nuevamente el JWT firmado por
Cloudflare, su emisor, audiencia, fecha y correo exacto. Rechaza headers de
identidad sin firma, hosts alternativos y mutaciones/voz desde otro origen.

Compose no publica puertos y utiliza sus propias redes. Sólo Kaiwa y
`cloudflared` comparten la red con salida a Internet. VOICEVOX tiene una red
interna compartida con Kaiwa. No añadir dominios ni routers de Traefik en
Dokploy que permitan alcanzar el origen directamente.

Kaiwa se ejecuta como UID 1000, con un worker, filesystem de sólo lectura,
`/tmp` temporal, capacidades eliminadas y `no-new-privileges`. VOICEVOX se lanza
como UID 1000 directamente mediante `/opt/voicevox_engine/run`, evitando el
entrypoint con `gosu` que fallaba al eliminar capacidades. Su recorrido TTS ya
se verificó; sus rutas de escritura aún deben revisarse antes de restringir
también su filesystem.
Los límites de recursos son iniciales y deben comprobarse bajo carga real.
La zona horaria de la app es Tokio; la imagen instala los datos de zona horaria.

| Volumen | Ruta en Kaiwa | Contenido |
| --- | --- | --- |
| `kaiwa-data` | `/app/data` | SQLite, historial, memoria y caché TTS |
| `kaiwa-backups` | `/home/kaiwa/Documents/Kaiwa Backups` | Snapshots consistentes de SQLite |
| `kaiwa-codex` | `/home/kaiwa/.codex` | Sesión gestionada exclusivamente por Codex |

No montar el socket de Docker en Kaiwa ni compartir su volumen de Codex con
otros servicios. El audio de GPT Live circula mediante WebRTC entre el navegador
y OpenAI; la señalización y las transcripciones pasan por el WebSocket de Kaiwa.

## Preparación y comprobación del contenedor

1. Para reproducir una instalación **nueva**, revisar
   `deploy/install-private-dokploy.sh`, el firewall y el proxy que lo acompañan.
   Proporcionar las tres referencias de imagen anteriores y
   `DOKPLOY_START_ROOTFUL_DOCKER=1`. El script se ejecuta como root, selecciona
   explícitamente `/var/run/docker.sock` y rechaza un Swarm, contenedores o
   volúmenes preexistentes. No volver a ejecutarlo sobre Rushia ya instalada
   para actualizarla: nunca resetea un Swarm ni borra datos para continuar.
2. Transferir únicamente el código de la rama de trabajo. `.dockerignore`
   utiliza una lista permitida y excluye bases, credenciales, configuración
   privada, pruebas y artefactos del contexto del build.
3. Copiar `.env.example` a `.env`, con permisos `0600`. Completar el origen
   HTTPS, dominio de equipo Cloudflare, audiencia de la aplicación Access y
   correo exacto. `.env.example` ya fija `CLOUDFLARED_IMAGE` a la versión/digest
   2026.10.0 comprobada en el registro. No imprimir ni subir `.env`.
4. Validar y construir, sin activar todavía el túnel:

```sh
docker compose config --quiet
docker compose build kaiwa
docker compose up -d kaiwa voicevox
docker compose exec kaiwa codex --version
docker compose exec kaiwa codex login --device-auth
docker compose exec kaiwa codex login status
```

El propietario completa el login oficial de dispositivo. No copiar tokens,
cookies ni el caché de autenticación del Mac. Si el login de dispositivo no
está disponible, usar el flujo oficial de callback con redirección SSH. La
versión fijada de Codex es `0.159.3`; su ejecutable y versión ya se verificaron
en la imagen Linux. En Rushia ya se completó el login oficial en el volumen
rootful `kaiwa-codex` y GPT Live pasó su recorrido real en Linux por loopback.
Los comandos anteriores documentan cómo reproducir una instalación nueva;
no indican que deba repetirse el login existente. Queda verificar el recorrido
integrado por el HTTPS final. No introducir API keys como alternativa automática
a la suscripción.

`/healthz` devuelve sólo `{"status":"ok"}`. Su exención requiere conexión
directa por loopback y ausencia de headers Cloudflare/forwarded. El comando del
contenedor desactiva el procesamiento de proxy headers para conservar esa
distinción y exige startup ASGI (`--lifespan on`): un fallo al cargar el
verificador de producción debe impedir el arranque. Liveness no acredita que
Codex, el audio o la base sean funcionales.

## Activación de Cloudflare

Crear primero la aplicación Access para todo `kaiwa.adonain.dev`, con denegación
predeterminada y una única regla Allow para el correo del propietario. No añadir
reglas Bypass ni autorizar dominios de correo completos. Completar los datos
reales en `.env` antes de arrancar la app en producción.

### Comprobaciones del conector antes de activar DNS

Procedimiento definido antes del cambio de Compose a configuración y JSON:

| Riesgo | Comprobación real y resultado exigido |
| --- | --- |
| Configuración o credencial ausente/ilegible | Compose o el conector aborta; no se publica ningún puerto alternativo |
| Ingress inválido o sin regla final | `ingress validate` devuelve error |
| Hostname dirigido al origen equivocado | La URL de Kaiwa coincide con su regla; otro hostname coincide con `http_status:404` |
| Protección Access incompleta | Revisar `required: true`, equipo y AUD exactos; solicitud anónima y WebSocket sin JWT no llegan a la app |
| JSON inaccesible para UID 65532 | El conector ejecutado como `65532:65532` inicia con el secret real sin error de lectura |
| Host público perdido o sesión incorrecta | El propietario accede por HTTPS; una identidad ajena y un origen alternativo reciben denegación |

Con la imagen oficial fijada y los archivos privados ya montados, ejecutar en
el daemon rootful, sin iniciar los servicios dependientes:

```sh
docker --host unix:///var/run/docker.sock compose -p kaiwa-private-imwlmy --profile tunnel \
  run --rm --no-deps cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
docker --host unix:///var/run/docker.sock compose -p kaiwa-private-imwlmy --profile tunnel \
  run --rm --no-deps cloudflared tunnel --config /etc/cloudflared/config.yml ingress rule https://kaiwa.adonain.dev/
docker --host unix:///var/run/docker.sock compose -p kaiwa-private-imwlmy --profile tunnel \
  run --rm --no-deps cloudflared tunnel --config /etc/cloudflared/config.yml ingress rule https://unmatched.invalid/
```

La validación estática de ingress no prueba la firma JWT, el acceso al JSON ni
el dominio final. Después se requieren arranque real y probes HTTP/WebSocket,
seguido del recorrido del propietario con voz y streaming. Conservar salidas
sanitizadas y evidencias; no adjuntar la credencial JSON ni headers/cookies.

La pasada de preflight del 10 de octubre usó `/etc/kaiwa/tunnel/preflight.yml`,
el equipo `adonain-dev` y un AUD sintético de 64 caracteres `a`; nunca debe
usarse ese archivo para conectar producción. Los comandos de ingress anteriores
se ejecutaron con la imagen fijada, `--network none` y ese archivo montado en
`/etc/cloudflared/config.yml`. El JSON real sólo se abrió para comprobar permisos
e identidad; no se imprimió su contenido. Repetir la lectura sin red:

```sh
docker --host unix:///var/run/docker.sock run --rm --network none \
  --user 65532:65532 --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  -v /etc/kaiwa/tunnel/credentials.json:/run/secrets/tunnel-credentials:ro \
  --entrypoint python kaiwa:local -c \
  'import json,os; d=json.load(open("/run/secrets/tunnel-credentials")); assert os.getuid()==65532; assert len(d["TunnelSecret"])>20; assert d["TunnelID"]; assert d["AccountTag"]'
```

Usar el certificado con los comandos oficiales `cloudflared tunnel create
kaiwa-rushia` y `cloudflared tunnel route dns <UUID> kaiwa.adonain.dev`. Esto
crea un túnel gestionado localmente y su credencial JSON; el certificado de
cuenta sólo se utiliza para administrar recursos, nunca se monta en Kaiwa ni
en el conector. El runtime usa exclusivamente el JSON de ese túnel y su
configuración local, sin `--token-file`.

Partir de `deploy/cloudflared-config.example.yml` y generar un archivo privado
con valores literales reales. `KAIWA_TUNNEL_CONFIG_FILE` señala su ruta absoluta
en el host; `KAIWA_TUNNEL_CREDENTIALS_FILE` señala el JSON. Dentro del contenedor,
la configuración referencia `/run/secrets/tunnel-credentials`. No usar variables
de entorno como placeholders del YAML: deben sustituirse antes de desplegar.

La regla de `kaiwa.adonain.dev` enruta hacia `http://kaiwa:8130`, conserva el
Host público y exige `originRequest.access.required: true`. `teamName` contiene
sólo el prefijo del equipo, sin `.cloudflareaccess.com`; `audTag` contiene
únicamente el AUD de la aplicación Access. Terminar con `http_status:404` para
otros hostnames. Confirmar WebSocket y streaming SSE; no almacenar respuestas
personales en caché.

La carpeta privada del host debe tener permisos `0700`; preparar el JSON con
propietario/grupo `root:65532` y modo `0440`, y la configuración con `root:root`
y `0644`. El conector se ejecuta explícitamente como `65532:65532`. Comprobar
su lectura efectiva: secrets/configs de Compose basados en archivos no
garantizan remapeo de UID/GID/mode. No registrar el JSON ni activar logs debug.

Sólo después de preparar Access y comprobar el origen protegido:

```sh
docker compose --profile tunnel up -d
```

Importar la misma composición en Dokploy sin generar rutas públicas alternativas.
Registrar la revisión construida y los digests desplegados en la evidencia.

## Importación en Dokploy

Usar el proyecto Kaiwa y un entorno `production`, recuperando sus identificadores
desde la API autenticada. El esquema OpenAPI v0.30.8 contempla crear un proyecto
(`project.create`), crear el entorno si no existe (`environment.create`), crear
el recurso Compose (`compose.create`), guardar sus variables
(`compose.saveEnvironment`) y desplegar (`compose.deploy`). Revisar la respuesta
real para obtener cada identificador; no deducirlos del nombre.

Elegir `composeType: docker-compose`, conservar las redes del archivo y no
añadir dominios de Dokploy. Mantener desactivados el despliegue automático y
la generación de volúmenes aislados por despliegue. No usar `freshVolumes`
durante una actualización: la memoria y las sesiones deben sobrevivir.
La API confirmó `appName: kaiwa-private-imwlmy`; intentar cambiar `appName`
mediante `compose.update` se ignoró. Usar ese nombre real para seleccionar el
proyecto Compose. Mantener el comando de despliegue vacío (`""`) para que
Dokploy ejecute su comando oficial con `docker compose -p <appName>`.

Una fuente `raw` no contiene el contexto `build: .` del repositorio. Para usarla,
crear una composición de producción que referencie la imagen ya construida en
el motor rootful, sin `build`, y con `pull_policy: never` si sólo existe
localmente. La alternativa es una fuente Git de la rama verificada, con su
Dockerfile y lock dentro del contexto. Inspeccionar la composición efectiva
antes del primer despliegue; no modificar la imagen ya comprobada sin repetir
los recorridos afectados.

La configuración y el JSON del túnel deben estar en rutas absolutas del host
fuera del repositorio y de los logs. Activar `COMPOSE_PROFILES=tunnel` en las variables
de producción únicamente cuando Access y el túnel estén preparados. Preparar
un recurso Compose en Dokploy no demuestra que la aplicación esté desplegada.

## Verificación realizada y pendiente

Los fallos de seguridad se enumeraron y los E2E se escribieron antes de
implementar el middleware. El runner usa una base nueva y JWT/JWKS sintéticos
firmados, servidos por HTTPS; no incorpora una excepción de autenticación de
producción ni utiliza el perfil personal.

```sh
.venv/bin/python -m pip install -r requirements.lock
node tests/e2e/deploy-security-run.mjs
```

Pasadas Linux comprobadas, sin omitidos ni reintentos, con informes bajo
`/home/ado/.local/share/kaiwa-deploy/evidence/`:

| Recorrido | Resultado | Evidencia |
| --- | --- | --- |
| UI escritorio/móvil y errores recuperables, pasada previa | 15/15 | `ui-e2e/report/index.html` |
| JWT/Host/Origin, expiración de voz y persistencia, imagen final | 7/7, 14,3 s | `security-final-e2e/report/index.html` |
| Lectura japonesa con VOICEVOX real, imagen final | 8/8, 14,2 s | `tts-final-e2e-r2/report/index.html` |
| GPT Live real y permiso de micrófono denegado, imagen final | 2/2, 34,7 s | `voice-final-e2e/report/index.html` |
| Recorridos integrados, incluido el lector corregido, imagen final | 15/15, 3,7 min | `integrated-final-e2e/report/index.html` |
| Backup/migración de esquema con memoria e historial, pasada previa | 1/1 | `backup-migration-r2/report/index.html` |
| Helpers rootful: configuración, selección, snapshot, restore y reinicio | Aprobado | `backup-rootful-final-e2e/result.json` |

La primera pasada de helpers se ejecutó con la imagen previa
`sha256:760c4e02e636eb977ca44d96373965cf47a92305f74b7ab04e21513f00bef703`;
sus proyectos y volúmenes fueron sintéticos y se limpiaron al terminar.
Consultar `tests/e2e/README.md` para los procedimientos. El cierre del despliegue
exige además comprobar sobre el contenedor integrado y el dominio final:

- Acceso anónimo/otra identidad denegado en UI, API y voz; no existe acceso por
  IP, puerto publicado ni URL alternativa. JWT inválido/caducado y origen
  incorrecto no alteran datos. La autorización de voz expira correctamente.
- Conversación de texto con streaming, memoria editable, práctica por tema,
  vocabulario/SRS, síntesis TTS real y backup/restauración.
- GPT Live completo: micrófono, audio de salida, transcripción e informe bajo
  el HTTPS final. Verificar escritorio y un móvil real; emulación no acredita
  permisos ni audio físico del teléfono.
- Reinicio y recreación del contenedor conservan SQLite y login de Codex.
- Restauración de backup y rollback sobre datos sintéticos, con comando,
  resultados y evidencias que no contengan datos personales o credenciales.

Un build o healthcheck verde no sustituye estos recorridos. No declarar el
despliegue terminado hasta integrar, ejecutar los E2E pertinentes, revisar el
diff, hacer commit/push y comprobar la revisión remota.

## Migración, backups y rollback

Mantener el Mac operativo hasta verificar el servidor con datos sintéticos.
Generar el snapshot personal mediante la API de backup de SQLite, evitando
copiar una base abierta como un archivo ordinario. Conservar una copia privada
en el Mac. Importar el snapshot por la ruta protegida de restauración, que
sanea rutas y voces de otra plataforma. Si se hace una migración directa al
volumen, sanear explícitamente esos ajustes antes del arranque.

Tras el cambio, mantener una sola base autoritativa; no sincronizar escrituras
bidireccionales entre Mac y Rushia. Conservar la imagen anterior y un snapshot
compatible antes de actualizar. No borrar volúmenes al recrear contenedores.

Los helpers usan explícitamente Docker rootful (`unix:///var/run/docker.sock`)
y exigen exactamente un contenedor activo con las etiquetas Compose de proyecto
configurado y servicio `kaiwa`. Dokploy asignó a esta aplicación el proyecto
`kaiwa-private-imwlmy`; no usa el nombre manual `kaiwa-private`. No seleccionan
el motor TTS ni proyectos de
pruebas. Una selección vacía o ambigua aborta; no cambian al daemon rootless.
`KAIWA_DOCKER_HOST` y `KAIWA_COMPOSE_PROJECT` permiten ejecutar pruebas aisladas.
Si `KAIWA_COMPOSE_PROJECT` no está definida, ambos helpers leen literalmente una
única línea de `/etc/kaiwa/compose-project`. Si el archivo no existe, conservan
el valor manual `kaiwa-private`; un archivo existente malformado provoca fallo.
La variable explícita tiene prioridad y un valor vacío es inválido.
`KAIWA_BACKUP_PROJECT_FILE` permite usar un archivo temporal durante los E2E.
Los helpers remotos requieren root y ejecutan SQLite como UID/GID 1000 dentro
del contenedor.

Los helpers, unidades y archivo de proyecto siguientes ya están instalados.
Para reproducir su instalación como root desde el checkout revisado, sin
habilitar todavía el timer:

```sh
install -d -m 0755 /usr/local/libexec
install -d -o root -g root -m 0750 /etc/kaiwa
printf '%s\n' 'kaiwa-private-imwlmy' > /etc/kaiwa/compose-project
chown root:root /etc/kaiwa/compose-project
chmod 0640 /etc/kaiwa/compose-project
install -o root -g root -m 0750 deploy/backup.sh /usr/local/libexec/kaiwa-backup.sh
install -o root -g root -m 0750 deploy/export-backup.sh /usr/local/libexec/kaiwa-export-backup.sh
install -o root -g root -m 0640 deploy/kaiwa-backup-container.sh /usr/local/libexec/kaiwa-backup-container.sh
install -o root -g root -m 0644 deploy/kaiwa-backup.service /etc/systemd/system/kaiwa-backup.service
install -o root -g root -m 0644 deploy/kaiwa-backup.timer /etc/systemd/system/kaiwa-backup.timer
systemctl daemon-reload
```

El servicio es una unidad **del sistema, ejecutada como root**, sin dependencia
del directorio del checkout. `deploy/backup.sh` guarda snapshots privados en
`kaiwa-backups`; el timer prepara una ejecución diaria a las 03:00 de Tokio.
El archivo `/etc/kaiwa/compose-project` contiene `kaiwa-private-imwlmy`.
El timer está **instalado y deshabilitado**: no activarlo hasta que exista la
instancia de producción y pase su comprobación manual.

`deploy/pull-backup.sh /directorio/privado/de/copias` descarga un snapshot
consistente mediante `admin@rushia` y `sudo -n /usr/local/libexec/kaiwa-export-backup.sh`.
Usa `~/.ssh/rushia_admin_ed25519` por defecto; `KAIWA_SSH_IDENTITY` permite indicar
otra ruta. Conserva la verificación SSH del servidor, valida la cabecera,
tablas personales e integridad SQLite y publica el archivo de forma atómica
sin sobrescribir otro. El directorio local queda con permisos 0700 y el archivo
con 0600. No concede sudo ni acceso al socket Docker al usuario `ado`.

El E2E de helpers se escribió antes de adaptarlos: usa proyectos Compose
temporales, servicios distractores y datos sintéticos; comprueba exportación,
restauración, persistencia tras reiniciar y rechazo de selección ausente,
duplicada o daemon incorrecto. Se amplió antes de modificar los helpers para
cubrir selección desde archivo, archivo ausente/malformado y prioridad de la
variable explícita; la pasada final Linux aprobó también esos casos.
Ejecutar como root con una imagen ya construida:

```sh
KAIWA_BACKUP_E2E_IMAGE=kaiwa:verified python3 deploy/check-backup-e2e.py \
  --evidence-dir /ruta/privada/evidence/backup-e2e
```

La etiqueta anterior es un ejemplo: seleccionar la imagen verificada del
daemon rootful. El informe `result.json` contiene resultados y condiciones,
sin la base de datos. El E2E rootful **pasó** y dejó evidencia en
`/home/ado/.local/share/kaiwa-deploy/evidence/backup-rootful-final-e2e/result.json`.
La descarga SSH de producción y migración personal siguen pendientes.
El volumen de Codex queda fuera de los backups ordinarios de datos. Una copia
en el mismo servidor no cubre la pérdida del servidor.

Referencias: [Dokploy](https://docs.dokploy.com/docs/core/installation),
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/),
[validación JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[login oficial Codex](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).
