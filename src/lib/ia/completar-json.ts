// Cliente único de IA para todo lo que pide una respuesta JSON (lectura de
// remitos por foto, interpretación de pedidos del bot, sugerencia de upsell).
//
// Una sola IA es un punto único de falla: Groq ya retiró dos modelos de esta
// cuenta sin aviso (llama-4-scout, después qwen3.6-27b -> qwen3.8-27b) y los
// tres usos se cayeron en silencio. Por eso se prueba en cadena:
//   1. Groq (JSON forzado por schema, es el más confiable)
//   2. hasta 3 modelos gratuitos con imagen de OpenRouter (JSON pedido por prompt)
// y se pasa al siguiente ante cualquier falla: modelo inexistente, sobrecarga,
// falta de key, o una respuesta que el llamador no puede interpretar.
// Diseño portado del proyecto "minutas", que ya corre así en producción.
//
// Si la cadena entera falla se lanza un error con el motivo de cada eslabón;
// cada llamador decide qué hacer (el bot cae al menú, el upsell no sugiere,
// el remito se carga a mano). Si esto vuelve a romperse: GET
// https://api.groq.com/openai/v1/models (con la key) y
// https://openrouter.ai/api/v1/models muestran qué modelos quedan.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELO = "qwen/qwen3.8-27b";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Gratuitos, con soporte de imagen (verificados 2026-09-29).
const OPENROUTER_MODELOS = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
];

// Sobrecarga o rate limit: vale reintentar el mismo modelo antes de pasar al siguiente.
const HTTP_REINTENTABLE = new Set([429, 500, 502, 503, 504]);

export type ImagenIA = { base64: string; mimeType: string };

export type PedidoIA = {
  sistema:      string;
  usuario:      string;
  imagen?:      ImagenIA;
  schema:       object;   // JSON Schema de la respuesta
  nombreSchema: string;
  maxTokens:    number;
  temperatura?: number;   // 0.1 por defecto: son extracciones, no creatividad
  timeoutMs?:   number;   // por llamada; 30 s por defecto
};

export type RespuestaIA<T> = { valor: T; motor: string };

class ErrorProveedor extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

// Los modelos con "thinking" anteponen <think>…</think> y varios envuelven el
// JSON en ```json.
export function limpiarRespuesta(raw: string): string {
  const sinThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const sinMarkdown = sinThink.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  return sinMarkdown || sinThink || raw;
}

function mensajes(p: PedidoIA, textoUsuario: string) {
  const contenido = p.imagen
    ? [
        { type: "text", text: textoUsuario },
        { type: "image_url", image_url: { url: `data:${p.imagen.mimeType};base64,${p.imagen.base64}` } },
      ]
    : textoUsuario;
  return [{ role: "system", content: p.sistema }, { role: "user", content: contenido }];
}

async function leerRespuesta(res: Response, etiqueta: string): Promise<string> {
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new ErrorProveedor(`${etiqueta} respondió ${res.status}: ${detalle.slice(0, 300)}`, res.status);
  }
  const data = await res.json();
  if (data?.error) throw new ErrorProveedor(`${etiqueta}: ${data.error.message ?? "error desconocido"}`, Number(data.error.code) || undefined);
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) throw new ErrorProveedor(`${etiqueta} no devolvió ningún texto legible`);
  return raw;
}

async function pedirAGroq(p: PedidoIA): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new ErrorProveedor("GROQ_API_KEY no está configurada");
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(p.timeoutMs ?? 30_000),
    body: JSON.stringify({
      model: GROQ_MODELO,
      messages: mensajes(p, p.usuario),
      temperature: p.temperatura ?? 0.1,
      max_tokens: p.maxTokens,
      // Sin esto los qwen anteponen un bloque <think> y, con el tope de 8000
      // tokens/minuto del tier gratuito, el pedido puede rebotar con 413.
      reasoning_effort: "none",
      response_format: { type: "json_schema", json_schema: { name: p.nombreSchema, schema: p.schema } },
    }),
  });
  return leerRespuesta(res, `Groq (${GROQ_MODELO})`);
}

async function pedirAOpenRouter(modelo: string, p: PedidoIA): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new ErrorProveedor("OPENROUTER_API_KEY no está configurada");
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://kiosco-ideia.local",
      "X-Title": "Kioscos IDEIA",
    },
    signal: AbortSignal.timeout(p.timeoutMs ?? 30_000),
    body: JSON.stringify({
      model: modelo,
      // No todos los proveedores detrás de OpenRouter respetan json_schema:
      // se pide el JSON por prompt y se limpia igual.
      messages: mensajes(p, `${p.usuario}\n\nRespondé ÚNICAMENTE con el JSON pedido, sin texto adicional antes ni después y sin bloques de código markdown.`),
      temperature: p.temperatura ?? 0.1,
      max_tokens: p.maxTokens,
    }),
  });
  return leerRespuesta(res, `OpenRouter (${modelo})`);
}

async function conReintento<T>(fn: () => Promise<T>, intentos: number): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof ErrorProveedor ? e.status : undefined;
      if (i >= intentos || status == null || !HTTP_REINTENTABLE.has(status)) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// `interpretar` convierte el texto en el valor final y TIRA si no sirve
// (JSON roto, campos que faltan): en ese caso se prueba el siguiente eslabón.
export async function completarJson<T>(p: PedidoIA, interpretar: (texto: string) => T): Promise<RespuestaIA<T>> {
  const eslabones: { motor: string; pedir: () => Promise<string>; intentos: number }[] = [
    { motor: `groq:${GROQ_MODELO}`, pedir: () => pedirAGroq(p), intentos: 2 },
    ...OPENROUTER_MODELOS.map((m) => ({ motor: `openrouter:${m}`, pedir: () => pedirAOpenRouter(m, p), intentos: 1 })),
  ];

  const fallas: string[] = [];
  for (const { motor, pedir, intentos } of eslabones) {
    try {
      const raw = await conReintento(pedir, intentos);
      return { valor: interpretar(limpiarRespuesta(raw)), motor };
    } catch (e) {
      const motivo = (e as Error).message;
      fallas.push(`${motor}: ${motivo}`);
      console.error("[ia] falló un eslabón de la cadena", { nombreSchema: p.nombreSchema, motor, motivo });
    }
  }
  throw new Error(`Ningún modelo de IA pudo responder. (${fallas.join(" · ")})`);
}
