import { createAdminClient } from "@/lib/supabase/server";
import { completarJson } from "@/lib/ia/completar-json";
import { cargarCatalogoSucursal, type ItemCatalogo } from "./catalogo";

// Sugiere UN producto complementario para subir el ticket, sin ser invasivo:
// nunca bloquea ni se muestra si algo falla. Como en interpretar-pedido-ia.ts,
// el modelo elige por NÚMERO de la lista (no por id) y todo lo que devuelve se
// valida contra el catálogo real antes de mostrarse.

export type SugerenciaUpsell = { id: string; esPromo: boolean; name: string; price: number; mensaje: string };

const JSON_SCHEMA = {
  type: "object",
  properties: {
    numero:  { type: ["integer", "null"] },
    mensaje: { type: ["string", "null"] },
  },
  required: ["numero", "mensaje"],
} as const;

// No hace falta el catálogo entero para elegir UNA sugerencia, y mantiene el prompt chico.
const MAX_CANDIDATOS = 40;

const SISTEMA =
  "Sos el asistente de un kiosco que sugiere UN producto complementario para sumar al pedido de un cliente, sin ser invasivo. Elegís algo que combine bien con lo que ya tiene en el carrito, de la lista de disponibles. Si nada combina bien, respondé numero: null. Nunca inventes un número que no esté en la lista.";

async function pedirSugerencia(nombresEnCarrito: string[], candidatos: ItemCatalogo[]): Promise<SugerenciaUpsell | null> {
  if (nombresEnCarrito.length === 0 || candidatos.length === 0) return null;

  const lista = candidatos.slice(0, MAX_CANDIDATOS);
  const usuario = `El cliente ya tiene en el carrito: ${nombresEnCarrito.join(", ")}.\n\nDisponible para sugerir (número | nombre):\n${lista.map((c, i) => `${i + 1} | ${c.name}`).join("\n")}\n\nDevolvé el número de UN producto de la lista (o null si ninguno combina bien) y un mensaje corto y amable en español (máx. 15 palabras) invitando a sumarlo.`;

  try {
    const { valor } = await completarJson(
      { sistema: SISTEMA, usuario, schema: JSON_SCHEMA, nombreSchema: "sugerencia_upsell", maxTokens: 300, temperatura: 0.4 },
      (t) => JSON.parse(t) as { numero?: unknown; mensaje?: unknown }
    );
    if (typeof valor.numero !== "number") return null;

    const item = lista[valor.numero - 1];
    if (!item) return null; // número inventado o fuera de rango
    const mensaje = typeof valor.mensaje === "string" && valor.mensaje.trim() ? valor.mensaje.trim() : `¿Le sumás ${item.name}?`;
    return { id: item.id, esPromo: item.esPromo, name: item.name, price: item.price, mensaje };
  } catch {
    return null;
  }
}

// Punto de entrada único: carga el catálogo real de la sucursal, separa lo que
// ya está en el carrito (por id, nunca por nombre que mande el cliente) y le
// pide a la IA una sugerencia entre lo que falta.
export async function sugerirUpsellParaSucursal(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  idsEnCarrito: string[]
): Promise<SugerenciaUpsell | null> {
  const { items: catalogo } = await cargarCatalogoSucursal(admin, sucursalId);
  const enCarrito = new Set(idsEnCarrito);
  const nombresEnCarrito = catalogo.filter((i) => enCarrito.has(i.id)).map((i) => i.name);
  const candidatos = catalogo.filter((i) => !enCarrito.has(i.id));
  return pedirSugerencia(nombresEnCarrito, candidatos);
}
