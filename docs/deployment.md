# Kaiwa privado en Rushia mediante Tailscale

## Estado — 11 de octubre de 2026, Asia/Tokyo

Ado eligió Tailscale. La configuración Cloudflare queda como [histórico](deployment-cloudflare-archive.md): no requiere activar Zero Trust ni publicar DNS.

Dirección privada: **https://rushia-1.tail7bb611.ts.net**. El dispositivo debe tener Tailscale conectado a la red de `adonain.dev@gmail.com`. Se usa el nombre HTTPS de Tailscale para disponer de certificado válido y micrófono/WebRTC. `kaiwa.adonain.dev` no es la dirección de este despliegue.

Serve ya tiene HTTPS configurado. La integración y pruebas finales están en curso; aún no acredita migración personal ni voz a través del proxy.

## Acceso y aislamiento

`Navegador → Tailscale Serve HTTPS:443 → 127.0.0.1:18130 → nginx → Kaiwa:8130`

Serve escucha exclusivamente en las direcciones Tailscale de Rushia. **Funnel no está habilitado**. Serve añade la identidad y elimina los headers de identidad enviados por el cliente. Kaiwa exige el login exacto `adonain.dev@gmail.com`; pertenecer a la red con otra identidad no autoriza la app.

Nginx publica sólo `127.0.0.1:18130` e inyecta un secreto aleatorio de 256 bits. Kaiwa comprueba ese secreto antes de confiar en la identidad. No se entrega al navegador ni al repositorio. Esto también impide que un contenedor ajeno falsifique la identidad accediendo directamente a Kaiwa. El host y su administrador son parte de la frontera de confianza.

Kaiwa y VOICEVOX no publican puertos. `kaiwa-proxy` une sólo nginx y Kaiwa; `kaiwa-speech`, Kaiwa y VOICEVOX; ambas son internas. Kaiwa tiene una red separada para acceder a Codex. Se conservan Host/Origin, CSRF, protección WebSocket y headers de seguridad. No añadir dominios Dokploy, routers Traefik ni redes compartidas.

## Configuración y despliegue

Dokploy usa Docker rootful `/var/run/docker.sock`. El daemon rootless de `ado` tiene imágenes y volúmenes independientes. Proyecto Compose real: `kaiwa-private-imwlmy`; composeId: `-Qcniki2VcyAeF1IQyXxO`. Panel privado: `http://100.75.30.119:3000`.

1. Ejecutar el renderer de `deploy/` para generar `/etc/kaiwa/tailscale/proxy.conf` y `proxy-secret`. Directorio root `0700`; archivos legibles únicamente por los UID de los servicios correspondientes. No imprimir contenido ni copiarlo a argumentos, logs o Git.
2. Guardar en Dokploy los valores de `.env.example`: proveedor Tailscale, origen HTTPS, login exacto, rutas privadas e imágenes fijadas por digest. Sin `COMPOSE_PROFILES=tunnel` ni variables Cloudflare.
3. Mantener fuente Git, rama `ado/spanish-codex-tutor`, archivo `./compose.yaml`, dominios vacíos y comando vacío. Dokploy construye y ejecuta Compose mediante su comando oficial. No activar fresh volumes.
4. Inspeccionar Compose convertido: sólo nginx publica puerto, exclusivamente loopback; sin Traefik, cloudflared ni Funnel. Desplegar, comprobar healthchecks y `nginx -t`.
5. Configurar Serve conservando otras rutas si las hubiera:

   ```sh
   sudo tailscale serve --bg --https=443 http://127.0.0.1:18130
   sudo tailscale serve status --json
   ```

   No debe existir `AllowFunnel: true`. `tailscale funnel status` también muestra configuración de Serve: eso por sí solo no significa que Funnel esté habilitado.
6. Ejecutar E2E sobre SQLite sintética antes de importar datos personales.

Kaiwa y nginx usan UID sin privilegios, filesystem de sólo lectura, capacidades eliminadas y `no-new-privileges`. Kaiwa tiene un worker y `/tmp` temporal. VOICEVOX conserva el runtime CPU oficial por digest, UID1000 y red interna; límites iniciales 4 GiB y 2 CPU.

## Migración, backups y rollback

Volúmenes rootful estables: `kaiwa-data`, `kaiwa-codex`, `kaiwa-backups`. El login oficial de ChatGPT persiste en `kaiwa-codex`; no se copian tokens del Mac.

Migrar mediante snapshot consistente de SQLite, conservando original y exportación destino fuera del repositorio. La importación normaliza ajustes macOS/Linux. Verificar integridad, tablas, conteos y memoria tras reiniciar, sin ejecutar pruebas sintéticas sobre datos personales. Conservar la base del Mac como rollback.

El helper selecciona exactamente un contenedor en ejecución mediante labels de proyecto y servicio. `/etc/kaiwa/compose-project` debe contener una sola línea `kaiwa-private-imwlmy`.

```sh
sudo systemctl start kaiwa-backup.service
sudo systemctl enable --now kaiwa-backup.timer
sudo systemctl list-timers kaiwa-backup.timer
# En el Mac: snapshot consistente descargado y validado fuera de Rushia.
bash deploy/pull-backup.sh /directorio/privado/de/copias
```

El timer es diario a las 03:00 de Tokio. Una copia en el mismo servidor no sustituye otra fuera de él. El pull usa SSH administrativo, valida esquema e integridad y publica atómicamente con permisos `0600`. La automatización del pull requiere configuración adicional; no se presupone instalada.

Rollback de red: `sudo tailscale serve --https=443 off` desactiva esta ruta. De app: volver al commit/imagen anterior conservando volúmenes. De datos: restaurar snapshot validado sin operaciones en curso. Nunca usar `down -v`, eliminar `kaiwa-codex` ni detener servicios ajenos.

## Verificación reproducible

Ver [procedimientos E2E](../tests/e2e/README.md). Registrar commit, imagen, comandos, condiciones y evidencia.

- Configuración incompleta, secreto falso, identidad ajena, Host/Origin inválidos y WebSocket no autorizado deben fallar de forma cerrada.
- Kaiwa, VOICEVOX y nginx no deben exponer puertos públicos; headers falsificados desde otro contenedor no autorizan.
- HTTPS desde el Mac debe verificar certificado sin `-k`; comprobar navegación, memoria, SSE, TTS y GPT Live en escritorio/móvil emulado.
- El PCM sintético con proveedor real comprueba audio y WebRTC; no acredita micrófono/altavoz físico de un iPhone.
- Reiniciar conserva memoria, ajustes y login; exportar backup fuera de Rushia y comprobar restauración.

La clave actual de Rushia caduca el **28 de octubre de 2026**: renovar o revisar su política antes de esa fecha. No se ha desactivado caducidad ni ampliado permisos de otros nodos.

## Fuentes oficiales

- [Serve e identidad](https://tailscale.com/docs/features/tailscale-serve).
- [CLI Serve y HTTPS](https://tailscale.com/docs/reference/tailscale-cli/serve).
- [API Compose de Dokploy](https://docs.dokploy.com/docs/api/compose).
