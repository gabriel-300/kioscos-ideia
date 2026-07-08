-- Auditoria 06/07, menor: ~84 filas de movimiento_items (ventas por kg pagadas
-- "por monto $") tienen un `cantidad` que no reproduce el `subtotal` guardado
-- al multiplicar por `precio_unitario` -- hasta ~$130 de diferencia visual en
-- historial/exportación Excel. NO afecta lo cobrado real (`subtotal` siempre
-- fue exacto), es puramente un problema de precisión de columna.
--
-- Causa: venta-rapida-form.tsx (setMonto) calcula `kg = monto / precioKg` SIN
-- redondear, a propósito, para cobrar el monto exacto tipeado -- pero la
-- columna `cantidad numeric(10,2)` solo guarda 2 decimales (10g de precisión
-- para un producto en kg), así que Postgres trunca ese valor al insertar.
--
-- Fix: ampliar la columna a numeric(12,4) (0,1g de precisión) -- ensanchar una
-- columna numeric nunca pierde datos existentes (los valores ya guardados
-- entran exactos en la precisión nueva, más ancha). Las ~84 filas históricas
-- ya redondeadas quedan como están -- esto solo evita que se repita hacia
-- adelante.

alter table public.movimiento_items alter column cantidad type numeric(12, 4);
