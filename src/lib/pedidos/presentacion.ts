// Cómo se ordena y se describe la lista de pedidos del personal. Puro (sin base ni
// red): decide en qué sección va cada pedido y cuánto hace que entró.

export type GrupoPedido = "atender" | "preparando" | "listos" | "entregados";

export const GRUPOS: { clave: GrupoPedido; titulo: string; ayuda: string }[] = [
  { clave: "atender",    titulo: "Para atender",   ayuda: "Entraron y todavía nadie los aceptó" },
  { clave: "preparando", titulo: "En preparación", ayuda: "Se están armando" },
  { clave: "listos",     titulo: "Listos",         ayuda: "Para retirar o ya en camino" },
  { clave: "entregados", titulo: "Entregados",     ayuda: "Ya completados" },
];

// null = no va en la lista (cancelado, vencido, carrito del bot, pago por link vencido).
// `linkVigente`: es un pago por link que todavía puede pagarse (lo calcula por-atender.ts).
export function grupoDePedido(p: { estado: string }, linkVigente: boolean): GrupoPedido | null {
  switch (p.estado) {
    case "confirmado":
    case "pagado":
      return "atender";
    case "pendiente_pago":
      return linkVigente ? "atender" : null;
    case "en_preparacion":
      return "preparando";
    case "listo_retiro":
    case "en_reparto":
      return "listos";
    case "entregado":
      return "entregados";
    default:
      return null;
  }
}

// Lo que espera atención va del más viejo al más nuevo (el que más espera, primero);
// el resto, del más reciente al más viejo.
export function ordenarGrupo<T extends { created_at: string }>(grupo: GrupoPedido, pedidos: T[]): T[] {
  const f = grupo === "atender" ? 1 : -1;
  return [...pedidos].sort((a, b) => f * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
}

export function agruparPedidos<T extends { estado: string; created_at: string }>(
  pedidos: T[],
  linkVigente: (p: T) => boolean
): Record<GrupoPedido, T[]> {
  const grupos: Record<GrupoPedido, T[]> = { atender: [], preparando: [], listos: [], entregados: [] };
  for (const p of pedidos) {
    const g = grupoDePedido(p, linkVigente(p));
    if (g) grupos[g].push(p);
  }
  for (const g of Object.keys(grupos) as GrupoPedido[]) grupos[g] = ordenarGrupo(g, grupos[g]);
  return grupos;
}

// Pasados estos minutos sin aceptar, el pedido se marca como demorado.
export const MINUTOS_DEMORADO = 10;

export function haceTiempo(iso: string, ahora = Date.now()): { texto: string; minutos: number } {
  const minutos = Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60_000));
  if (minutos < 1) return { texto: "recién", minutos };
  if (minutos < 60) return { texto: `hace ${minutos} min`, minutos };
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return { texto: `hace ${horas} h`, minutos };
  return { texto: `hace ${Math.floor(horas / 24)} d`, minutos };
}
