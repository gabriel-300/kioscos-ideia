import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Webhook de confirmación de pago del QR dinámico de Mercado Pago.
//
// IMPORTANTE: Mercado Pago documenta explícitamente que las notificaciones
// de Código QR NO se pueden validar con el header x-signature (a diferencia
// de otros productos como Checkout Pro) -- por eso la seguridad acá NO
// depende de la firma. En vez de confiar en el body de la notificación,
// SIEMPRE se vuelve a consultar el recurso real a la API de Mercado Pago con
// nuestro propio Access Token antes de marcar algo como pagado -- un aviso
// falso no puede lograr nada porque igual hace falta que el ID que menciona
// exista, esté aprobado en la cuenta real, y matchee una orden 'pendiente'
// nuestra por external_reference. Se valida la firma cuando está presente
// (más barato que la llamada a la API si el aviso es basura), pero no se
// rechaza solo por faltar.
//
// Mercado Pago manda notificaciones tanto por query string (?type=payment&
// data.id=...) como por body JSON, según el producto -- se soportan las dos.

// Comparación en tiempo constante -- no hay crypto.timingSafeEqual en el
// runtime de Cloudflare Workers (no es Node), así que se compara byte a
// byte acumulando en OR en vez de cortar en el primer byte distinto.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function firmaValida(request: NextRequest, dataId: string): Promise<boolean | null> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const signatureHeader = request.headers.get("x-signature");
  const requestId        = request.headers.get("x-request-id");
  if (!secret || !signatureHeader) return null; // no hay nada que validar -- ver nota arriba

  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return null;

  const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ""}ts:${ts};`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(manifest));
  const computedHex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqualHex(computedHex, v1);
}

export async function POST(request: NextRequest) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "Integración no configurada todavía (falta MERCADOPAGO_ACCESS_TOKEN)" }, { status: 501 });
  }

  const { searchParams } = request.nextUrl;
  let body: any = null;
  try { body = await request.json(); } catch { /* algunas notificaciones vienen sin body */ }

  const type   = body?.type ?? body?.topic ?? searchParams.get("type") ?? searchParams.get("topic");
  const dataId = body?.data?.id ?? searchParams.get("data.id") ?? searchParams.get("id");

  if (!dataId) return NextResponse.json({ ok: true }); // nada que procesar, no es un error

  const valida = await firmaValida(request, String(dataId));
  if (valida === false) {
    console.error("[mercadopago webhook] firma inválida, se ignora la notificación");
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    if (type === "payment") {
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`GET /v1/payments/${dataId} → ${res.status}`);
      const payment = await res.json() as { status: string; transaction_amount: number; external_reference: string | null };

      if (payment.status === "approved" && payment.external_reference) {
        await (admin as any)
          .from("mercadopago_qr_orders")
          .update({
            estado:               "pagado",
            paid_at:              new Date().toISOString(),
            mp_payment_id:        String(dataId),
            raw_webhook_payload:  payment,
          })
          .eq("external_reference", payment.external_reference)
          .eq("estado", "pendiente");
      }
    } else if (type === "order" || type === "qr") {
      // Formato de las notificaciones de orden todavía no confirmado contra
      // un webhook real (Mercado Pago documenta el endpoint pero no el
      // shape exacto de la respuesta) -- best-effort hasta poder probarlo
      // con las credenciales reales, ver nota en el plan de esta feature.
      const res = await fetch(`https://api.mercadopago.com/v1/orders/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`GET /v1/orders/${dataId} → ${res.status}`);
      const order = await res.json() as {
        status?: string;
        external_reference?: string;
        total_amount?: number;
        transactions?: { payments?: { status?: string; id?: string }[] };
      };

      const pagoAprobado = order.status === "processed" || order.status === "approved"
        || order.transactions?.payments?.some((p) => p.status === "approved");
      const paymentId = order.transactions?.payments?.[0]?.id ?? String(dataId);

      if (pagoAprobado && order.external_reference) {
        await (admin as any)
          .from("mercadopago_qr_orders")
          .update({
            estado:               "pagado",
            paid_at:              new Date().toISOString(),
            mp_payment_id:        String(paymentId),
            raw_webhook_payload:  order,
          })
          .eq("external_reference", order.external_reference)
          .eq("estado", "pendiente");
      }
    }
  } catch (e) {
    console.error("[mercadopago webhook] error procesando notificación:", (e as Error).message);
    // Igual respondemos 200 -- si reintentamos por un 5xx nuestro y el
    // problema persiste, Mercado Pago va a seguir reintentando en bucle sin
    // necesidad; queda en los logs para revisar a mano.
  }

  return NextResponse.json({ ok: true });
}

// Mercado Pago también puede pegarle con GET a la URL de notificación
// (formato IPN viejo, ?topic=payment&id=...) -- se resuelve igual que el POST.
export async function GET(request: NextRequest) {
  return POST(request);
}
