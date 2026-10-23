"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireStaffTenteo } from "@/lib/auth/require-role";
import { escribirEnChat, leerChat, type EstadoChat } from "@/lib/pedidos/chat";

// Chat del personal del local con el cliente (migración 124). Solo pedidos de las sucursales a las que
// tiene acceso: lo valida lib/pedidos/chat.ts con requireSucursalAccess.

export async function cargarChatLocal(pedidoId: string): Promise<EstadoChat | { error: string }> {
  const { userId, role } = await requireStaffTenteo();
  return leerChat(createAdminClient(), { tipo: "personal", userId, role }, pedidoId);
}

export async function enviarChatLocal(pedidoId: string, texto: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  return escribirEnChat(createAdminClient(), { tipo: "personal", userId, role }, pedidoId, texto);
}
