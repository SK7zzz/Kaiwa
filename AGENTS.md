# Kaiwa personal de Ado

Aplicación local FastAPI + JavaScript sin framework. Mantener el stack y los formatos del proyecto. La interfaz y las explicaciones pedagógicas están en español; la práctica está en japonés. Nombre, nivel, intereses y objetivos son editables.

## Proveedores

- `server/codex_provider.py`: texto/JSON con el protocolo oficial Codex app-server.
- `server/codex_voice_rpc.py` y `server/codex_voice.py`: conexión independiente de voz WebRTC y persistencia de transcripciones.
- `server/memory.py` y `server/companion.py`: hechos personales, historial persistente y asistente; `web/personal.js` integra memoria y práctica por tema. La memoria pertenece a esta app, no a ChatGPT. Mantener la distinción entre datos reales y personajes de práctica; editar/olvidar invalida contexto histórico sin eliminar transcripciones.
- `server/codex_policy.py`: límites compartidos del tutor. Conservar directorios temporales, threads efímeros, sandbox de solo lectura y herramientas/integraciones desactivadas.
- Las credenciales pertenecen a Codex. No leer tokens, copiar cookies ni convertir esta integración en peticiones autenticadas con credenciales extraídas. El proveedor de suscripción elimina API keys heredadas de su entorno.
- GPT Live es experimental. Confirmar cualquier cambio contra el esquema generado por la CLI instalada y documentación oficial.

## Entorno y pruebas

`./setup.sh` instala dependencias; `./run.sh` escucha en loopback. Los recursos offline y el acceso Tailscale son opciones explícitas. No arrancar servidores duplicados ni parar procesos ajenos.

Comprobaciones relevantes:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python -m compileall -q server
node --check web/app.js
node --check web/personal.js
node --check web/codex-voice.js
bash -n run.sh setup.sh
git diff --check
```

La implementación requiere E2E sobre el resultado integrado; los controles anteriores no los sustituyen. Usar `tests/e2e/README.md` y `node tests/e2e/run.mjs` con una base **nueva, aislada** mediante `KAIWA_DB_PATH`. Las llamadas reales consumen cuota de la suscripción. Conservar informes/trazas sin incluir datos personales, credenciales ni bases SQLite en el commit. No escribir pruebas unitarias después de implementar; cuando hagan falta pruebas aisladas, diseñar los fallos y escribirlas primero.

Revisar el diff, hacer commit, push a la rama de trabajo y confirmar su SHA remoto. No fusionar ni publicar releases por este cierre. Mantener licencia AGPL y atribución upstream.
