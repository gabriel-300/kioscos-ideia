import type { createAdminClient } from "@/lib/supabase/server";

// Con qué se puede pagar un pedido online. Mercado Pago (tarjeta, débito o dinero en cuenta) siempre: el
// cobro es automático y no hay plata que rendir en la puerta. El efectivo es opcional por sucursal
// (columna efectivo_online, migración 123) y solo lo puede elegir un cliente que ingresó con Google; el bot
// de WhatsApp no tiene ese ingreso, así que ahí nunca se ofrece. La tienda, el bot y el servidor usan esta
// misma regla.
export function aceptaEfectivoOnline(sucursalLoHabilita: boolean, clienteRegistrado: boolean): boolean {
  return sucursalLoHabilita && clienteRegistrado;
}

// Sin la migración 123 aplicada la columna no existe: se lee aparte y, ante cualquier error, no hay efectivo.
export async function leerEfectivoOnline(admin: ReturnType<typeof createAdminClient>, sucursalId: string): Promise<boolean> {
  const { data, error } = await (admin as any).from("sucursales").select("efectivo_online").eq("id", sucursalId).single();
  return !error && data?.efectivo_online === true;
}
