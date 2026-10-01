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
