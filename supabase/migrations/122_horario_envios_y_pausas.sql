-- 122: horario de envíos propio y pausas temporales de los pedidos online.
--
-- horario_envios: cuándo se hace el envío a domicilio, aparte del horario del local (el local puede atender
-- de 7 a 21 y salir con repartidor solo en ciertas franjas). Mismo formato que horario_pedidos
-- ([{dia, abre, cierra}, ...], admite turnos partidos). null = el envío sigue el horario del local.
--
-- pausas_online: pausas que el personal prende y apaga desde Tenteo, con un motivo que ve el cliente:
--   { "envios":  { "motivo": "Sin repartidor", "desde": "<iso>", "hasta": "<iso>|null", "por": "<uuid>" },
--     "pedidos": { ... } }
-- "envios" suspende solo el envío (se puede seguir retirando); "pedidos" pausa todos los pedidos online.
-- "hasta" null = hasta que alguien la reactive.

alter table public.sucursales
  add column if not exists horario_envios jsonb,
  add column if not exists pausas_online  jsonb not null default '{}'::jsonb;

comment on column public.sucursales.horario_envios is 'Horario del envío a domicilio ([{dia,abre,cierra}]); null = igual al horario del local (horario_pedidos).';
comment on column public.sucursales.pausas_online  is 'Pausas temporales de pedidos online: {envios: {motivo,desde,hasta,por}, pedidos: {...}}.';
