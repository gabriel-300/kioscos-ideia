// Enlaces absolutos a las páginas públicas de pedidos, para poner en mensajes
// de WhatsApp o en el QR impreso. Un solo lugar para la URL base: el mismo
// fallback que ya usa el resto del proyecto (mercadopago-actions.ts) hasta que
// haya dominio propio -- ahí alcanza con cargar NEXT_PUBLIC_SITE_URL.

const BASE_POR_DEFECTO = "https://kioscos-ideia.lytwyn-ideia.workers.dev";

export function urlBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || BASE_POR_DEFECTO).replace(/\/+$/, "");
}

export function urlCatalogo(sucursalId: string): string {
  return `${urlBase()}/pedir/${sucursalId}`;
}

// El id del pedido es un uuid aleatorio (gen_random_uuid): no se puede
// adivinar, así que hace de enlace secreto y no hace falta una columna aparte.
export function urlSeguimiento(sucursalId: string, pedidoId: string): string {
  return `${urlCatalogo(sucursalId)}/pedido/${pedidoId}`;
}
