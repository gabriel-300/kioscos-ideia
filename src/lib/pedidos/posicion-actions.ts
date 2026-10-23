"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireRepartidor } from "@/lib/auth/require-role";
import { borrarPosicionesDe, guardarPosicion, posicionParaCliente, type PosicionParaCliente } from "./posicion-servidor";

// Ubicación en vivo del repartidor. La lógica y los permisos están en posicion-servidor.ts (probada con tests).

// El navegador del repartidor manda su posición cada ~12 s mientras comparte.
export async function enviarPosicionRepartidor(
  pedidoIds: string[], lat: number, lng: number, precision?: number | null,
): Promise<{ error?: string }> {
  const { userId } = await requireRepartidor();
  const r = await guardarPosicion(createAdminClient(), { userId, pedidoIds, lat, lng, precision });
  return r.error ? { error: r.error } : {};
}

// El repartidor apaga "Compartir mi ubicación" (o termina su recorrido): se borra lo guardado.
export async function dejarDeCompartirUbicacion(): Promise<{ error?: string }> {
  const { userId } = await requireRepartidor();
  return borrarPosicionesDe(createAdminClient(), userId);
}

// El cliente (sin cuenta) consulta dónde está el repartidor de SU pedido. Mismo criterio que la página de
// seguimiento: el id del pedido (uuid aleatorio) hace de enlace secreto.
export async function consultarPosicionDeMiPedido(sucursalId: string, pedidoId: string): Promise<PosicionParaCliente> {
  return posicionParaCliente(createAdminClient(), sucursalId, pedidoId);
}
