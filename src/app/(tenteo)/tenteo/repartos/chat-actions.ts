"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireRepartidor } from "@/lib/auth/require-role";
import { escribirEnChat, leerChat, type EstadoChat } from "@/lib/pedidos/chat";

// Chat del repartidor con el cliente (migración 124). Solo en pedidos que tiene asignados y mientras
// están en reparto (lo valida lib/pedidos/chat.ts); un admin puede supervisar cualquiera.

export async function cargarChatRepartidor(pedidoId: string): Promise<EstadoChat | { error: string }> {
  const { userId, role } = await requireRepartidor();
  return leerChat(createAdminClient(), { tipo: "repartidor", userId, role }, pedidoId);
}

export async function enviarChatRepartidor(pedidoId: string, texto: string): Promise<{ error?: string }> {
  const { userId, role } = await requireRepartidor();
  return escribirEnChat(createAdminClient(), { tipo: "repartidor", userId, role }, pedidoId, texto);
}
