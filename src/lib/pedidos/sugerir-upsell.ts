import { createAdminClient } from "@/lib/supabase/server";

// Fase 4 del storefront (ver plan de la Fase 2/3): sugiere UN producto
// complementario para subir el ticket, sin ser invasivo -- nunca bloquea ni
// se muestra si algo falla. Mismo patrón que interpretar-pedido-ia.ts
// (Groq, JSON mode con json_schema, modelo qwen/qwen3.6-27b ya verificado
// en la cuenta) -- se eligió Groq en vez de src/lib/openrouter.ts a
// propósito: openrouter.ts usa el router "openrouter/free" con parseo por
// regex, sin json_schema forzado, una garantía más débil para algo
// estructurado que esto necesita.
//
// Igual que el resto de la Fase 2/3: cada id que devuelve el modelo se
// valida contra el catálogo real antes de mostrarse -- si el modelo
// devuelve basura, no se sugiere nada, nunca rompe el checkout.

const MODELO = "qwen/qwen3.6-27b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export type SugerenciaUpsell = { id: string; esPromo: boolean; name: string; price: number; mensaje: string };

type ItemCatalogo = { id: string; esPromo: boolean; name: string; price: number; category_id: string };

const JSON_SCHEMA = {
  type: "object",
  properties: {
    id:      { type: ["string", "null"] },
    mensaje: { type: ["string", "null"] },
  },
  required: ["id", "mensaje"],
} as const;

function limpiarRespuesta(raw: string): string {
  const sinThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const sinMarkdown = sinThink.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  return sinMarkdown || sinThink || raw;
}

// Mismo filtro (categorias_habilitadas/promos_habilitadas/is_active/
// vendible_pos) que ya usan pricing.ts/bot-whatsapp.ts/page.tsx -- copiado
// a propósito, no importado desde ahí, mismo criterio ya usado en toda
// esta feature (cada módulo nuevo queda desacoplado de los demás).
async function cargarCatalogoParaUpsell(admin: ReturnType<typeof createAdminClient>, sucursalId: string): Promise<ItemCatalogo[]> {
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("categorias_habilitadas, promos_habilitadas")
    .eq("id", sucursalId)
    .single();
  const categoriasHabilitadas: string[] | null = sucursal?.categorias_habilitadas ?? null;
  const promosHabilitadas: boolean = sucursal?.promos_habilitadas ?? true;

  const [{ data: productsRaw }, { data: preciosRaw }, { data: promosRaw }, { data: preciosPromoRaw }] = await Promise.all([
    (admin as any).from("products").select("id, name, category_id, is_active, vendible_pos").eq("is_active", true).neq("sku", "MULTA-TERMO"),
    admin.from("product_prices").select("product_id, precio_dist").eq("sucursal_id", sucursalId),
    (admin as any).from("promos").select("id, name, price, is_active, category_id").eq("is_active", true),
    (admin as any).from("promo_prices").select("promo_id, price").eq("sucursal_id", sucursalId),
  ]);

  const precioProducto = new Map((preciosRaw ?? []).map((p: any) => [p.product_id as string, p.precio_dist as number]));
  const precioPromo = new Map((preciosPromoRaw ?? []).map((p: any) => [p.promo_id as string, p.price as number]));

  const items: ItemCatalogo[] = [];

  for (const p of (productsRaw ?? []) as any[]) {
    if (p.vendible_pos === false) continue;
    if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
      if (!p.category_id || !categoriasHabilitadas.includes(p.category_id)) continue;
    }
    const price = precioProducto.get(p.id);
    if (price == null || !(price > 0)) continue;
    items.push({ id: p.id, esPromo: false, name: p.name, price, category_id: p.category_id ?? "" });
  }

  if (promosHabilitadas) {
    for (const p of (promosRaw ?? []) as any[]) {
      if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
        if (!p.category_id || !categoriasHabilitadas.includes(p.category_id)) continue;
      }
      const price = precioPromo.get(p.id) ?? p.price;
      if (price == null || !(price > 0)) continue;
      items.push({ id: p.id, esPromo: true, name: p.name, price, category_id: p.category_id ?? "" });
    }
  }

  return items;
}

async function llamarIAUpsell(nombresEnCarrito: string[], candidatos: ItemCatalogo[]): Promise<SugerenciaUpsell | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || nombresEnCarrito.length === 0 || candidatos.length === 0) return null;

  // Tope de candidatos mandados al modelo -- no hace falta el catálogo
  // entero para elegir UNA sugerencia, y mantiene el prompt chico.
  const lista = candidatos.slice(0, 40);
  const catalogoTexto = lista.map((c) => `${c.id} | ${c.name} | $${c.price}`).join("\n");

  const systemPrompt =
    "Sos el asistente de un kiosco que sugiere UN producto complementario para sumar al pedido de un cliente, sin ser invasivo. Elegís algo que combine bien con lo que ya tiene en el carrito, de la lista de disponibles. Si nada combina bien, respondé id: null. Nunca inventes un id que no esté en la lista.";
  const userPrompt = `El cliente ya tiene en el carrito: ${nombresEnCarrito.join(", ")}.\n\nDisponible para sugerir (id | nombre | precio):\n${catalogoTexto}\n\nDevolvé el id EXACTO de UN producto de la lista (o null si ninguno combina bien) y un mensaje corto y amable en español (máx. 15 palabras) invitando a sumarlo.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODELO,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 300,
        reasoning_effort: "none", // evita el bloque <think> de qwen3.6-27b, ver groq.ts
        response_format: { type: "json_schema", json_schema: { name: "sugerencia_upsell", schema: JSON_SCHEMA } },
      }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const raw: string | undefined = data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(limpiarRespuesta(raw)) as { id?: unknown; mensaje?: unknown };
    if (typeof parsed.id !== "string") return null;

    const item = lista.find((c) => c.id === parsed.id);
    if (!item) return null; // el modelo devolvió un id que no existe de verdad -- se descarta

    const mensaje = typeof parsed.mensaje === "string" && parsed.mensaje.trim() ? parsed.mensaje.trim() : `¿Le sumás ${item.name}?`;
    return { id: item.id, esPromo: item.esPromo, name: item.name, price: item.price, mensaje };
  } catch {
    return null;
  }
}

// Punto de entrada único: carga el catálogo real de la sucursal, separa lo
// que ya está en el carrito (por id, nunca por nombre que mande el
// cliente) y le pide a la IA una sugerencia entre lo que falta.
export async function sugerirUpsellParaSucursal(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  idsEnCarrito: string[]
): Promise<SugerenciaUpsell | null> {
  const catalogo = await cargarCatalogoParaUpsell(admin, sucursalId);
  const enCarrito = new Set(idsEnCarrito);
  const nombresEnCarrito = catalogo.filter((i) => enCarrito.has(i.id)).map((i) => i.name);
  const candidatos = catalogo.filter((i) => !enCarrito.has(i.id));
  return llamarIAUpsell(nombresEnCarrito, candidatos);
}
