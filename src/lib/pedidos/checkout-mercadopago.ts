import type { createAdminClient } from "@/lib/supabase/server";
import { urlSeguimiento } from "./enlaces";

// Cobro automático de un pedido online con Mercado Pago (Checkout Pro).
//
// Al confirmar el pedido se crea una "preferencia" de pago con el total que calculó el servidor y
// se le da al cliente el enlace para pagar con tarjeta, débito o dinero en cuenta. La orden se
// guarda en mercadopago_qr_orders (la misma tabla del QR del mostrador) con el pedido enlazado:
// cuando Mercado Pago avisa que el pago se aprobó, el webhook (api/webhooks/mercadopago) pasa la
// orden a "pagado", confirma el monto contra la API y llama a crearVentaPublica. Acá no se
// marca nada como pagado: solo se arma el enlace.
//
// Si algo falla (sin credenciales, Mercado Pago caído) devuelve url null y el pedido sigue
// funcionando como antes: queda "esperando pago" y el local lo confirma a mano.

type Admin = ReturnType<typeof createAdminClient>;

export type PedidoParaCheckout = {
  id:          string;
  numero:      number;
  sucursal_id: string;
  total:       number;
  expira_en:   string | null; // el enlace deja de aceptar pagos cuando vence el pedido
};

const URL_PREFERENCIAS = "https://api.mercadopago.com/checkout/preferences";

export async function crearCheckoutMercadoPago(admin: Admin, pedido: PedidoParaCheckout): Promise<{ url: string | null; error?: string }> {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return { url: null, error: "Mercado Pago no está configurado" };
  if (!(pedido.total > 0)) return { url: null, error: "El pedido no tiene un total para cobrar" };

  const externalReference = crypto.randomUUID();
  const { error: insertError } = await (admin as any).from("mercadopago_qr_orders").insert({
    sucursal_id:        pedido.sucursal_id,
    external_reference: externalReference,
    monto:              pedido.total,
    estado:             "pendiente",
    pedido_id:          pedido.id,
  });
  if (insertError) return { url: null, error: insertError.message };

  const cancelarOrden = () => (admin as any).from("mercadopago_qr_orders").update({ estado: "cancelado" }).eq("external_reference", externalReference);

  // El aviso de pago va al mismo endpoint que el QR del mostrador (mismo dominio que ya usa).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kioscos-ideia.lytwyn-ideia.workers.dev";
  const volver = urlSeguimiento(pedido.sucursal_id, pedido.id);

  let respuesta: Response;
  try {
    respuesta = await fetch(URL_PREFERENCIAS, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        items: [{ id: pedido.id, title: `Angiru Food · Pedido #${pedido.numero}`, quantity: 1, unit_price: pedido.total, currency_id: "ARS" }],
        external_reference: externalReference,
        notification_url:   `${siteUrl}/api/webhooks/mercadopago`,
        back_urls:          { success: volver, pending: volver, failure: volver },
        auto_return:        "approved",
        statement_descriptor: "ANGIRU FOOD",
        ...(pedido.expira_en ? { expires: true, expiration_date_to: new Date(pedido.expira_en).toISOString() } : {}),
      }),
    });
  } catch (e) {
    await cancelarOrden();
    return { url: null, error: `No se pudo conectar con Mercado Pago: ${(e as Error).message}` };
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    await cancelarOrden();
    return { url: null, error: `Mercado Pago rechazó el checkout (${respuesta.status}): ${detalle.slice(0, 300) || "sin detalle"}` };
  }

  const preferencia = (await respuesta.json().catch(() => null)) as { init_point?: string } | null;
  const url = preferencia?.init_point ?? null;
  if (!url) {
    await cancelarOrden();
    return { url: null, error: "Mercado Pago no devolvió el enlace de pago" };
  }

  await (admin as any).from("mercadopago_qr_orders").update({ checkout_url: url }).eq("external_reference", externalReference);
  return { url };
}

// El enlace de un pedido que todavía espera el pago (para la página de seguimiento).
export async function enlaceDePagoDelPedido(admin: Admin, pedidoId: string): Promise<string | null> {
  const { data } = await (admin as any)
    .from("mercadopago_qr_orders")
    .select("checkout_url")
    .eq("pedido_id", pedidoId)
    .eq("estado", "pendiente")
    .not("checkout_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.checkout_url as string | undefined) ?? null;
}
