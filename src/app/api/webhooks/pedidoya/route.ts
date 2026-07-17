import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Webhook de pedidos de PedidosYa.
//
// Todavía no tenemos acceso al Vendor Portal ni a la documentación real del
// payload (gestión comercial en curso -- ver memoria del proyecto). Hasta
// entonces este endpoint NO arma movimientos de venta solo: se limita a
// autenticar la llamada y guardar el payload crudo en
// pedidoya_webhook_events, para poder inspeccionarlo apenas PedidosYa mande
// pedidos de prueba a la tienda de test y recién ahí terminar el mapeo real
// (nombres de campo, estructura de items, cómo confirmar el pedido, etc.).
//
// PEDIDOYA_WEBHOOK_TOKEN se completa cuando llegue el token del Vendor
// Portal -- mientras tanto el endpoint responde 501 y no acepta nada.

function extractField(payload: unknown, candidates: string[]): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  for (const key of candidates) {
    const value = obj[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return null;
}

export async function POST(request: Request) {
  const token = process.env.PEDIDOYA_WEBHOOK_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Integración no configurada todavía (falta PEDIDOYA_WEBHOOK_TOKEN)" },
      { status: 501 }
    );
  }

  // TODO: ajustar el mecanismo de auth cuando sepamos cuál usa realmente
  // PedidosYa (puede ser un bearer token simple, una firma en header, o PGP
  // como en otras integraciones de Delivery Hero).
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido, se esperaba JSON" }, { status: 400 });
  }

  // Nombres de campo "más probables" según integraciones similares -- son un
  // best-effort, no rompen nada si no matchean, solo quedan null.
  const externalOrderId = extractField(payload, ["orderId", "order_id", "id"]);
  const externalStoreId = extractField(payload, ["storeId", "store_id", "remoteId", "remote_id"]);

  const supabase = createAdminClient();

  let sucursalId: string | null = null;
  if (externalStoreId) {
    const sucursalRes = await (supabase as any)
      .from("sucursales")
      .select("id")
      .eq("pedidoya_store_id", externalStoreId)
      .maybeSingle();
    sucursalId = (sucursalRes.data as { id: string } | null)?.id ?? null;
  }

  const insertRes = await (supabase as any).from("pedidoya_webhook_events").insert({
    raw_payload:       payload,
    external_order_id: externalOrderId,
    external_store_id: externalStoreId,
    sucursal_id:        sucursalId,
    status:             "received",
  });

  if (insertRes.error) {
    // Igual respondemos 200: si el problema es nuestro y PedidosYa reintenta
    // por un 5xx, preferimos verlo en los logs de la función antes que
    // arriesgarnos a que un timeout haga perder el pedido en su lado.
    console.error("[pedidoya webhook] error guardando evento:", insertRes.error.message);
  }

  return NextResponse.json({ ok: true });
}
