-- 123: efectivo en los pedidos online, por sucursal.
--
-- efectivo_online: la sucursal acepta que el cliente elija "Efectivo" al pedir en la tienda. Aun así solo
-- lo puede elegir un cliente que ingresó con Google (el servidor lo exige): un pedido en efectivo se paga
-- en la puerta y sin cuenta no hay a quién reclamarle si no aparece. Sin esta columna, todo es Mercado Pago.
-- Hoy se habilita solo UNAM.

alter table public.sucursales
  add column if not exists efectivo_online boolean not null default false;

update public.sucursales set efectivo_online = true where id = '4af1ad9f-cd2f-47cd-974d-2bc8037db9a4';
