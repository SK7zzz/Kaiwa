# Amadeus / Kaiwa

Personalización visual del 15 de octubre de 2026. Implementación con Codex;
ilustración con la herramienta integrada GPT Image. El proveedor y las reglas
del tutor siguen siendo los de Kaiwa.

## Identidad

Steins;Gate y Amadeus inspiran el laboratorio negro/grafito, los acentos ámbar,
la marca angular y la presencia de Kurisu. Los rótulos técnicos usan fuentes
locales monoespaciadas; español y japonés conservan tipografía de lectura.
No hay fuentes remotas, sonidos automáticos ni efectos de parpadeo.

El tema abarca Inicio, Asistente y memoria, conversación, lectura, repaso,
palabras, diccionario, progreso, ajustes, onboarding, diálogos, informes y GPT
Live. El retrato aparece en Inicio, Asistente y la llamada, también en móvil.
Los estados de carga/error, foco, controles y movimiento reducido mantienen su
semántica. Se conservan los 179 IDs anteriores y las funciones de aprendizaje.

Se añadieron una marca SVG y exportaciones PNG de 180/192/512 px para PWA/iOS.
La ilustración WebP mide 1672 × 941 y pesa 109.946 bytes. Se reutiliza en las
distintas superficies y sustituye las ilustraciones claras del diseño anterior.
[Procedencia y prompt exacto del arte](amadeus-art.json).

## Verificación y estado

El 15 de octubre de 2026 pasaron **20/20 E2E**, sin omisiones ni reintentos,
en Chrome sobre FastAPI/Uvicorn real con SQLite temporal aislada (22,7 s en la última pasada).
Incluyen los 15 recorridos UI existentes y cinco del tema: siete vistas a
1440/390/320 px, japonés/furigana, conversación sintética, carga/error/reintento,
contraste, teclado, diálogos, movimiento reducido y retrato de la llamada.
Se revisaron las capturas de escritorio y móvil, ajustes, asistente e informe.
La revisión detectó etiquetas demasiado juntas a 320 px: una prueba E2E
reprodujo el fallo antes de abreviar Léxico/Nivel y separar las etiquetas,
conservando sus nombres accesibles completos.

Las respuestas del tutor y las interacciones de voz son sintéticas en esta
pasada. No consume cuota ni acredita una llamada real o un micrófono físico;
el proveedor, autenticación y lógica pedagógica no han cambiado.

También pasaron sintaxis JavaScript, IDs preservados/sin duplicados,
referencias de assets, SVG/XML, manifest/JSON y `git diff --check`.
[Registro saneado](evidence/amadeus-2026-10-15.json). Informe y trazas privados:
`work/amadeus/ui-r2/report/index.html`, relativos al workspace.

El tema está **desplegado en [Rushia privado](https://rushia-1.tail7bb611.ts.net)**
desde el commit `cfe4eb19b764ff33a5847f317e0ade9af686b341`, mediante Dokploy.
Se comprobaron HTTPS real, seis recursos idénticos al checkout por SHA-256,
siete endpoints JSON y Codex preparado. La revisión de navegador real cubrió
Inicio/Asistente en escritorio y memoria/Inicio/navegación a 390/320 px.
No hubo mutaciones de prueba en producción.

Las copias consistentes anterior y posterior tienen integridad SQLite correcta
y sus ocho tablas coinciden exactamente, incluidos perfil y ajustes. Se
conservan los tres volúmenes. Tailscale Serve mantiene HTTPS, sin Funnel;
el proxy sólo publica loopback y rechaza identidad ausente o ajena (403).
El redeploy produjo un error transitorio de carga durante la sustitución del
contenedor; la recarga y los endpoints reales pasaron después de quedar sano.

[GitHub Actions: 20/20 E2E aprobados en Linux/Chromium](https://github.com/SK7zzz/Kaiwa/actions/runs/38754525715).
El artefacto contiene informe, trazas y capturas sintéticas, con retención de
siete días. La primera publicación del workflow falló al usar `runner.temp`
en el contexto de job; se corrigió preparando rutas mediante `$GITHUB_ENV`.

## Procedimiento reproducible

Con las dependencias del proyecto y Playwright 1.62.1/Chrome disponibles:

```sh
KAIWA_E2E_CHANNEL=chrome \
KAIWA_E2E_PYTHON=.venv/bin/python \
KAIWA_E2E_ARTIFACTS=/directorio/privado/amadeus-ui \
node tests/e2e/ci-run.mjs
```

El runner crea su SQLite temporal, exige puerto libre y perfil vacío, ejecuta
`ui.spec.mjs` y `amadeus.spec.mjs`, conserva informe/trazas y limpia sus procesos.
El workflow `UI E2E` prepara este mismo entorno en Linux con Chromium y conserva
evidencia siete días. Ver [procedimiento E2E](../tests/e2e/README.md) y
[despliegue privado](deployment.md).
