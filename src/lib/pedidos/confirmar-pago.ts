import type { createAdminClient } from "@/lib/supabase/server";
import { crearVentaPublica } from "./crear-venta-publica";

// Confirmar a mano que se cobró un pedido de Mercado Pago (cuando el aviso automático no llegó). Solo lo puede
// hacer un administrador (lo exige la acción que llama acá). A diferencia de antes, primero se le pregunta a
// Mercado Pago si hay un pago APROBADO por ese pedido y por ese importe; si no lo hay, solo se confirma igual
// con un motivo escrito, y queda registrado quién y por qué (migración 127). Sin "use server": no es invocable
// desde el navegador.

type Admin = ReturnType<typeof createAdminClient>;

export const MIN_MOTIVO_MANUAL = 10;

export type PagoEncontrado = { aprobado: true; paymentId: string } | { aprobado: false } | { error: string };

// Busca en Mercado Pago un pago aprobado con esa referencia y ese importe. `fetchFn` se inyecta para probarlo.
export async function buscarPagoAprobado(
  externalReference: string,
  montoEsperado: number,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<PagoEncontrado> {
  try {
    const res = await fetchFn(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return { error: `Mercado Pago respondió ${res.status}` };
    const json = (await res.json()) as { results?: { id: number | string; status: string; transaction_amount: number; external_reference?: string | null }[] };
    const pago = (json.results ?? []).find((p) =>
      p.status === "approved" && p.external_reference === externalReference && Math.abs(Number(p.transaction_amount) - montoEsperado) < 0.01);
    return pago ? { aprobado: true, paymentId: String(pago.id) } : { aprobado: false };
  } catch {
    return { error: "No se pudo consultar a Mercado Pago" };
  }
}

export type ResultadoConfirmacion = { error?: string; sinVerificar?: boolean; metodo?: "mercadopago" | "manual" };

export async function confirmarPagoPedido(
  admin: Admin,
  p: { pedidoId: string; userId: string; motivoManual?: string; accessToken?: string; fetchFn?: typeof fetch },
): Promise<ResultadoConfirmacion> {
  const { data: pedido } = await (admin as any)
    .from("pedidos").select("id, estado, medio_pago, total").eq("id", p.pedidoId).single();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (pedido.medio_pago !== "mercadopago_link") return { error: "Este pedido no se paga por link de Mercado Pago" };
  if (pedido.estado !== "pendiente_pago") {
    return { error: pedido.estado === "expirado" ? "El pedido ya venció, hay que cargarlo de nuevo" : "El pedido ya no está esperando el pago" };
  }

  const { data: orden } = await (admin as any)
    .from("mercadopago_qr_orders").select("id, external_reference, estado")
    .eq("pedido_id", p.pedidoId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const total = Number(pedido.total);

  // 1) ¿Mercado Pago muestra el pago?
  let motivoSinVerificar: string;
  let verificado: { paymentId: string } | null = null;
  if (!p.accessToken) {
    motivoSinVerificar = "No se pudo consultar a Mercado Pago (falta la conexión con la cuenta).";
  } else if (!orden?.external_reference) {
    motivoSinVerificar = "Este pedido no tiene un cobro de Mercado Pago generado, así que no hay nada que verificar.";
  } else {
    const r = await buscarPagoAprobado(orden.external_reference, total, p.accessToken, p.fetchFn);
    if ("error" in r) motivoSinVerificar = `No se pudo consultar a Mercado Pago (${r.error}).`;
    else if (!r.aprobado) motivoSinVerificar = `Mercado Pago no muestra un pago aprobado por $${total.toLocaleString("es-AR")} para este pedido.`;
    else { motivoSinVerificar = ""; verificado = { paymentId: r.paymentId }; }
  }

  // 2) Si no se pudo verificar, solo con un motivo escrito (queda registrado).
  const motivo = p.motivoManual?.trim() ?? "";
  if (!verificado) {
    if (motivo.length < MIN_MOTIVO_MANUAL) {
      return { sinVerificar: true, error: `${motivoSinVerificar} Si igual lo recibiste (por ejemplo por transferencia directa), escribí el motivo para confirmarlo.` };
    }
  }

  // 3) La venta (misma función que usa el aviso automático).
  const venta = await crearVentaPublica(admin, p.pedidoId);
  if (venta.error) return { error: `No se pudo registrar la venta: ${venta.error}` };

  // 4) El rastro. Si la migración 127 todavía no está aplicada, el pedido igual queda confirmado.
  const ahora = new Date().toISOString();
  const metodo = verificado ? "mercadopago" : "manual";
  const { error: errRastro } = await (admin as any).from("pedidos").update({
    pago_confirmado_por: p.userId, pago_confirmado_en: ahora, pago_confirmacion: metodo, pago_confirmacion_motivo: verificado ? null : motivo,
  }).eq("id", p.pedidoId);
  if (errRastro) console.warn(`[confirmar pago] no se pudo guardar quién confirmó el pago del pedido ${p.pedidoId}: ${errRastro.message}`);

  if (verificado && orden) {
    await (admin as any).from("mercadopago_qr_orders")
      .update({ estado: "pagado", mp_payment_id: verificado.paymentId, paid_at: ahora })
      .eq("id", orden.id).eq("estado", "pendiente");
  }
  return { metodo };
}
