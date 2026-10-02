# Riesgos definidos antes de implementar la adaptación

1. Suscripción: Codex instalado pero sin sesión, o CLI ausente, se confunden con una conexión válida. El onboarding debe mostrar una acción de recuperación y no pedir API key.
2. Perfil: el nombre, nivel y proveedor elegidos se pierden al recargar o no llegan al tutor.
3. Streaming: el tutor devuelve un HTTP 200 pero un error SSE, el indicador queda bloqueado o el mensaje no queda persistido.
4. Correcciones: una frase con error claro pasa como correcta, las explicaciones aparecen en inglés o no se guarda el patrón de error.
5. Ayudas: traducción o sugerencias devuelven JSON inválido, quedan en carga, contienen HTML ejecutable o la sugerencia no puede trasladarse al compositor.
6. Vocabulario/SRS: guardar una palabra desde el texto no añade tarjeta; repetir guardado la duplica; evaluar la tarjeta no modifica su vencimiento.
7. Resumen: cerrar la sesión deja un modal en carga, pierde el historial o muestra datos de otra sesión.
8. Móvil: navegación, lectura y tarjetas quedan fuera de pantalla o la persistencia difiere del escritorio.
9. Errores HTTP: sesiones o mensajes inexistentes disparan trabajo del proveedor, devuelven un éxito engañoso o un traceback.
10. Privacidad de pruebas: se modifica el perfil real o se incluyen llaves/API/credenciales en artefactos.

El recorrido principal usa el proveedor Codex real. Los estados CLI ausente/sin login sólo interceptan health/profile en el navegador para verificar su representación visual; no acreditan esos fallos del backend. Los negativos HTTP no usan mocks.

## Voz experimental con suscripción

11. Negociación WebRTC completa pero el tutor sólo envía audio; la voz del alumno no llega o no se transcribe. Verificar por separado RTP de entrada/salida, energía de audio y un mensaje `user` japonés persistido procedente de una frase WAV conocida.
12. El saludo inicial del tutor se confunde con una respuesta a la intervención del alumno. Exigir un mensaje `assistant` posterior al mensaje `user` dentro de la misma sesión.
13. El micrófono queda silenciado antes de completar la captura. Esperar transcripción del alumno antes de probar mute/unmute y comprobar el estado de la pista.
14. La reproducción en bucle provoca múltiples turnos sintéticos e invalida el resumen. Usar WAV con silencio inicial/final y `%noloop` para una única intervención.
15. Cerrar la llamada pierde transcripciones pendientes o deja sockets/pistas activos. Comprobar cierre de overlay, `codexCall === null`, resumen disponible e historial de ambos interlocutores.
16. Permiso de micrófono denegado crea una sesión vacía o deja una llamada bloqueada. Inyectar exclusivamente `getUserMedia -> NotAllowedError` para comprobar recuperación visual; este negativo no acredita el diálogo nativo de permisos del sistema.

El micro usa un WAV sintético generado con macOS Kyoko; proveedor, WebRTC, transcripción, persistencia y resumen son reales. No se evalúan acento/pronunciación humanos, ruido ambiental, interrupciones ni disponibilidad futura de la interfaz experimental de Codex.

## Renovación visual y accesibilidad: riesgos definidos antes de escribir el recorrido

17. El logo o la ilustración personalizada se referencian con una ruta incorrecta, no cargan o pierden su alternativa textual. Verificar carga real, dimensiones intrínsecas y nombre accesible de la marca.
18. Búsqueda y categoría se contradicen: una tarjeta ajena queda visible, una lección nunca se filtra, limpiar no recupera el catálogo o un resultado vacío no explica cómo recuperarse. Usar el catálogo real y combinar filtros.
19. Tarjetas que parecen botones sólo responden al ratón. Verificar elementos nativos y abrir/cancelar las opciones personalizadas mediante teclado, sin iniciar sesiones ni consumir IA.
20. Un diálogo deja escapar el foco al fondo, Escape no cancela o cerrar pierde el foco de origen. Comprobar Tab/Shift+Tab, Escape y restitución en escena e historia; onboarding conserva su bloqueo.
21. Navegación visual y accesible divergen: varias vistas activas o ausencia de `aria-current`. Recorrer las seis pantallas, controles de Ajustes y acciones de estados vacíos.
22. La interfaz renovada desborda a 320/390 px o esconde controles de búsqueda, navegación o cierre. Adjuntar capturas y medidas de ancho por pantalla y tamaño.
23. La prueba depende del vocabulario/historial creado por otra prueba o modifica el perfil real. Interceptar exclusivamente perfil sintético, colecciones vacías y guardado del perfil en el navegador; conservar catálogo, imágenes y demás UI reales. Bloquear y contar cualquier intento de crear una sesión.
24. Las vistas vacías caben en móvil, pero un informe con textos largos o barras de corrección desborda el contenedor principal. Representar además Progreso con una sesión y categorías sintéticas a 320 px; medir el contenedor que realmente se desplaza.
25. Enter al confirmar composición japonesa se interpreta como enviar y pierde el texto parcial. Con una conversación completamente sintética, despachar Enter con `isComposing` y código 229; exigir cero envíos adicionales y luego un único envío con Enter normal. Comprueba el manejo del evento del navegador, no un IME nativo del sistema.
26. Guardar Ajustes recibe 503 pero muestra «Guardado», deja bloqueado el botón o pierde los datos del formulario. Interceptar sólo el fallo de guardado, comprobar el mensaje explícito y reintentar con el mismo formulario sintético.
27. Cargar vocabulario recibe 503 y la vista queda vacía, falla JavaScript o no permite recuperación. Representar la respuesta HTTP fallida y después una colección vacía válida; comprobar el estado de error y el botón de reintentar.
28. La llamada se superpone visualmente pero el teclado continúa en la aplicación de fondo, o los toggles de micrófono/subtítulos no exponen su estado. Extender el recorrido real de voz: diálogo modal, fondo `inert`, foco inicial, ciclo Tab/Shift+Tab y `aria-pressed` sincronizado con los toggles. Después de cerrar el permiso denegado, exigir fondo utilizable y restitución del foco al botón de voz. Conservar proveedor y audio reales del recorrido existente.
29. Escape en un informe terminado no cierra o conserva el fondo bloqueado. Exigir cierre y foco útil en el CTA de Inicio; no depende de una sesión persistida porque el informe de esta prueba es sintético.
30. Crear sesión devuelve 503 y se abre un chat con `session_id` inexistente. Comprobar error accesible en Inicio, botón recuperado, ausencia de sesión/streaming y reintento válido.
31. Pistas devuelve 503 y no hay recuperación dentro del panel. Mostrar error y botón de reintentar; después una sugerencia utilizable que se traslada al compositor.
32. Guardar vocabulario falla con 503 pero la palabra queda marcada como guardada. Verificar separadamente popup, informe y diccionario: estado de error junto al botón habilitado, ningún marcador falso y éxito al reintentar.
33. Navegar fuera de Ajustes borra el borrador o la selección de nivel, y el guardado global está escondido dentro de una tarjeta. Exigir «Cambios sin guardar», conservar campos/nivel al volver, `aria-pressed` correcto y barra de guardado fuera de la cuadrícula.
34. La página final de lectura todavía permite responder y añadir preguntas indefinidamente, o el tutor invita a responder aunque ya no exista formulario. En el recorrido real de las tres preguntas, exigir formulario oculto, una única acción de finalizar y un cierre sin nuevas preguntas.

`ui.spec.mjs` no evalúa el proveedor ni la persistencia del perfil: sus respuestas sintéticas aíslan estados vacíos y cambios reversibles de Ajustes. La persistencia real y las conversaciones siguen verificándose en los recorridos existentes. Las capturas son evidencia complementaria de navegación/acciones y medidas, no sustituyen esas comprobaciones.

## Asistente personal, memoria y temas: definidos antes de implementar

35. La memoria guarda una preferencia pero desaparece al recargar, no llega al asistente o no se incorpora a la siguiente práctica. Usar un perfil aislado, una banda ficticia y una petición de práctica que exige recuperar ese nombre sin repetirlo; comprobar SQLite a través de la API y respuestas reales de Codex.
36. Editar u olvidar una memoria sólo cambia la pantalla; la API conserva el contenido antiguo o reaparece al recargar. Crear, editar, cancelar el olvido y confirmar el olvido mediante UI; exigir persistencia de cada estado en la API y tras recargar. Editar además la preferencia extraída automáticamente y preguntarla de nuevo al asistente real; después olvidarla y exigir que no recupere ni la versión anterior ni la corregida del historial conservado.
37. El asistente atribuye al usuario hechos de una escena ficticia. Introducir una profesión expresamente simulada en el roleplay de peluquería y exigir que no se guarde como memoria personal. Sólo la conversación del asistente puede extraer recuerdos automáticamente.
38. Un POST del asistente recibe 503 y la UI pierde la petición, muestra una respuesta inventada o deja bloqueado Enviar. Interceptar ese POST y el GET del navegador posterior al éxito sintético para verificar error, conservación del texto y reintento; demostrar que el fallo no muta el historial real.
39. Un recuerdo vacío, categoría inválida o referencia inexistente devuelve éxito, cambia otra memoria o dispara IA. Usar HTTP reales de validación/404 y comprobar que el historial permanezca idéntico.
40. Elegir un tema inicia una sesión accidentalmente, omite el contenido/modo seleccionado o acepta un tema vacío. Los presets sólo rellenan el formulario; la sesión de peluquería usa roleplay, la de música lesson, y ambas generan mensajes e informes reales.
41. La séptima opción de navegación, un tema largo o una memoria extensa vuelve inaccesible Asistente en móvil. A 320/390 px navegar a Inicio/Asistente, alternar conversación/memoria, comprobar controles visibles y medir el ancho del documento y del contenedor principal.
42. La prueba aprende datos personales o arranca sobre la base real. Antes de cualquier mutación o IA, exigir nombre `Ado E2E`, objetivo `Datos sintéticos E2E`, proveedor Codex y autoplay desactivado. Datos, capturas y trazas contienen exclusivamente contenido sintético; no se incluyen bases SQLite ni credenciales en la evidencia ni en el commit.
43. Una exportación omite recuerdos/historial, restaurar no recupera su contenido exacto o importar un backup anterior falla porque no contiene las tres tablas nuevas. Exportar por HTTP un snapshot sintético con memoria, modificar y restaurar; comparar recuerdos e historial. Transformar únicamente una copia temporal sintética eliminando `personal_memories`, `companion_messages` y `memory_context_state`, importarla y comprobar colecciones vacías y un guardado nuevo. Restaurar en `finally` el snapshot original y eliminar los ficheros temporales. Los bytes SQLite no se adjuntan al informe ni a trazas ni se guardan en el repo.

44. El modelo recuerda correctamente un nombre latino con espacios, pero la anotación de furigana elimina los espacios y la UI cambia el nombre. El recorrido real de música exige el nombre exacto «Nebula Prisma E2E» en la respuesta visible. La primera pasada reproduce el fallo antes de corregir la anotación.

`personal.spec.mjs` se escribe antes de los handlers de memoria/asistente/temas. El recorrido principal usa APIs, persistencia y Codex reales. El negativo 503 sólo representa el fallo del cliente y una respuesta de recuperación sintética; no acredita una caída real del proveedor. Los controles de móvil usan los datos sintéticos ya persistidos y no acreditan Safari ni un dispositivo físico.
