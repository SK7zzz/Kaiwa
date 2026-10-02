# Kaiwa para Ado: revisión de UI y UX

Fecha: 2 de octubre de 2026. Rama: `ado/spanish-codex-tutor`.

## Diseño e identidad

La interfaz usa marfil, tinta verde y terracota, títulos editoriales y tarjetas de práctica con acciones explícitas. Se revisaron Inicio, conversación, lectura, llamada, repaso, palabras, diccionario, Progreso, Ajustes y los diálogos de onboarding, cambio de sesión e informe.

Se generaron con la herramienta integrada **GPT Image / image_gen** un símbolo original de dos burbujas de conversación y cuatro ilustraciones: barrio japonés, ramen, tren y escritorio de estudio. Los prompts exactos están en [brand-prompts.json](brand-prompts.json). Los archivos finales están en [web/brand](../web/brand): logo PNG transparente, tres tamaños de icono y cuatro WebP de 960 × 640. El conjunto pesa aproximadamente 832 KiB. La preparación de archivos sólo redimensionó y comprimió las imágenes generadas.

El catálogo conserva el contenido original; añade búsqueda combinable con categorías, contador de resultados y recuperación del estado vacío. Repaso y palabras orientan hacia la próxima práctica cuando todavía no hay datos. El manifiesto y los iconos usan la nueva identidad.

## Revisión solicitada con Opus

Se ejecutaron dos revisiones independientes con **Claude Opus 5.5**, esfuerzo **high**, mediante la CLI instalada. Las respuestas identificaron el modelo `claude-opus-5-5`, sin errores ni denegaciones de herramientas. Invocación utilizada:

```sh
claude --model claude-opus-5-5 --effort high --safe-mode \
  --tools Read,Glob --allowedTools Read,Glob \
  --no-session-persistence --output-format json -p '<instrucciones de revisión>'
```

El revisor leyó código y capturas seleccionadas; no manejó el navegador ni verificó por sí mismo todas las pantallas. La primera tanda de capturas tenía algunas vistas todavía cargando: esa limitación se aclaró en la segunda revisión. Los resultados originales se conservan localmente en `work/ui-review/opus-before.json` y `opus-after.json`, fuera del commit. Sus conclusiones se contrastaron con código, interacción real y los E2E.

Problemas detectados y corregidos:

- Diálogos y llamada: foco inicial, Tab/Shift+Tab, fondo `inert`, Escape y devolución del foco; micrófono, subtítulos y niveles comunican su selección con `aria-pressed`.
- Guardar palabras: popup, informe y diccionario muestran errores reales, conservan el botón para reintentar y sólo anuncian éxito tras una respuesta válida.
- Ajustes: barra global de guardado, borrador conservado al navegar, mensaje de cambios pendientes y recuperación de errores sin perder el formulario.
- Inicio y pistas: un fallo al crear sesión no abre una sesión inexistente; el panel de pistas ofrece reintento.
- Lectura: después de tres respuestas hay un único cierre y no otro formulario; el prompt del tutor también termina sin invitar a continuar. La historia señala el botón para comenzar las preguntas.
- Informe: Escape cierra el informe terminado; durante su generación se puede volver a la sesión. El foco se recupera en una acción visible.
- Compositor: confirmar una composición japonesa no envía el texto prematuramente. Se corrigieron etiquetas, contadores en singular y formato español del historial.

## Verificación reproducible

La suite integrada usa una base nueva y aislada, proveedor Codex real y datos sintéticos. Las pruebas de UI aíslan mediante interceptaciones explícitas estados vacíos, borradores y fallos HTTP. No se atribuye persistencia backend a esas interceptaciones. Consulta [los requisitos y alcances](../tests/e2e/README.md) y [los riesgos definidos](../tests/e2e/FAILURE-MODES.md).

Comandos de esta ejecución, desde la raíz del repositorio:

```sh
KAIWA_DB_PATH=/Users/ado/Documents/Codex/2026-09-25/hay/work/ui-review/kaiwa-ui-003.db ./run.sh --no-browser

KAIWA_E2E_VOICE_FIXTURE_DIR=/Users/ado/Documents/Codex/2026-09-25/hay/work/ui-review/voice \
  node tests/e2e/run.mjs
```

Para repetir, sustituye la base por un archivo nuevo. No borres ni reutilices `data/kaiwa.db`.

La evidencia se genera en `tests/e2e/artifacts/report/index.html`, `result.json` y `results/`, con trazas y capturas. Se recorren las seis vistas principales a 320 y 390 px, además de escritorio; las métricas exigen ausencia de desbordamiento tanto en la página como en su contenedor principal. Las acciones incluyen búsqueda, filtros, teclado, diálogos, formularios, errores y reintentos. Los recorridos reales incluyen conversación/corrección/traducción, vocabulario y SRS, lección, escena, lectura completa y voz con audio bidireccional, transcripción y resumen.

**Resultado final: 26/26 E2E aprobados en una única ejecución integrada, sin reintentos, omitidos ni fallos (3,2 minutos).** Los 15 recorridos de UI y los 11 de integración/voz se ejecutaron sobre el resultado conjunto. Las trazas y capturas son locales y están excluidas del commit; el código y el procedimiento reproducible se conservan en el repositorio.

También se comprueba sintaxis JavaScript, compilación Python, los seis contratos existentes del proveedor y `git diff --check`. Estos controles no sustituyen los E2E.

## Límites

Los viewports móviles se comprueban en Chrome; no se ha certificado Safari/iPhone físico ni instalación PWA. El recorrido de composición japonesa despacha eventos del navegador y no acredita un IME del sistema operativo. No se ha realizado una auditoría completa con lector de pantalla. La voz usa una frase japonesa sintética de macOS Kyoko y el proveedor real; no evalúa pronunciación humana, ruido ni interrupciones. La disponibilidad futura de GPT Live experimental depende de Codex y de la cuenta.

La revisión conserva el stack FastAPI/SQLite/JavaScript del proyecto. Los resultados anteriores de la integración del proveedor siguen documentados en [verification.md](verification.md).
