// Lectura de facturas/remitos argentinos por foto. La llamada a la IA va por
// la cadena de src/lib/ia/completar-json.ts (Groq y, si falla, modelos gratis
// de OpenRouter); acá quedan el prompt, el esquema de un comprobante y las
// validaciones.
//
// Alimenta datos contables reales (montos, CUIT), así que NO se confía
// ciegamente en el resultado: validarComprobante() devuelve advertencias de
// consistencia que hay que revisar antes de dar por buena una lectura, y
// loguearComprobanteInconsistente() deja rastro server-side de los casos con
// advertencias o parseo fallido, para poder auditar la tasa de error real
// con una muestra antes de confiar el pipeline sin revisión humana.

import { completarJson } from "@/lib/ia/completar-json";

export type ItemComprobante = {
  descripcion:     string;
  cantidad:        number;
  precio_unitario: number;
};

export type ComprobanteLeido = {
  proveedor:          string | null;
  cuit:               string | null;
  fecha:              string | null; // YYYY-MM-DD si se pudo interpretar, sino como está escrita
  numero_comprobante: string | null;
  items:              ItemComprobante[];
  subtotal:           number | null;
  iva:                number | null;
  total:              number | null;
  motor:              string; // eslabón que respondió, ej. "groq:qwen/qwen3.8-27b"
};

const JSON_SCHEMA = {
  type: "object",
  properties: {
    proveedor:          { type: ["string", "null"] },
    cuit:               { type: ["string", "null"] },
    fecha:              { type: ["string", "null"] },
    numero_comprobante: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          descripcion:     { type: "string" },
          cantidad:        { type: "number" },
          precio_unitario: { type: "number" },
        },
        required: ["descripcion", "cantidad", "precio_unitario"],
      },
    },
    subtotal: { type: ["number", "null"] },
    iva:      { type: ["number", "null"] },
    total:    { type: ["number", "null"] },
  },
  required: ["proveedor", "cuit", "fecha", "numero_comprobante", "items", "subtotal", "iva", "total"],
} as const;

const SYSTEM_PROMPT =
  "Sos un asistente que lee facturas y remitos argentinos a partir de una foto y extrae sus datos estructurados con precisión.";

const USER_PROMPT = `Extraé de esta factura o remito:
- "proveedor": razón social o nombre del emisor
- "cuit": CUIT del emisor, formato XX-XXXXXXXX-X si se puede leer, sino null
- "fecha": fecha de emisión en formato YYYY-MM-DD si se puede interpretar, sino tal cual está escrita, sino null
- "numero_comprobante": número de factura/remito (ej. "0001-00012345")
- "items": todas las líneas de productos, con "descripcion" (texto tal cual figura), "cantidad" y "precio_unitario" (precio UNITARIO de esa línea, no el subtotal de la línea ni el total del comprobante)
- "subtotal": subtotal antes de impuestos, si figura
- "iva": monto de IVA, si figura
- "total": total del comprobante

Si no podés leer con claridad algún dato de cabecera, usá null. Los items siempre van con tu mejor estimación, pero no inventes líneas que no existen en la foto.`;

// 2048: de sobra para el JSON de un remito real (una línea por producto
// ronda 20-25 tokens), dejando margen bajo el límite de 8000 tokens/minuto del
// tier gratuito de Groq para la imagen + el prompt.
const MAX_TOKENS_LECTURA = 2048;

export async function leerComprobanteConGroq(imageBase64: string, mimeType: string): Promise<ComprobanteLeido> {
  try {
    const { valor, motor } = await completarJson(
      {
        sistema: SYSTEM_PROMPT,
        usuario: USER_PROMPT,
        imagen: { base64: imageBase64, mimeType },
        schema: JSON_SCHEMA,
        nombreSchema: "comprobante_argentino",
        maxTokens: MAX_TOKENS_LECTURA,
      },
      (texto) => normalizarComprobante(JSON.parse(texto))
    );
    return { ...valor, motor };
  } catch (error) {
    loguearComprobanteInconsistente({ etapa: "lectura_fallo", detalle: (error as Error).message });
    throw new Error(`No se pudo leer la foto -- cargá el comprobante a mano. (${(error as Error).message})`);
  }
}

function normalizarComprobante(raw: unknown): Omit<ComprobanteLeido, "motor"> {
  const r = (raw ?? {}) as Record<string, unknown>;

  const items: ItemComprobante[] = Array.isArray(r.items)
    ? (r.items as unknown[])
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
        .filter((i) =>
          typeof i.descripcion === "string" &&
          typeof i.cantidad === "number" &&
          typeof i.precio_unitario === "number"
        )
        .map((i) => ({
          descripcion:     i.descripcion as string,
          cantidad:        i.cantidad as number,
          precio_unitario: i.precio_unitario as number,
        }))
    : [];

  return {
    proveedor:          typeof r.proveedor === "string" ? r.proveedor : null,
    cuit:               typeof r.cuit === "string" ? r.cuit : null,
    fecha:              typeof r.fecha === "string" ? r.fecha : null,
    numero_comprobante: typeof r.numero_comprobante === "string" ? r.numero_comprobante : null,
    items,
    subtotal: typeof r.subtotal === "number" ? r.subtotal : null,
    iva:      typeof r.iva === "number" ? r.iva : null,
    total:    typeof r.total === "number" ? r.total : null,
  };
}

// Validaciones de consistencia -- no bloquean el resultado (siempre se
// devuelve lo leído por leerComprobanteConGroq), pero marcan advertencias
// para decidir si conviene revisar a mano antes de guardar.
export function validarComprobante(datos: ComprobanteLeido): string[] {
  const advertencias: string[] = [];

  if (datos.items.length === 0) {
    advertencias.push("No se leyó ninguna línea de producto");
  }

  if (!datos.cuit) {
    advertencias.push("No se pudo leer el CUIT");
  } else if (!/^\d{2}-?\d{8}-?\d{1}$/.test(datos.cuit.replace(/\s/g, ""))) {
    advertencias.push(`El CUIT leído no tiene un formato válido: "${datos.cuit}"`);
  }

  if (!datos.total) {
    advertencias.push("No se pudo leer el total del comprobante");
  }

  const sumaItems = datos.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
  if (datos.items.length > 0 && datos.subtotal != null) {
    const tolerancia = Math.max(1, datos.subtotal * 0.02);
    if (Math.abs(sumaItems - datos.subtotal) > tolerancia) {
      advertencias.push(
        `La suma de los ítems (${sumaItems.toFixed(2)}) no coincide con el subtotal leído (${datos.subtotal.toFixed(2)})`
      );
    }
  }

  if (datos.subtotal != null && datos.iva != null && datos.total != null) {
    const totalCalculado = datos.subtotal + datos.iva;
    const tolerancia     = Math.max(1, datos.total * 0.02);
    if (Math.abs(totalCalculado - datos.total) > tolerancia) {
      advertencias.push(
        `Subtotal + IVA (${totalCalculado.toFixed(2)}) no coincide con el total leído (${datos.total.toFixed(2)})`
      );
    }
  }

  return advertencias;
}

// Deja rastro en los logs del Worker (visible vía `wrangler tail` / dashboard
// de Cloudflare) de una lectura que falló o quedó con advertencias -- sirve
// para juntar una muestra real y medir la tasa de error antes de confiar en
// el pipeline sin revisión humana, tal como advierte Groq sobre sus modelos
// "preview". No persiste en la base a propósito: es una traza de operación,
// no un dato de negocio que necesite su propia tabla/RLS/UI de revisión.
export function loguearComprobanteInconsistente(info: { etapa: string; detalle: string; advertencias?: string[] }) {
  console.error("[groq-comprobante] lectura inconsistente", {
    etapa:        info.etapa,
    advertencias: info.advertencias ?? [],
    detalle:      info.detalle,
    timestamp:    new Date().toISOString(),
  });
}
