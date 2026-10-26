"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaffTenteo } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { puedeAsignarA, puedeEntrar, puedeRepartir } from "@/lib/auth/acceso";
import { aplicarTransicion } from "@/lib/pedidos/transiciones";
import { confirmarPagoPedido } from "@/lib/pedidos/confirmar-pago";
import { detalleDePedidosPorAtender, idsPedidosPorAtender } from "@/lib/pedidos/por-atender";
import type { PedidoAviso } from "@/lib/pedidos/aviso";
import { notificarCambioEstado } from "@/lib/pedidos/notificar-cliente";
import { anularPedidoCobrado } from "@/lib/pedidos/anular-pedido";
import { armarPausa, DURACIONES_PAUSA, leerDisponibilidadOnline } from "@/lib/pedidos/disponibilidad-online";

// Fase 5 del storefront (delivery, ver plan): primera pantalla del admin
// para ver pedidos que vinieron del storefront/bot de WhatsApp más allá de
// la venta que terminan generando. La máquina de estados vive en
// src/lib/pedidos/transiciones.ts (la comparte /tenteo/repartos).

function refrescar() {
  revalidatePath("/tenteo/pedidos");
  revalidatePath("/tenteo/repartos");
}

// Lo consulta el aviso de pedido nuevo cada 30 s, desde el kiosco y desde Tenteo.
// Es liviano a propósito (una consulta, solo ids), acotado a las sucursales del usuario.
export async function consultarPedidosPorAtender(): Promise<{ cantidad: number; ids: string[] }> {
  const { userId, role } = await requireStaffTenteo();
  const ids = await idsPedidosPorAtender(createAdminClient(), userId, role);
  return { cantidad: ids.length, ids: ids.slice(0, 50) };
}

// El detalle (qué pidió el cliente) solo se pide cuando hay un pedido que todavía no se
// mostró. Los ids que manda el navegador se revalidan en el servidor.
export async function detallePedidosParaAviso(ids: string[]): Promise<PedidoAviso[]> {
  const { userId, role } = await requireStaffTenteo();
  return detalleDePedidosPorAtender(createAdminClient(), userId, role, Array.isArray(ids) ? ids : []);
}

export async function avanzarEstadoPedido(pedidoId: string, nuevoEstado: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("id, sucursal_id, estado, tipo_entrega, repartidor_id, medio_pago")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const res = await aplicarTransicion(admin, pedido, nuevoEstado);
  if (res.error) return res;

  refrescar();
  return {};
}

// Asignar repartidor es una decisión operativa (quién coordina la entrega),
// no una tarea de turno -- mismo criterio que ya usa reposicion.ts para
// excluir vendedor/concesionario de decisiones de compra.
export async function asignarRepartidor(pedidoId: string, repartidorUserId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  if (!puedeAsignarA(role, userId, repartidorUserId)) return { error: "No tenés permisos para asignar a otra persona. Podés tomar el envío vos con \"Yo lo llevo\"." };
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("sucursal_id, tipo_entrega")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (pedido.tipo_entrega !== "delivery") return { error: "Este pedido no es de delivery" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  // Puede llevarlo un repartidor, o un vendedor/encargado con Tenteo que trabaje en esa sucursal.
  const { data: repartidorUser } = await admin.auth.admin.getUserById(repartidorUserId);
  const destino = repartidorUser?.user;
  const rolDestino = destino?.app_metadata?.role as string | undefined;
  const puede = !!destino && puedeRepartir(rolDestino) && (
    rolDestino === "repartidor" ||
    (puedeEntrar(destino, "tenteo") && (await requireSucursalAccess(admin, destino.id, rolDestino as string, pedido.sucursal_id)) === null)
  );
  if (!puede) return { error: "Esa persona no puede repartir en esta sucursal" };

  const { error } = await (admin as any)
    .from("pedidos")
    .update({ repartidor_id: repartidorUserId, updated_at: new Date().toISOString() })
    .eq("id", pedidoId);
  if (error) return { error: error.message };

  refrescar();
  return {};
}

// Pedido pagado con Mercado Pago por link cuyo aviso automático no llegó: se confirma a mano. Solo un
// ADMINISTRADOR (es plata). Primero se consulta a Mercado Pago si hay un pago aprobado por ese pedido e importe; si no lo
// hay, solo se confirma con un motivo escrito. En los dos casos queda registrado quién y cómo (migración 127).
export async function confirmarPagoRecibido(pedidoId: string, motivoManual?: string): Promise<{ error?: string; sinVerificar?: boolean }> {
  const { userId, role } = await requireStaffTenteo();
  if (role !== "admin") return { error: "Solo un administrador puede confirmar un pago a mano" };
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any).from("pedidos").select("sucursal_id").eq("id", pedidoId).single();
  if (!pedido) return { error: "No se encontró el pedido" };
  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const res = await confirmarPagoPedido(admin, { pedidoId, userId, motivoManual, accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN });
  if (res.error) return { error: res.error, sinVerificar: res.sinVerificar };

  await notificarCambioEstado(admin, pedidoId);
  refrescar();
  return {};
}

// Solo pedidos que todavía no generaron una venta: los cobrados por Mercado
// Pago ya tienen movimiento y se anulan desde la venta, no desde acá.
export async function cancelarPedido(pedidoId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("sucursal_id, estado, movimiento_id")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  if (pedido.movimiento_id) return { error: "Este pedido ya tiene una venta registrada -- anulala desde el historial de ventas" };
  if (["entregado", "cancelado", "expirado", "carrito"].includes(pedido.estado)) return { error: "Este pedido ya no se puede cancelar" };

  const { data: actualizado, error } = await (admin as any)
    .from("pedidos")
    .update({ estado: "cancelado", updated_at: new Date().toISOString() })
    .eq("id", pedidoId)
    .eq("estado", pedido.estado)
    .select("id");
  if (error) return { error: error.message };
  if (!actualizado?.length) return { error: "El pedido ya cambió de estado, refrescá la página" };

  // El link de Mercado Pago sigue aceptando pagos hasta que vence: se da de baja la orden, así un pago que
  // llegue después no se pierde (el webhook lo deja en "pagos sin conciliar").
  await (admin as any).from("mercadopago_qr_orders").update({ estado: "cancelado" }).eq("pedido_id", pedidoId).eq("estado", "pendiente");

  await notificarCambioEstado(admin, pedidoId);
  refrescar();
  return {};
}

// Pausas temporales de los pedidos online (migración 122): las prende y apaga el personal del local desde
// Pedidos online, con un motivo que ve el cliente. "envios" corta solo el envío (se puede seguir retirando);
// "pedidos" pausa todos los pedidos online. Cualquiera con Tenteo en esa sucursal puede hacerlo.
export async function pausarOnline(sucursalId: string, tipo: "envios" | "pedidos", motivo: string, minutos: number | null): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };
  if (tipo !== "envios" && tipo !== "pedidos") return { error: "No se entendió qué pausar" };
  if (minutos !== null && !DURACIONES_PAUSA.some((d) => d.minutos === minutos)) return { error: "La duración elegida no es válida" };
  if (typeof motivo !== "string" || motivo.trim().length < 3) return { error: "Escribí el motivo (lo ve el cliente)" };

  const actual = await leerDisponibilidadOnline(admin, sucursalId);
  const pausas = { ...actual.pausas, [tipo]: armarPausa(motivo, minutos, userId) };
  const { error } = await (admin as any).from("sucursales").update({ pausas_online: pausas }).eq("id", sucursalId);
  if (error) return { error: /pausas_online/.test(error.message) ? "Falta aplicar la migración 122 en la base" : error.message };

  revalidatePath("/tenteo/pedidos");
  revalidatePath("/pedir/[sucursal]", "page");
  return {};
}

export async function reactivarOnline(sucursalId: string, tipo: "envios" | "pedidos"): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };
  if (tipo !== "envios" && tipo !== "pedidos") return { error: "No se entendió qué reactivar" };

  const actual = await leerDisponibilidadOnline(admin, sucursalId);
  const pausas = { ...actual.pausas, [tipo]: null };
  const { error } = await (admin as any).from("sucursales").update({ pausas_online: pausas }).eq("id", sucursalId);
  if (error) return { error: error.message };

  revalidatePath("/tenteo/pedidos");
  revalidatePath("/pedir/[sucursal]", "page");
  return {};
}

// Anular un pedido que ya se cobró (Mercado Pago): el pedido queda cancelado y su venta anulada (no se
// borra). Mientras la caja del turno esté abierta lo puede hacer el personal; después, un administrador. La
// plata hay que devolverla desde Mercado Pago (acá no se mueve).
export async function anularPedidoConVenta(pedidoId: string, motivo: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaffTenteo();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any).from("pedidos").select("sucursal_id").eq("id", pedidoId).single();
  if (!pedido) return { error: "No se encontró el pedido" };
  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const res = await anularPedidoCobrado(admin, { pedidoId, motivo, userId, esAdmin: role === "admin" });
  if (res.error) return { error: res.error };

  await notificarCambioEstado(admin, pedidoId);
  refrescar();
  for (const ruta of ["/admin/movimientos", "/admin/stock", "/admin/ventas", "/admin/dashboard", "/admin/cierres", `/admin/sucursales/${pedido.sucursal_id}`]) revalidatePath(ruta);
  return {};
}
