"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { guardarCalificacion } from "@/lib/pedidos/calificacion";

// El cliente deja su calificación (estrellas y comentario) cuando ya recibió el pedido.
export async function calificarMiPedido(sucursalId: string, pedidoId: string, estrellas: number, comentario: string): Promise<{ error?: string }> {
  return guardarCalificacion(createAdminClient(), { sucursalId, pedidoId, estrellas, comentario });
}
