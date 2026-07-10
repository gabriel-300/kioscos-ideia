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
--
-- NOTA: la vista stock_sucursal depende de esta columna (Postgres no deja
-- alterar el tipo de una columna usada por una vista), así que hay que
-- dropearla y recrearla idéntica -- incluye `security_invoker = on` (fix de
-- seguridad de la auditoría 05/07) y el grant de select a `authenticated`
-- (sin `anon`), ambos preservados tal cual estaban.

drop view public.stock_sucursal;

alter table public.movimiento_items alter column cantidad type numeric(12, 4);

create view public.stock_sucursal
with (security_invoker = on)
as
 select m.sucursal_id,
    mi.product_id,
    p.name as product_name,
    p.sku,
    sum(
        case
            when m.tipo = 'entrega' then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad > 0 then mi.cantidad
            else 0
        end) as entradas,
    sum(
        case
            when m.tipo = any (array['devolucion', 'venta']) then mi.cantidad
            when m.tipo = 'ajuste' and mi.cantidad < 0 then abs(mi.cantidad)
            else 0
        end) as salidas,
    sum(
        case
            when m.tipo = 'entrega' then mi.cantidad
            when m.tipo = 'ajuste' then mi.cantidad
            when m.tipo = any (array['devolucion', 'venta']) then -mi.cantidad
            else 0
        end) as stock_actual
   from movimiento_items mi
     join movimientos m on m.id = mi.movimiento_id
     join products p on p.id = mi.product_id
  group by m.sucursal_id, mi.product_id, p.name, p.sku;

grant select on public.stock_sucursal to authenticated;
