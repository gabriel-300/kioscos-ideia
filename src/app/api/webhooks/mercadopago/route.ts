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

// Un pago aprobado cuya external_reference SÍ es de una orden nuestra pero que
// no se pudo pasar de "pendiente" a "pagado": o es un reenvío del mismo aviso
// (ya procesado, no hay nada que hacer) o es plata real que llegó sobre una
// orden cancelada/vencida (el cliente escaneó justo cuando el cajero canceló,
// o el QR quedó a la vista) o un SEGUNDO pago sobre una orden ya cobrada. Antes
// esos casos se daban por "ya procesados" y la plata no aparecía en ninguna
// lista (auditoría 19/09/2026, M-02): ahora quedan en "pagos sin conciliar".
// Devuelve true si la external_reference pertenece a una orden nuestra.
async function registrarPagoSinOrdenPendiente(
  admin: any,
  externalReference: string,
  mpPaymentId: string,
  monto: number,
  raw: unknown,
): Promise<boolean> {
  const { data: orden } = await admin
    .from("mercadopago_qr_orders")
    .select("sucursal_id, estado, mp_payment_id")
    .eq("external_reference", externalReference)
    .maybeSingle();
  if (!orden) return false;
  if (orden.estado === "pagado" && orden.mp_payment_id === mpPaymentId) return true; // reenvío ya procesado

  await admin
    .from("mercadopago_transferencias_recibidas")
    .upsert(
      { mp_payment_id: mpPaymentId, monto, sucursal_id: orden.sucursal_id, raw_payload: raw },
      { onConflict: "mp_payment_id", ignoreDuplicates: true },
    );
  console.warn(`[mercadopago webhook] pago ${mpPaymentId} sobre orden en estado "${orden.estado}" -- guardado en pagos sin conciliar`);
  return true;
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

  // El id se interpola en la URL de la API de Mercado Pago con NUESTRO token: solo caracteres de id
  // (letras, números, guion). Un valor con "../" apuntaría a otros endpoints (auditoría 19/09, H-11).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(dataId))) {
    console.warn("[mercadopago webhook] data.id con formato inválido, se ignora");
    return NextResponse.json({ ok: true });
  }

  // NO se rechaza la notificación por firma inválida/ausente -- Mercado Pago
  // documenta que las notificaciones de Código QR no siempre son validables
  // con x-signature (confirmado con datos reales: llegaron sin firma
  // calculable acá). Solo se loguea como dato -- la seguridad real es la
  // consulta a la API más abajo con nuestro propio Access Token, ver nota
  // del encabezado del archivo.
  const valida = await firmaValida(request, String(dataId));
  if (valida === false) {
    console.warn("[mercadopago webhook] firma no coincide (se sigue procesando igual, la verificación real es contra la API)");
  }

  const admin = createAdminClient();

  try {
    if (type === "payment") {
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`GET /v1/payments/${dataId} → ${res.status}`);
      const payment = await res.json() as {
        status: string; transaction_amount: number; external_reference: string | null; payment_type_id?: string;
      };

      if (payment.status === "approved") {
        let matcheoOrdenQr = false;
        if (payment.external_reference) {
          // El monto cobrado tiene que ser el de la orden: si es otro, NO se marca como pagada (el
          // QR es de importe fijo, así que una diferencia es rara) y el pago queda en "pagos sin
          // conciliar" para revisarlo a mano (auditoría 19/09, H-11).
          const { data: ordenPrevia } = await (admin as any)
            .from("mercadopago_qr_orders")
            .select("monto, estado")
            .eq("external_reference", payment.external_reference)
            .maybeSingle();
          const montoDistinto = !!ordenPrevia && ordenPrevia.estado === "pendiente"
            && Math.round(Number(ordenPrevia.monto) * 100) !== Math.round(Number(payment.transaction_amount) * 100);
          if (montoDistinto) {
            await registrarPagoSinOrdenPendiente(admin, payment.external_reference, String(dataId), payment.transaction_amount, payment);
          }

          const { data: actualizados } = montoDistinto ? { data: null } : await (admin as any)
            .from("mercadopago_qr_orders")
            .update({
              estado:               "pagado",
              paid_at:              new Date().toISOString(),
              mp_payment_id:        String(dataId),
              raw_webhook_payload:  payment,
            })
            .eq("external_reference", payment.external_reference)
            .eq("estado", "pendiente")
            .select("id, pedido_id");
          matcheoOrdenQr = montoDistinto || (!!actualizados && actualizados.length > 0);

          // Fase 2 del storefront: esta es la ÚNICA vez que se puede disparar
          // la venta de un pedido público -- el UPDATE de arriba solo matchea
          // (row-locking de Postgres) la primera vez que esta orden pasa de
          // 'pendiente' a 'pagado', nunca en un reenvío de la misma
          // notificación. pedido_id es siempre null en el tráfico real de
          // hoy (staff cobrando desde el mostrador), así que esto no cambia
          // nada de lo que ya funciona.
          if (actualizados?.[0]?.pedido_id) {
            const { crearVentaPublica } = await import("@/lib/pedidos/crear-venta-publica");
            const res = await crearVentaPublica(admin, actualizados[0].pedido_id);
            if (res.error) console.error("[mercadopago webhook] crearVentaPublica falló:", res.error);
          }

          // Mercado Pago puede reenviar la notificación del MISMO pago más
          // de una vez -- la segunda vez ya no hay ninguna fila 'pendiente'
          // para actualizar (ya quedó 'pagada' la primera vez), así que el
          // update de arriba no matchea nada aunque sí sea un pago de QR. Sin
          // este chequeo, ese reenvío caía por error en la rama de abajo y
          // se guardaba como si fuera una transferencia nueva sin dueño,
          // duplicando en "Pagos por transferencia sin conciliar" un pago
          // que ya estaba conciliado de verdad (confirmado con datos reales:
          // así aparecieron 8 "transferencias" que en realidad eran pagos de
          // QR interoperable -- otro banco escaneando nuestro QR, que
          // Mercado Pago reporta con payment_type_id "bank_transfer" igual
          // que una transferencia manual).
          if (!matcheoOrdenQr) {
            matcheoOrdenQr = await registrarPagoSinOrdenPendiente(
              admin, payment.external_reference, String(dataId), payment.transaction_amount, payment,
            );
          }
        }

        // No corresponde a ninguna orden de QR armada de antemano (ni nueva
        // ni ya procesada) -- si es una transferencia bancaria a esta misma
        // cuenta (el cliente no pudo escanear el QR y transfirió en su
        // lugar, ver conciliacion-mercadopago), se guarda para que alguien
        // la vincule a mano a la venta correspondiente desde "Pagos por
        // transferencia sin conciliar". ignoreDuplicates: Mercado Pago puede
        // reintentar la misma notificación más de una vez.
        if (!matcheoOrdenQr && payment.payment_type_id === "bank_transfer") {
          await (admin as any)
            .from("mercadopago_transferencias_recibidas")
            .upsert(
              { mp_payment_id: String(dataId), monto: payment.transaction_amount, raw_payload: payment },
              { onConflict: "mp_payment_id", ignoreDuplicates: true }
            );
        }
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
        const { data: actualizados } = await (admin as any)
          .from("mercadopago_qr_orders")
          .update({
            estado:               "pagado",
            paid_at:              new Date().toISOString(),
            mp_payment_id:        String(paymentId),
            raw_webhook_payload:  order,
          })
          .eq("external_reference", order.external_reference)
          .eq("estado", "pendiente")
          .select("id, pedido_id");

        // Mismo criterio que la rama "payment" de arriba -- ver comentario ahí.
        if (actualizados && actualizados.length > 0 && actualizados[0].pedido_id) {
          const { crearVentaPublica } = await import("@/lib/pedidos/crear-venta-publica");
          const res = await crearVentaPublica(admin, actualizados[0].pedido_id);
          if (res.error) console.error("[mercadopago webhook] crearVentaPublica falló (order/qr):", res.error);
        }
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
