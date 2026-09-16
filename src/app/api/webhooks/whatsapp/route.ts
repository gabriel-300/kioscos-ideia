import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Webhook entrante de WhatsApp Cloud API. Siempre REGISTRA cada mensaje
// como contacto en el CRM de nichos (esto no cambió desde que se armó este
// webhook, set. 2026: costo por mensaje sin techo + riesgo real de que Meta
// banee el número si se automatiza mal, ver memoria del proyecto).
//
// Fase 3 del storefront (ver plan) reabre esa decisión A PROPÓSITO, pero
// solo para las sucursales que el usuario habilitó a vender online
// (mercadopago_pos_id cargado, mismo gate que ya usa el storefront) -- para
// cualquier otra sucursal el comportamiento sigue siendo el de siempre:
// solo logea el contacto, no responde nada.
//
// WHATSAPP_VERIFY_TOKEN y WHATSAPP_APP_SECRET se completan cuando Gabriel
// termine de dar de alta la app de WhatsApp Cloud API en Meta Business
// Manager -- mientras tanto ambos endpoints responden 501 y no aceptan nada.
// WHATSAPP_ACCESS_TOKEN (necesaria para que el bot pueda mandar algo de
// vuelta) todavía no existe tampoco -- hasta entonces, procesarMensajeBot()
// corre igual (guarda el carrito, etc.) pero enviarTexto/enviarBotones/
// enviarLista devuelven not_configured en vez de mandar nada real.

// Verificación inicial que hace Meta al configurar el webhook: un GET con
// hub.mode/hub.verify_token/hub.challenge -- si el token coincide, hay que
// devolver el challenge tal cual (texto plano, no JSON).
export async function GET(request: Request) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json(
      { error: "Integración no configurada todavía (falta WHATSAPP_VERIFY_TOKEN)" },
      { status: 501 }
    );
  }

  const url = new URL(request.url);
  const mode      = url.searchParams.get("hub.mode");
  const token     = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verificación inválida" }, { status: 403 });
}

// Meta firma el body crudo con HMAC-SHA256 usando el App Secret, en el header
// X-Hub-Signature-256 -- sin validar esto, cualquiera podría postear
// mensajes falsos directo al CRM. Web Crypto (no el módulo "crypto" de
// Node) a propósito: corre nativo tanto en Node como en el runtime de
// Cloudflare Workers donde se despliega esta app.
async function verificarFirma(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length).toLowerCase();

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer  = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

type WhatsAppInteractive = {
  button_reply?: { id?: string; title?: string };
  list_reply?:   { id?: string; title?: string };
};
type WhatsAppValue = {
  metadata?:  { phone_number_id?: string };
  contacts?:  { profile?: { name?: string }; wa_id?: string }[];
  messages?:  { id?: string; from?: string; type?: string; text?: { body?: string }; interactive?: WhatsAppInteractive }[];
};

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json(
      { error: "Integración no configurada todavía (falta WHATSAPP_APP_SECRET)" },
      { status: 501 }
    );
  }

  const rawBody = await request.text();
  const firmaOk = await verificarFirma(rawBody, request.headers.get("x-hub-signature-256"), appSecret);
  if (!firmaOk) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let payload: { entry?: { changes?: { value?: WhatsAppValue }[] }[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body inválido, se esperaba JSON" }, { status: 400 });
  }

  const supabase = createAdminClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // ej. eventos de "statuses" (entregado/leído), no son mensajes

      const phoneNumberId = value.metadata?.phone_number_id ?? null;

      let sucursalId: string | null = null;
      let sucursalHabilitadaParaBot = false;
      if (phoneNumberId) {
        const sucursalRes = await (supabase as any)
          .from("sucursales").select("id, is_active, mercadopago_pos_id")
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .maybeSingle();
        const sucursalRow = sucursalRes.data as { id: string; is_active: boolean; mercadopago_pos_id: string | null } | null;
        sucursalId = sucursalRow?.id ?? null;
        sucursalHabilitadaParaBot = !!sucursalRow?.is_active && !!sucursalRow?.mercadopago_pos_id;
      }

      for (const msg of value.messages) {
        const waId          = msg.from ?? null;
        const contactoNombre = value.contacts?.find((c) => c.wa_id === waId)?.profile?.name ?? null;
        // Para el log del CRM se usa el título tocado en un mensaje
        // interactivo en vez del placeholder "[interactive]" de antes --
        // mejora chica de paso, no cambia el criterio de qué se guarda.
        const textoInteractivo = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null;
        const texto          = msg.type === "text" ? (msg.text?.body ?? null) : (textoInteractivo ? `[${textoInteractivo}]` : `[${msg.type ?? "mensaje"}]`);

        // Insertar el evento PRIMERO reclama el slot de deduplicación de
        // forma atómica (índice único en wa_message_id) -- evita la ventana
        // de carrera de un SELECT-antes-de-INSERT si Meta reintenta la
        // entrega del mismo mensaje casi al mismo tiempo.
        const eventoRes = await (supabase as any).from("whatsapp_webhook_events").insert({
          raw_payload:      value,
          wa_message_id:    msg.id ?? null,
          wa_from:          waId,
          phone_number_id:  phoneNumberId,
          sucursal_id:      sucursalId,
          status:           sucursalId ? "processed" : "sin_sucursal",
        }).select("id").single();

        if (eventoRes.error) {
          if (eventoRes.error.code === "23505") continue; // ya procesado (reintento de Meta)
          console.error("[whatsapp webhook] error guardando evento:", eventoRes.error.message);
          continue;
        }
        if (!sucursalId) continue; // sin sucursal mapeada, no hay dónde cargar el contacto

        const contactoRes = await (supabase as any).from("contactos_crm").insert({
          sucursal_id:       sucursalId,
          canal:             "whatsapp",
          nombre_contacto:   contactoNombre,
          consulta_mensaje:  texto,
          estado:            "nuevo",
        }).select("id").single();

        if (contactoRes.error) {
          console.error("[whatsapp webhook] error creando contacto:", contactoRes.error.message);
          await (supabase as any).from("whatsapp_webhook_events")
            .update({ status: "error", error_message: contactoRes.error.message })
            .eq("id", eventoRes.data.id);
          continue;
        }

        await (supabase as any).from("whatsapp_webhook_events")
          .update({ contacto_id: contactoRes.data.id })
          .eq("id", eventoRes.data.id);

        // Fase 3 del storefront: el bot de pedidos, solo para sucursales
        // que vender online (mercadopago_pos_id cargado). Nunca debe poder
        // romper la respuesta 200 a Meta -- mismo criterio defensivo que ya
        // usa el webhook de Mercado Pago con crearVentaPublica.
        if (sucursalHabilitadaParaBot && waId) {
          try {
            const { procesarMensajeBot } = await import("@/lib/pedidos/bot-whatsapp");
            await procesarMensajeBot(supabase, {
              sucursalId: sucursalId!,
              phoneNumberId: phoneNumberId!,
              waId,
              nombrePerfil: contactoNombre,
              texto: msg.type === "text" ? (msg.text?.body ?? null) : null,
              interactive: msg.interactive ?? null,
            });
          } catch (e) {
            console.error("[whatsapp webhook] error en bot de pedidos:", (e as Error).message);
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
