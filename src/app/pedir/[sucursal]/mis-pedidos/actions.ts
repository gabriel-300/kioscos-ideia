"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { pedidosPorIds } from "@/lib/pedidos/mis-pedidos-servidor";
import type { PedidoResumen } from "@/lib/pedidos/mis-pedidos";

// Los pedidos que el navegador recuerda (quien pidió sin cuenta), con su estado de ahora.
export async function consultarMisPedidos(ids: string[]): Promise<PedidoResumen[]> {
  return pedidosPorIds(createAdminClient(), ids);
}
