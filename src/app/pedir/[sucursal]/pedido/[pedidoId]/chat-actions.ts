"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { escribirEnChat, leerChat, type EstadoChat } from "@/lib/pedidos/chat";

// Chat del cliente con el local (y con el repartidor en reparto). Sin cuenta: igual que la página de
// seguimiento, el id del pedido (uuid aleatorio) hace de enlace secreto. Las reglas (solo lectura al
// cerrar, límites) viven en lib/pedidos/chat.ts. Nunca se devuelve el teléfono ni la dirección de nadie.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cargarChatCliente(pedidoId: string): Promise<EstadoChat | { error: string }> {
  if (typeof pedidoId !== "string" || !UUID.test(pedidoId)) return { error: "No se encontró el pedido" };
  return leerChat(createAdminClient(), { tipo: "cliente" }, pedidoId);
}

export async function enviarChatCliente(pedidoId: string, texto: string): Promise<{ error?: string }> {
  if (typeof pedidoId !== "string" || !UUID.test(pedidoId)) return { error: "No se encontró el pedido" };
  return escribirEnChat(createAdminClient(), { tipo: "cliente" }, pedidoId, texto);
}
