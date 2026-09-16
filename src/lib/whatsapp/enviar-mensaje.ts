// Helpers finos sobre la Graph API de WhatsApp Cloud para mandar mensajes
// salientes (Fase 3 del storefront -- ver plan). Separado de
// src/app/api/webhooks/whatsapp/route.ts (que solo RECIBE) a propósito,
// mismo criterio de un módulo chico y reusable que src/lib/groq.ts.
//
// Gateado por WHATSAPP_ACCESS_TOKEN, que todavía no existe (falta que el
// usuario complete el alta de la app en Meta Business Manager) -- cada
// función devuelve {ok:false, error:"not_configured"} en vez de tirar, así
// el bot puede construirse y probarse entero ahora mismo (el envío real
// queda inerte hasta que la variable de entorno exista), mismo patrón que
// MERCADOPAGO_ACCESS_TOKEN/REPOSICION_API_TOKEN en el resto del proyecto.

const GRAPH_URL = "https://graph.facebook.com/v21.0";

type ResultadoEnvio = { ok: true; wa_message_id?: string } | { ok: false; error: string };

async function postMensaje(phoneNumberId: string, body: Record<string, unknown>): Promise<ResultadoEnvio> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "not_configured" };

  try {
    const res = await fetch(`${GRAPH_URL}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      return { ok: false, error: `WhatsApp API ${res.status}: ${detalle.slice(0, 300)}` };
    }
    const data = await res.json() as { messages?: { id?: string }[] };
    return { ok: true, wa_message_id: data?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function enviarTexto(phoneNumberId: string, to: string, body: string): Promise<ResultadoEnvio> {
  return postMensaje(phoneNumberId, {
    to,
    type: "text",
    text: { body: body.slice(0, 4096) }, // límite real de WhatsApp para mensajes de texto
  });
}

export type BotonMensaje = { id: string; title: string };

// Máx. 3 botones, título máx. 20 caracteres -- límites reales de Meta, no
// configurables. Se recorta acá en vez de confiar en que cada llamador lo
// respete.
export async function enviarBotones(phoneNumberId: string, to: string, body: string, botones: BotonMensaje[]): Promise<ResultadoEnvio> {
  return postMensaje(phoneNumberId, {
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      action: {
        buttons: botones.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

export type FilaLista = { id: string; title: string; description?: string };
export type SeccionLista = { title: string; rows: FilaLista[] };

// Máx. 10 filas TOTALES entre todas las secciones, título de fila máx. 24
// caracteres, descripción máx. 72 -- límites reales de Meta. Quien arma las
// secciones (bot-whatsapp.ts) ya pagina para no pasarse de 10, pero se
// recorta también acá como defensa en profundidad.
export async function enviarLista(
  phoneNumberId: string, to: string, body: string, buttonText: string, sections: SeccionLista[]
): Promise<ResultadoEnvio> {
  let filasRestantes = 10;
  const seccionesRecortadas = sections
    .map((s) => {
      if (filasRestantes <= 0) return null;
      const rows = s.rows.slice(0, filasRestantes).map((r) => ({
        id: r.id,
        title: r.title.slice(0, 24),
        description: r.description?.slice(0, 72),
      }));
      filasRestantes -= rows.length;
      return { title: s.title.slice(0, 24), rows };
    })
    .filter((s): s is { title: string; rows: { id: string; title: string; description: string | undefined }[] } => !!s && s.rows.length > 0);

  return postMensaje(phoneNumberId, {
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body.slice(0, 1024) },
      action: { button: buttonText.slice(0, 20), sections: seccionesRecortadas },
    },
  });
}
