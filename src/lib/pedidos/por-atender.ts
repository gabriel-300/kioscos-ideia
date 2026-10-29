import type { createAdminClient } from "@/lib/supabase/server";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";
import type { PedidoAviso } from "./aviso";
import { cargarLineasDePedidos } from "./lineas-servidor";
import { urlMapa } from "./ubicacion";

// Qué pedidos online esperan una acción del local y a qué sucursales puede
// mirar cada usuario. Lo comparten la pantalla de pedidos online y el aviso de
// pedido nuevo del menú, para que el contador y la lista digan lo mismo.
// Sin "use server": solo lo llaman Server Actions y páginas que ya validaron
// el rol.

type Admin = ReturnType<typeof createAdminClient>;

// Pedidos que entraron y el local todavía no aceptó: efectivo confirmado (se
// cobra en la puerta) y Mercado Pago ya pagado.
const ESTADOS_NUEVOS = ["confirmado", "pagado"];

export type PedidoParaContar = { estado: string; medio_pago: string | null; expira_en: string | null };

// Un pago por link pendiente solo se muestra en la lista (grupo "Esperando pago") mientras no venció; vencido o con
// otro medio de pago (QR abandonado) es ruido. NO cuenta como "por atender": el cliente paga solo desde Mercado Pago y
// el local no tiene nada que hacer hasta que el pago entra (ahí pasa a "pagado" y recién ahí avisa).
export function pagoPorLinkVigente(p: PedidoParaContar, ahora = Date.now()): boolean {
  return p.estado === "pendiente_pago"
    && p.medio_pago === "mercadopago_link"
    && (!p.expira_en || new Date(p.expira_en).getTime() > ahora);
}

export function cuentaComoPorAtender(p: PedidoParaContar, _ahora = Date.now()): boolean {
  return ESTADOS_NUEVOS.includes(p.estado);
}

// null = todas las sucursales (admin). Lista vacía = el usuario no tiene ninguna
// asignada. Qué sucursales tiene cada persona lo sabe el kiosco: se pregunta por el puerto.
export function sucursalesVisibles(admin: Admin, userId: string, role: string): Promise<string[] | null> {
  return puertoKiosco(admin).sucursalesDelUsuario(userId, role);
}

// El aviso consulta cada pocos segundos desde cada pestaña abierta; las sucursales
// de una persona casi nunca cambian, así que se recuerdan un rato (por instancia del
// servidor) para no repetir 2-3 consultas por ciclo. Si le cambian los permisos, el
// contador se ajusta en a lo sumo este tiempo. La pantalla de pedidos NO usa este
// caché: sigue leyendo los permisos reales.
const VIDA_SUCURSALES_MS = 90_000;
const sucursalesRecordadas = new Map<string, { hasta: number; ids: string[] | null }>();

async function sucursalesParaAviso(admin: Admin, userId: string, role: string): Promise<string[] | null> {
  const clave = `${userId}:${role}`;
  const ahora = Date.now();
  const guardado = sucursalesRecordadas.get(clave);
  if (guardado && guardado.hasta > ahora) return guardado.ids;

  const ids = await sucursalesVisibles(admin, userId, role);
  if (sucursalesRecordadas.size > 200) sucursalesRecordadas.clear();
  sucursalesRecordadas.set(clave, { hasta: ahora + VIDA_SUCURSALES_MS, ids });
  return ids;
}

async function pedidosPorAtender(admin: Admin, userId: string, role: string): Promise<(PedidoParaContar & { id: string })[]> {
  const sucursales = await sucursalesParaAviso(admin, userId, role);
  if (sucursales && sucursales.length === 0) return [];

  let query = (admin as any)
    .from("pedidos")
    .select("id, estado, medio_pago, expira_en")
    .in("estado", ESTADOS_NUEVOS)
    .order("created_at", { ascending: true })
    .limit(500);
  if (sucursales) query = query.in("sucursal_id", sucursales);

  const { data } = await query;
  const ahora = Date.now();
  return ((data ?? []) as (PedidoParaContar & { id: string })[]).filter((p) => cuentaComoPorAtender(p, ahora));
}

export async function contarPedidosPorAtender(admin: Admin, userId: string, role: string): Promise<number> {
  return (await pedidosPorAtender(admin, userId, role)).length;
}

// Ids de los pedidos por atender (el aviso decide cuáles todavía no mostró).
export async function idsPedidosPorAtender(admin: Admin, userId: string, role: string): Promise<string[]> {
  return (await pedidosPorAtender(admin, userId, role)).map((p) => p.id);
}

// Tope de pedidos que muestra un solo cuadro de aviso.
const MAX_AVISO = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Detalle (qué pidió, cómo paga, dónde se entrega) de los pedidos que el aviso quiere
// mostrar. Los ids vienen del navegador: se revalida todo contra la base, o sea que
// solo devuelve pedidos de las sucursales del usuario que SIGUEN por atender.
export async function detalleDePedidosPorAtender(admin: Admin, userId: string, role: string, ids: string[]): Promise<PedidoAviso[]> {
  const pedidos = [...new Set(ids.filter((i) => typeof i === "string" && UUID.test(i)))].slice(0, MAX_AVISO);
  if (pedidos.length === 0) return [];

  const sucursales = await sucursalesParaAviso(admin, userId, role);
  if (sucursales && sucursales.length === 0) return [];

  let query = (admin as any)
    .from("pedidos")
    .select("id, numero, estado, tipo_entrega, cliente_nombre, cliente_telefono, direccion_entrega, direccion_referencia, entrega_latitud, entrega_longitud, zona_nombre, medio_pago, pago_con, notas, total, costo_envio, descuento_total, expira_en, created_at, sucursales(nombre)")
    .in("id", pedidos)
    .order("created_at", { ascending: true });
  if (sucursales) query = query.in("sucursal_id", sucursales);

  const { data } = await query;
  const ahora = Date.now();
  const filas = ((data ?? []) as any[]).filter((p) => cuentaComoPorAtender(p, ahora));
  if (filas.length === 0) return [];

  const lineas = await cargarLineasDePedidos(admin, filas.map((p) => p.id));
  return filas.map((p): PedidoAviso => ({
    id:         p.id,
    numero:     p.numero == null ? null : Number(p.numero),
    sucursal:   p.sucursales?.nombre ?? null,
    estado:     p.estado,
    cliente:    p.cliente_nombre ?? null,
    telefono:   p.cliente_telefono ?? null,
    delivery:   p.tipo_entrega === "delivery",
    direccion:  p.direccion_entrega ?? null,
    referencia: p.direccion_referencia ?? null,
    mapa:       p.entrega_latitud != null && p.entrega_longitud != null ? urlMapa(Number(p.entrega_latitud), Number(p.entrega_longitud)) : null,
    zona:       p.zona_nombre ?? null,
    medioPago:  p.medio_pago ?? null,
    pagoCon:    p.pago_con == null ? null : Number(p.pago_con),
    notas:      p.notas ?? null,
    total:      Number(p.total ?? 0),
    costoEnvio: Number(p.costo_envio ?? 0),
    descuento:  Number(p.descuento_total ?? 0),
    lineas:     lineas.get(p.id) ?? [],
  }));
}
