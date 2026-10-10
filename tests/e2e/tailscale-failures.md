# Tailscale: fallos definidos antes de implementar

Datos exclusivamente sintéticos, SQLite temporal, puerto efímero y sin llamar a modelos.

1. Anónimo o identidad falsificada sin secreto: denegar UI, assets, API privada, exportación y WS.
2. Secreto ausente, incorrecto, vacío o repetido; identidad ausente, distinta, con coma o repetida: 403 HTTP/WS. Sólo secreto correcto + login exacto permite acceso.
3. Host alternativo/repetido, Origin ausente/ajeno/repetido, Sec-Fetch-Site cross-site: impedir mutaciones y WS; SQLite permanece intacta.
4. Healthcheck local expone sólo status; headers de proxy, Tailscale o secreto no eluden autenticación. Respuestas autorizadas/denegadas conservan cabeceras de seguridad.
5. Configuración incompleta, proveedor desconocido, modo local con configuración hospedada, origen HTTP, login múltiple, archivo inexistente o secreto menor de 256 bits: falla el arranque antes de servir.
6. Propietario sintético llega al handler de voz (101) sin iniciar proveedor; creación/edición de memoria, exportación/restauración y reinicio conservan datos.
7. Renderer real aislado: root obligatorio, destinos symlink rechazados, marcador ausente/duplicado rechazado antes de escribir; secreto 256 bits privado, configuración atómica, reejecución conserva secreto y no imprime credenciales.

Las pruebas se escriben antes de cambiar server/security.py/server/main.py. El renderer se prueba por CLI real como root en un directorio temporal independiente. Ninguna prueba usa 8130 ni datos personales.
