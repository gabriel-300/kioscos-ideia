# Liquidaciones de PedidosYa: paso a paso (una vez por semana)

PedidosYa no da API. Una persona baja dos archivos del Portal de PedidosYa y los sube a **Tesorería → PedidosYa**. El sistema
verifica que la cuenta cierre, cruza cada pedido con la venta del kiosco y dice cuándo y cuánto se cobra. No se automatiza el ingreso
al portal: lo hace una persona, a mano.

Quién puede cargar: el administrativo de Tesorería (Staff → «Es administrativo»). Los demás socios y administradores ven todo.

## 1. Bajar los archivos del portal

1. **CSV de pedidos.** Portal → **Pedidos** → elegir las fechas de la semana (lunes a domingo) → **Descargar informe** → CSV. Se llama
   `orderDetails.csv`.
2. **Estado de cuenta.** Portal → **Finanzas** → elegir la semana → **Ver detalle** → **Descargar** → **Estado de Cuenta**. Baja un `.zip` con:
   - un **Excel** (`…estado-de-cuenta_….xls`: se llama `.xls` pero es un Excel moderno, el sistema lo detecta solo),
   - un **PDF**.
   La factura (el otro `.zip`) no hace falta.

El estado de cuenta se publica unos días después de cerrar la semana: **no se puede confirmar la liquidación antes**.

## 2. Subirlos al sistema

En **Tesorería → PedidosYa → Importar la liquidación semanal**:

1. Elegí el **CSV**, el **Excel** y (como respaldo) el **PDF**. Se abren en tu navegador; no hay datos de clientes en el CSV.
2. Revisá el **período** (lunes a domingo).
3. Copiá del **PDF** los importes del estado de cuenta, **tal como figuran** (los descuentos con signo menos):

   | En el formulario | En el PDF |
   |---|---|
   | Total liquidado | «Total liquidado del … al …» |
   | Publicidad en la aplicación | «Publicidad dentro de la aplicación» (ej. −11.121,55) |
   | Impuesto en comisiones - IVA | «Impuesto en comisiones - IVA» (ej. −8.814,61) |
   | Retenciones fiscales (SIRTAC) | «Retenciones Fiscales (SIRTAC)» (ej. −3.668,00) |
   | Reintegros / Ajustes / Saldo pendiente | los de «Reintegros», «Ajustes de liquidación», «Saldo pendiente liquidación anterior» (0 si no hay) |
   | Fecha de pago | «El día dd/mm/aaaa procesaremos el pago» |
   | Cuenta destino | «PSP PEYA terminada en …» (opcional) |

   Si todavía no tenés el estado de cuenta, destildá «Tengo el estado de cuenta»: se guarda como **estimada** y se confirma después.
4. Tocá **Revisar**. Mirás la vista previa:
   - Tiene que decir ✔ en todas las verificaciones y **«neto a la billetera» igual al «Total liquidado»**. Si no cierra, **no se puede confirmar**: te muestra
     la diferencia (casi siempre es un importe mal copiado o un signo).
   - Cuántos pedidos se cruzaron con una venta del kiosco, cuáles están en PedidosYa pero **no cargaron en el sistema**, cuáles tienen otro importe.
   - La fecha de cobro y si cambió el plazo.
5. **Confirmar y guardar.** Los archivos originales quedan guardados (quién los subió y cuándo).

Subir la misma semana de nuevo **no duplica** nada: actualiza la liquidación (sirve para confirmar una estimada).

## 3. Cuando llega la plata

PedidosYa transfiere cada semana de la PeYa Wallet a **Mercado Pago**. En **PedidosYa → Ver** (la liquidación) → **Registrar que el cobro llegó**: el sistema
sugiere el movimiento de Mercado Pago que coincide (hay que haber importado antes el Excel de cobros de MP). Si el monto no es el esperado, queda la diferencia.

## Cómo cierra la cuenta (para entender el control)

```
neto a la billetera = Σ «Ingreso estimado» de los pedidos (el cancelado va en negativo)
                    + publicidad + IVA de la publicidad + retenciones SIRTAC + reintegros + ajustes + saldo anterior   (con el signo del PDF)
IVA de la publicidad = «Impuesto en comisiones - IVA» del PDF + Σ «Impuesto» de los pedidos
```

Semana de ejemplo 05/10–11/10/2026: 54.368,10 − 11.121,55 − 2.335,51 − 3.668,00 = **37.243,04** = «Total liquidado». Los porcentajes (comisión 23 %, IVA
21 %, SIRTAC) se toman de los archivos y se muestran solo como dato informativo: no se fijan en el sistema.

## Lo que todavía no está resuelto

- **Pedidos en efectivo** (el repartidor cobra y PedidosYa descuenta la comisión de otros pagos): las columnas existen pero no hay un archivo real de ejemplo.
  Esos pedidos quedan «pendiente de validar» y no se asume ninguna regla contable. Hace falta una semana con efectivo para definirla.
- **Reintegros, notas de crédito y ajustes posteriores:** se cargan como importes del estado de cuenta (con nota); no hay reglas inventadas.
- **Varias tiendas:** una importación = una tienda. La equivalencia tienda de PedidosYa → local sale de `sucursales.pedidoya_store_id` (hoy, 626966 = Parque de las Fiestas).
- **Leer el PDF automáticamente:** por ahora los importes del PDF se copian a mano (se verifican contra el Total liquidado).
