-- 126: calificación del cliente al recibir su pedido online (estrellas y un comentario opcional).
--
-- Una sola calificación por pedido (pedido_id es la clave): el cliente la deja desde la página de
-- seguimiento cuando el pedido ya está entregado. Se guarda para que el local vea cómo le fue.
--
-- Acceso: ninguno desde el navegador. RLS activada y SIN policies (deny-all para anon/authenticated); todo
-- pasa por Server Actions con el cliente admin, que validan que el pedido exista, sea de esa sucursal y
-- esté entregado (src/lib/pedidos/calificacion.ts). Mismo criterio que pedido_mensajes.

create table if not exists public.pedido_calificaciones (
  pedido_id  uuid primary key references public.pedidos(id) on delete cascade,
  estrellas  smallint not null check (estrellas between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.pedido_calificaciones enable row level security;
