import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { cargarLocalesSeo } from "@/lib/pedidos/seo-servidor";
import { SITIO } from "@/lib/pedidos/seo";

// Mapa del sitio para Google: la portada y el menú de cada local que hoy recibe pedidos. Las condiciones y la
// privacidad no figuran a propósito (no son lo que alguien busca). Si falla la base, queda al menos la portada.

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const ahora = new Date();
  const portada = { url: `${SITIO}/`, lastModified: ahora, changeFrequency: "weekly" as const, priority: 1 };
  try {
    const locales = await cargarLocalesSeo(createAdminClient());
    return [portada, ...locales.map((l) => ({ url: `${SITIO}/${l.slug}`, lastModified: ahora, changeFrequency: "daily" as const, priority: 0.9 }))];
  } catch {
    return [portada];
  }
}
