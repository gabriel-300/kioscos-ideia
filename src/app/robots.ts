import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/pedidos/seo";

// Qué puede mirar Google: la portada y los menús. Las zonas del personal, el ingreso, las respuestas internas y
// las pantallas privadas de cada pedido (seguimiento, Mis pedidos) quedan afuera.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/tenteo", "/api", "/auth", "/login", "/registro", "/forgot-password", "/elegir-sistema", "/pedir/*/pedido/", "/pedir/*/mis-pedidos", "/pedir/*/qr"],
    }],
    sitemap: `${SITIO}/sitemap.xml`,
    host: SITIO,
  };
}
