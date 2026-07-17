// Lectura de remitos/facturas por foto usando OpenRouter (gratis, no Claude --
// mismo servicio que ya se usa en el proyecto "megaseguridad" del usuario,
// vía su router de modelos gratuitos). Mismo patrón de prompt/parseo que ahí:
// pedirle que devuelva SOLO un JSON, sin markdown, sacar los ```json si vienen
// igual, y JSON.parse con try/catch para nunca romper la acción si el modelo
// devuelve algo raro.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openrouter/free";

const SYSTEM_PROMPT = `Sos un asistente que lee remitos y facturas de un kiosco a partir de una foto.`;

const USER_PROMPT = `Extraé TODAS las líneas de productos que veas en la foto del remito o factura, con:
- "producto": el nombre del producto tal cual está escrito
- "cantidad": la cantidad numérica (si dice "x12" o "12 un", el número es 12)
- "precio": el precio UNITARIO de esa línea (no el subtotal de la línea, no el total del remito)

Si no podés leer con claridad algún dato de una línea, hacé tu mejor estimación pero no inventes líneas que no existen.

Respondé ÚNICAMENTE con un array JSON, sin texto antes ni después, sin marcado de código, con esta forma exacta:
[{"producto": "string", "cantidad": number, "precio": number}]

Si no hay ninguna línea legible, respondé con un array vacío: []`;

export type LineaRemito = { producto: string; cantidad: number; precio: number };

export async function extraerRemito(imageBase64: string, mimeType: string): Promise<LineaRemito[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY no está configurada");

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer":  process.env.NEXT_PUBLIC_APP_URL || "https://kiosco-ideia.local",
      "X-Title":       "Kioscos IDEIA — lectura de remitos",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: USER_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`No se pudo leer la foto (OpenRouter respondió ${res.status}): ${detalle.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("La foto no devolvió ningún texto legible");

  const limpio = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  const match = limpio.match(/\[[\s\S]*\]/);
  const paraParsear = match ? match[0] : limpio;

  let lineas: unknown;
  try {
    lineas = JSON.parse(paraParsear);
  } catch {
    throw new Error("No se pudo interpretar lo que leyó la foto -- cargá el remito a mano");
  }

  if (!Array.isArray(lineas)) throw new Error("La lectura de la foto no tiene el formato esperado");

  return lineas
    .filter((l): l is LineaRemito =>
      !!l && typeof l === "object" &&
      typeof (l as LineaRemito).producto === "string" &&
      typeof (l as LineaRemito).cantidad === "number" &&
      typeof (l as LineaRemito).precio === "number"
    );
}
