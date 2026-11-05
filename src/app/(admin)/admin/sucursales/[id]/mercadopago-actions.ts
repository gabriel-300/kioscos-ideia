"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff, requireAdmin } from "@/lib/auth/require-role";
import { requireSucursalAccess as checkAccesoSucursal } from "@/lib/auth/sucursal-access";
import { credencialesDeSucursal } from "@/lib/mercadopago/credenciales";

// Cobro con QR dinámico de Mercado Pago -- mismo espíritu que
// transferencia-actions.ts/termos/actions.ts: devuelven {error?} en vez de
// throw (Next.js oculta el mensaje de las excepciones en Server Actions en
// producción). Sin las credenciales cargadas como secrets de Cloudflare
// (MERCADOPAGO_ACCESS_TOKEN/MERCADOPAGO_USER_ID), todo responde con un error
// claro -- mismo criterio que el webhook de PedidosYa antes de tener token.


export async function armarQrMercadoPago(data: {
  sucursal_id: string;
  monto:       number;
}): Promise<{ error?: string; external_reference?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  if (!(data.monto > 0)) return { error: "El monto tiene que ser mayor a 0" };

  // Cada sucursal cobra con SU cuenta: un local independiente con otra cuenta de Mercado Pago usa la suya (y nunca
  // la de IDEIA); el resto usa la de IDEIA (migración 134).
  const cred = await credencialesDeSucursal(admin, data.sucursal_id);
  if (!cred || !cred.userId) return { error: "Esta sucursal todavía no tiene su cuenta de Mercado Pago conectada" };

  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("mercadopago_pos_id, nombre")
    .eq("id", data.sucursal_id)
    .single();
  const posId = sucursal?.mercadopago_pos_id as string | null | undefined;
  if (!posId) return { error: "Esta sucursal no tiene configurada la Caja de Mercado Pago" };

  const externalReference = crypto.randomUUID();

  const { error: insertError } = await (admin as any).from("mercadopago_qr_orders").insert({
    sucursal_id:        data.sucursal_id,
    external_reference: externalReference,
    monto:               data.monto,
    estado:               "pendiente",
    created_by:           userId,
  });
  if (insertError) return { error: insertError.message };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kioscos-ideia.lytwyn-ideia.workers.dev";
  // Con cuenta propia, el aviso de pago lleva la sucursal para que el servidor sepa con qué token confirmarlo.
  const notificationUrl = `${siteUrl}/api/webhooks/mercadopago${cred.propia ? `?s=${data.sucursal_id}` : ""}`;
  const titulo = cred.propia ? `Compra en ${(sucursal?.nombre as string | undefined)?.trim() || "el local"}` : "Compra en Kioscos IDEIA";

  const mpRes = await fetch(
    `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${cred.userId}/pos/${posId}/qrs`,
    {
      method: "PUT",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${cred.accessToken}`,
      },
      body: JSON.stringify({
        external_reference: externalReference,
        title:              cred.propia ? titulo : "Kioscos IDEIA",
        description:        titulo,
        notification_url:   notificationUrl,
        total_amount:        data.monto,
        items: [{
          title:       titulo,
          description: titulo,
          unit_price:   data.monto,
          quantity:     1,
          unit_measure: "unit",
          total_amount: data.monto,
        }],
      }),
    }
  );

  if (!mpRes.ok) {
    const bodyText = await mpRes.text().catch(() => "");
    await (admin as any).from("mercadopago_qr_orders").update({ estado: "cancelado" }).eq("external_reference", externalReference);
    return { error: `Mercado Pago rechazó la orden (${mpRes.status}): ${bodyText || "sin detalle"}` };
  }

  return { external_reference: externalReference };
}

export async function consultarQrMercadoPago(externalReference: string): Promise<{
  error?: string;
  estado?: "pendiente" | "pagado" | "cancelado" | "expirado";
  monto?:  number;
}> {
  await requireStaff();
  const admin = createAdminClient();

  const { data, error } = await (admin as any)
    .from("mercadopago_qr_orders")
    .select("estado, monto")
    .eq("external_reference", externalReference)
    .single();
  if (error || !data) return { error: "No se encontró la orden" };

  return { estado: data.estado, monto: data.monto };
}

export async function cancelarQrMercadoPago(externalReference: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const { data: orden } = await (admin as any)
    .from("mercadopago_qr_orders")
    .select("sucursal_id, estado")
    .eq("external_reference", externalReference)
    .single();
  if (!orden) return { error: "No se encontró la orden" };
  if (orden.estado === "pagado") return { error: "Esta orden ya fue pagada, no se puede cancelar" };

  const accesoError = await checkAccesoSucursal(admin, userId, role, orden.sucursal_id);
  if (accesoError) return { error: accesoError };

  // Se cancela PRIMERO en nuestra base y solo si sigue "pendiente": si el pago
  // entra justo ahora, el webhook ya la pasó a "pagado" y este update no
  // matchea -- antes el update era incondicional y pisaba un "pagado" con
  // "cancelado" (auditoría 19/09/2026, M-02).
  const { data: cancelada, error: errCancel } = await (admin as any)
    .from("mercadopago_qr_orders")
    .update({ estado: "cancelado" })
    .eq("external_reference", externalReference)
    .eq("estado", "pendiente")
    .select("id");
  if (errCancel) return { error: errCancel.message };
  if (!cancelada?.length) return { error: "Esta orden ya no está pendiente (puede que se haya pagado justo ahora), refrescá la pantalla" };

  const cred = await credencialesDeSucursal(admin, orden.sucursal_id);
  if (cred && cred.userId) {
    const { data: sucursal } = await (admin as any)
      .from("sucursales")
      .select("mercadopago_pos_id")
      .eq("id", orden.sucursal_id)
      .single();
    const posId = sucursal?.mercadopago_pos_id as string | null | undefined;
    if (posId) {
      await fetch(
        `https://api.mercadopago.com/instore/orders/qr/seller/collectors/${cred.userId}/pos/${posId}/qrs`,
        { method: "DELETE", headers: { "Authorization": `Bearer ${cred.accessToken}` } }
      ).catch(() => {});
    }
  }

  return {};
}

// Cierra el loop para el informe de conciliación: sin esto, un pago QR
// confirmado no queda vinculado a ninguna venta concreta del sistema. Se
// llama desde el cliente justo después de que crearMovimiento() devuelve el
// movimiento_id (ver venta-rapida-form.tsx) -- no se mete adentro de
// crearMovimiento porque esa acción es genérica para venta/entrega/ajuste/
// devolución/merma, no debería saber nada de Mercado Pago.
export async function vincularMovimientoQr(externalReference: string, movimientoId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  // Hallazgo de la auditoría de seguridad del 08/08 (ver memoria del
  // proyecto): esta función no validaba acceso a sucursal ni que el monto de
  // la venta coincidiera con el del pago -- permitía vincular cualquier
  // movimiento a cualquier orden, quedando fuera del radar del informe de
  // conciliación (ambos "desaparecen" de las listas de pendientes sin que
  // el monto realmente cuadre). Ahora se valida sucursal + monto exacto,
  // igual que vincularTransferenciaMercadoPago.
  const { data: orden } = await (admin as any)
    .from("mercadopago_qr_orders")
    .select("sucursal_id, monto, movimiento_id")
    .eq("external_reference", externalReference)
    .single();
  if (!orden) return { error: "No se encontró la orden" };
  if (orden.movimiento_id) return { error: "Esta orden ya está vinculada a una venta" };

  const accesoError = await checkAccesoSucursal(admin, userId, role, orden.sucursal_id);
  if (accesoError) return { error: accesoError };

  const { data: movimiento } = await (admin as any)
    .from("movimientos")
    .select("sucursal_id, pago_billetera")
    .eq("id", movimientoId)
    .single();
  if (!movimiento) return { error: "No se encontró la venta" };
  if (movimiento.sucursal_id !== orden.sucursal_id) {
    return { error: "Esa venta no pertenece a la sucursal de esta orden" };
  }
  if (Math.round((movimiento.pago_billetera ?? 0) * 100) !== Math.round(orden.monto * 100)) {
    return { error: "El monto de la venta no coincide con el del pago confirmado" };
  }

  const { error } = await (admin as any)
    .from("mercadopago_qr_orders")
    .update({ movimiento_id: movimientoId })
    .eq("external_reference", externalReference);
  if (error) return { error: error.message };
  return {};
}

// Vincula una transferencia detectada por el webhook (sin dueño hasta acá)
// a una venta concreta -- el paso manual de un clic que reemplaza tener que
// ir a mirar el banco a mano, ver "Pagos por transferencia sin conciliar".
export async function vincularTransferenciaMercadoPago(data: {
  transferencia_id: string;
  movimiento_id:    string;
  sucursal_id:      string;
}): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const { data: transferencia } = await (admin as any)
    .from("mercadopago_transferencias_recibidas")
    .select("movimiento_id, monto, sucursal_id")
    .eq("id", data.transferencia_id)
    .single();
  if (!transferencia) return { error: "No se encontró esa transferencia" };

  // Cada cuenta de Mercado Pago es de un dueño: un local independiente solo vincula las transferencias de SU cuenta
  // (las que el aviso dejó marcadas con su sucursal) y los demás kioscos no tocan las de un local independiente.
  const { data: suc } = await (admin as any).from("sucursales").select("catalogo_propio").eq("id", data.sucursal_id).maybeSingle();
  if (suc?.catalogo_propio) {
    if (transferencia.sucursal_id !== data.sucursal_id) return { error: "Esa transferencia no es de la cuenta de esta sucursal" };
  } else if (transferencia.sucursal_id) {
    const { data: duena } = await (admin as any).from("sucursales").select("catalogo_propio").eq("id", transferencia.sucursal_id).maybeSingle();
    if (duena?.catalogo_propio) return { error: "Esa transferencia es de la cuenta de un local independiente" };
  }
  if (transferencia.movimiento_id) return { error: "Esa transferencia ya está vinculada a una venta" };

  // Hallazgo de la auditoría de seguridad del 08/08 (ver memoria del
  // proyecto): faltaba validar que la venta elegida sea realmente de esta
  // sucursal y que el monto coincida con el de la transferencia -- sin esto
  // se podía vincular cualquier venta a cualquier transferencia, sacándola
  // del radar del informe de conciliación sin que la plata realmente cuadre.
  const { data: movimiento } = await (admin as any)
    .from("movimientos")
    .select("sucursal_id, pago_transferencia")
    .eq("id", data.movimiento_id)
    .single();
  if (!movimiento) return { error: "No se encontró la venta" };
  if (movimiento.sucursal_id !== data.sucursal_id) {
    return { error: "Esa venta no pertenece a esta sucursal" };
  }
  if (Math.round((movimiento.pago_transferencia ?? 0) * 100) !== Math.round(transferencia.monto * 100)) {
    return { error: "El monto de la venta no coincide con el de la transferencia" };
  }

  const { error } = await (admin as any)
    .from("mercadopago_transferencias_recibidas")
    .update({
      movimiento_id: data.movimiento_id,
      sucursal_id:   data.sucursal_id,
      asignado_por:  userId,
      asignado_en:   new Date().toISOString(),
    })
    .eq("id", data.transferencia_id);
  if (error) return { error: error.message };

  return {};
}
