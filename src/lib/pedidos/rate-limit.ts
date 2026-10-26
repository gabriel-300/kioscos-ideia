import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";

// Fase 2 del storefront: no hay ningún rate limiting en el proyecto todavía
// -- esto protege iniciarPedido() (arma un pago real de Mercado Pago por
// cada llamada). cf-connecting-ip es confiable acá: Cloudflare lo setea en
// su propio edge antes de que el Worker vea el request, sin ningún proxy
// propio delante (wrangler.toml solo tiene [assets]) -- a diferencia de
// x-forwarded-for, que sí se puede encadenar/falsificar.

const VENTANA_MS = 10 * 60 * 1000; // 10 minutos
const LIMITE      = 5;             // llamadas a iniciarPedido() por identificador en la ventana

export type OpcionesRateLimit = { limite?: number; ventanaMs?: number };

// Una conexión IPv6 doméstica recibe un bloque /64 entero (millones de direcciones): contar por dirección
// completa dejaría rotar la IP sin costo. Se cuenta por el bloque /64; una IPv4 queda tal cual.
export function normalizarIp(ip: string): string {
  const limpia = ip.trim().split("%")[0].toLowerCase();
  if (!limpia.includes(":")) return limpia;
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia); // IPv4 dentro de IPv6
  if (mapeada) return mapeada[1];
  const [izq, der] = limpia.split("::");
  const antes = izq ? izq.split(":") : [];
  const despues = der ? der.split(":") : [];
  const ceros = der === undefined ? [] : Array(Math.max(8 - antes.length - despues.length, 0)).fill("0");
  return [...antes, ...ceros, ...despues].slice(0, 4).map((g) => g.padStart(4, "0")).join(":") + "::/64";
}

export async function identificadorCliente(clienteTelefono: string): Promise<string> {
  const ip = (await headers()).get("cf-connecting-ip");
  return ip ? normalizarIp(ip) : `tel:${clienteTelefono.replace(/\D/g, "")}`;
}

export async function chequearRateLimit(
  admin: ReturnType<typeof createAdminClient>,
  identificador: string,
  { limite = LIMITE, ventanaMs = VENTANA_MS }: OpcionesRateLimit = {}
): Promise<string | null> {
  const desde = new Date(Date.now() - ventanaMs).toISOString();
  const { count } = await (admin as any)
    .from("pedido_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("identificador", identificador)
    .gte("created_at", desde);

  if ((count ?? 0) >= limite) {
    return "Demasiados intentos, esperá unos minutos e intentá de nuevo";
  }

  await (admin as any).from("pedido_rate_limits").insert({ identificador });

  // Purga oportunista (1% de las llamadas) -- no hace falta un job de fondo
  // para una tabla que solo importa mirar 10 minutos hacia atrás.
  if (Math.random() < 0.01) {
    await (admin as any)
      .from("pedido_rate_limits")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  }

  return null;
}
