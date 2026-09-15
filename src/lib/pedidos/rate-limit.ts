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

export async function identificadorCliente(clienteTelefono: string): Promise<string> {
  const ip = (await headers()).get("cf-connecting-ip");
  return ip ?? `tel:${clienteTelefono.replace(/\D/g, "")}`;
}

export async function chequearRateLimit(
  admin: ReturnType<typeof createAdminClient>,
  identificador: string
): Promise<string | null> {
  const desde = new Date(Date.now() - VENTANA_MS).toISOString();
  const { count } = await (admin as any)
    .from("pedido_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("identificador", identificador)
    .gte("created_at", desde);

  if ((count ?? 0) >= LIMITE) {
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
