// Enlaces absolutos a las páginas públicas de pedidos, para poner en mensajes
// de WhatsApp o en el QR impreso. Siempre apuntan al dominio de clientes
// (lib/dominios.ts), sin variable de build.
//
// A propósito NO usan NEXT_PUBLIC_SITE_URL: esa variable la usa también el cobro con
// QR de Mercado Pago de los kioscos (le dice a MP adónde avisar los pagos,
// mercadopago-actions.ts) y no debe moverse junto con el dominio de clientes.
// URL_CLIENTES permite otra base, solo para probar en local.

import { DOMINIO_CLIENTES } from "@/lib/dominios";

export function urlBase(): string {
  return (process.env.URL_CLIENTES || `https://${DOMINIO_CLIENTES}`).replace(/\/+$/, "");
}

export function urlCatalogo(sucursalId: string): string {
  return `${urlBase()}/pedir/${sucursalId}`;
}

// El id del pedido es un uuid aleatorio (gen_random_uuid): no se puede
// adivinar, así que hace de enlace secreto y no hace falta una columna aparte.
export function urlSeguimiento(sucursalId: string, pedidoId: string): string {
  return `${urlCatalogo(sucursalId)}/pedido/${pedidoId}`;
}
