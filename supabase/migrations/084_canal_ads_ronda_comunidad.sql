-- Fase 0 del brief de comunidades/rondas de Javier (ver conversacion con
-- Gabriel, set. 2026): antes de construir nada nuevo, contactos_crm.canal
-- necesita poder distinguir contactos que vengan de una campana paga (Meta
-- Ads) o de una ronda de entrega a una comunidad, ademas de los canales que
-- ya tiene (whatsapp/instagram/pedidosya/otro). Sin esto, esos contactos
-- quedarian mal clasificados como "otro" y no se podria filtrar por origen
-- en los informes que se armen despues.

alter table public.contactos_crm drop constraint contactos_crm_canal_check;

alter table public.contactos_crm add constraint contactos_crm_canal_check
  check (canal in ('whatsapp', 'instagram', 'pedidosya', 'otro', 'ads', 'ronda_comunidad'));
