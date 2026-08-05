"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

// Cobro con QR dinámico de Mercado Pago -- mismo espíritu que
// transferencia-actions.ts/termos/actions.ts: devuelven {error?} en vez de
// throw (Next.js oculta el mensaje de las excepciones en Server Actions en
// producción). Sin las credenciales cargadas como secrets de Cloudflare
// (MERCADOPAGO_ACCESS_TOKEN/MERCADOPAGO_USER_ID), todo responde con un error
// claro -- mismo criterio que el webhook de PedidosYa antes de tener token.

async function checkAccesoSucursal(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  sucursalId: string
): Promise<string | null> {
  if (role === "encargado") {
    const { data: suc } = await admin.from("sucursales").select("encargado_user_id").eq("id", sucursalId).single();
    if (suc?.encargado_user_id !== userId) return "No tenés permisos para esta sucursal";
  }
  if (role === "vendedor") {
    const profileRes = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== sucursalId) return "No tenés permisos para esta sucursal";
  }
  return null;
}

function mpCredenciales() {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const userId       = process.env.MERCADOPAGO_USER_ID;
  if (!accessToken || !userId) return null;
  return { accessToken, userId };
}

export async function armarQrMercadoPago(data: {
  sucursal_id: string;
  monto:       number;
}): Promise<{ error?: string; external_reference?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  if (!(data.monto > 0)) return { error: "El monto tiene que ser mayor a 0" };

  const cred = mpCredenciales();
  if (!cred) return { error: "La integración de Mercado Pago todavía no está configurada" };

  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("mercadopago_pos_id")
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
        title:              "Kioscos IDEIA",
        notification_url:   `${siteUrl}/api/webhooks/mercadopago`,
        total_amount:        data.monto,
        items: [{
          title:       "Compra en Kioscos IDEIA",
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

  const cred = mpCredenciales();
  if (cred) {
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

  const { error } = await (admin as any).from("mercadopago_qr_orders").update({ estado: "cancelado" }).eq("external_reference", externalReference);
  if (error) return { error: error.message };

  return {};
}
