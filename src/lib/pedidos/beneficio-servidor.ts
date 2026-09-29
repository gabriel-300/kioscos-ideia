import type { createAdminClient } from "@/lib/supabase/server";
import type { ConfigBeneficio } from "./beneficio-cliente";

// Lecturas de servidor para los beneficios de clientes registrados. Las usan
// crearPedidoPublico (para cobrar) y /pedir (para mostrar): una sola versión de
// cada consulta, así lo que se ve y lo que se cobra no se pueden separar.
//
// Son tolerantes a que la migración 099 no esté aplicada todavía: si las
// columnas o la tabla no existen, la consulta falla y se responde "sin
// beneficios" / "sin cliente" en vez de romper el catálogo o los pedidos.

type Admin = ReturnType<typeof createAdminClient>;

export const SIN_BENEFICIOS: ConfigBeneficio = { descuentoPct: 0, descuentoSoloPrimera: false, envioGratisPrimera: false };

export async function leerConfigBeneficio(admin: Admin, sucursalId: string): Promise<ConfigBeneficio> {
  const { data } = await (admin as any)
    .from("sucursales")
    .select("descuento_cliente_pct, descuento_cliente_solo_primera, envio_gratis_primera_compra")
    .eq("id", sucursalId)
    .maybeSingle();
  if (!data) return SIN_BENEFICIOS;
  return {
    descuentoPct:         Number(data.descuento_cliente_pct ?? 0),
    descuentoSoloPrimera: !!data.descuento_cliente_solo_primera,
    envioGratisPrimera:   !!data.envio_gratis_primera_compra,
  };
}

// Primera compra = ningún pedido anterior del cliente que haya seguido en pie.
// Los cancelados y vencidos no cuentan (no llegó a comprar), ni el "carrito" del bot.
export async function esPrimeraCompra(admin: Admin, clienteId: string): Promise<boolean> {
  const { count } = await (admin as any)
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .not("estado", "in", "(carrito,cancelado,expirado)");
  return (count ?? 0) === 0;
}

export type ClienteSesion = { id: string; nombre: string | null; telefono: string | null };

// El cliente registrado de la sesión actual, o null si es un invitado. Solo
// cuenta quien tiene fila en `clientes`: un usuario del personal que entre a
// mirar el catálogo con su sesión no recibe beneficios.
export async function clienteDeLaSesion(admin: Admin, userId: string | null | undefined): Promise<ClienteSesion | null> {
  if (!userId) return null;
  const { data } = await (admin as any)
    .from("clientes")
    .select("id, nombre, telefono")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}

// Guarda el nombre y el teléfono con los que el cliente hizo el pedido, para
// que el próximo salga prellenado. Si el teléfono cambia, la verificación
// anterior deja de valer (estaba atada al número viejo).
export async function recordarContactoCliente(admin: Admin, cliente: ClienteSesion, nombre: string, telefono: string): Promise<void> {
  const cambios: Record<string, unknown> = {};
  if (!cliente.nombre && nombre.trim()) cambios.nombre = nombre.trim();
  const tel = telefono.trim();
  if (tel && tel !== cliente.telefono) {
    cambios.telefono = tel;
    cambios.telefono_verificado_at = null;
  }
  if (Object.keys(cambios).length === 0) return;
  await (admin as any).from("clientes").update(cambios).eq("id", cliente.id);
}
