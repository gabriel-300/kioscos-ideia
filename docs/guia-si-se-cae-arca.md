# Qué hacer si ARCA no responde

Guía corta para el personal de los locales y para el administrador. Escrita para quien no es técnico.

**Lo principal: una venta nunca se frena porque ARCA esté caída.** La venta se registra igual, se cobra igual y el stock se descuenta igual. Lo único que puede demorar es la factura.

## Para el cajero

**Cómo me doy cuenta:** al cobrar con QR, transferencia o con «Emitir factura», el sistema espera hasta 8 segundos a ARCA. Si no responde, el cobro se confirma igual y aparece un aviso de que la factura quedó pendiente (no sale el ticket fiscal).

**Qué hago:**
1. **No repetir la venta ni volver a cobrar.** La venta ya está registrada.
2. Entregar el ticket interno (sin validez fiscal) si el cliente lo pide.
3. Seguir trabajando normal. La factura se emite sola: el sistema reintenta **cada 10 minutos**.
4. Más tarde, entrar a la sucursal > **«Facturas emitidas»** y buscar la venta (por importe o por número). Cuando ya tenga número y CAE, se puede imprimir.
5. Si el cliente necesita la factura en el momento y no salió: tomar su DNI o CUIT, y avisar al administrador. No emitir una segunda factura de la misma venta.

**Lo que NO tengo que hacer:** apretar «Facturar» varias veces, anular la venta para volver a hacerla, ni cobrarle de nuevo al cliente.

## Para el administrador

1. Entrar a **Admin > Facturación**. Arriba aparece **«Para revisar»** con las facturas que no se pudieron emitir.
2. **«pendiente»**: ARCA no respondió y se está reintentando sola. Si hace falta apurarla, apretar **«Reintentar pendientes»**.
3. **«error»**: ARCA la rechazó (el mensaje dice el motivo). No se reintenta sola. Si es una prueba o no hace falta, **«Descartar»**; si fue un error de datos (CUIT mal cargado, por ejemplo), descartarla y volver a emitir la factura desde el botón **«Facturar»** del historial de la venta (se puede hasta 7 días después).
4. Para comprobar si ARCA está funcionando: **«Probar conexión con ARCA»** en la misma pantalla. Muestra el último comprobante de cada punto de venta.
5. Si ARCA estuvo caída mucho tiempo y quedaron muchas pendientes, no hay que hacer nada especial: se emiten solas apenas vuelve. Si alguna sigue rechazada por la fecha, avisar al desarrollador.

## Casos que se ven seguido

| Qué pasa | Qué significa | Qué hacer |
|---|---|---|
| «ARCA no respondió» / pendiente | ARCA lenta o caída | Esperar; se reintenta sola cada 10 min |
| Rechazo con un mensaje de CUIT o documento | Dato mal cargado | Descartar y volver a facturar con el dato correcto |
| «10000: no autorizado a emitir comprobantes clase A» | ARCA no habilita la Factura A común a la SAS | Usar la Factura A «sujeta a retención» (ya configurada); si aparece, avisar al administrador |
| La factura no figura en ARCA a las pocas horas | Demora normal de ARCA | Esperar; confirmar con el contador en «Mis Comprobantes» |

## Cuándo avisar

Avisar al administrador (y este al desarrollador) si:
- hay facturas «pendiente» que siguen sin emitirse **después de 1 hora**;
- «Probar conexión con ARCA» falla de forma repetida;
- hay un rechazo con un mensaje que no se entiende.
