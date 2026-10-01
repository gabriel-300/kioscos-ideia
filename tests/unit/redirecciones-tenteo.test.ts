import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

// Pedidos online y entregas se mudaron de /admin a /tenteo: los enlaces viejos
// (favoritos, mensajes, pestañas abiertas, el E2E) tienen que seguir llegando.
// Se prueba el mapa de next.config; ":path*" = cero o más segmentos.

async function reglas() {
  return (await nextConfig.redirects!()) as { source: string; destination: string; permanent: boolean }[];
}

async function destinoDe(ruta: string): Promise<string | null> {
  for (const r of await reglas()) {
    const prefijo = r.source.replace("/:path*", "");
    if (ruta === prefijo || ruta.startsWith(prefijo + "/")) {
      const resto = ruta.slice(prefijo.length).replace(/^\//, "");
      const base = r.destination.replace("/:path*", "");
      return resto ? base + "/" + resto : base;
    }
  }
  return null;
}

describe("redirecciones de las URLs viejas de Tenteo", () => {
  it("pedidos online, su configuración y entregas llegan a /tenteo", async () => {
    expect(await destinoDe("/admin/pedidos-online")).toBe("/tenteo/pedidos");
    expect(await destinoDe("/admin/pedidos-online/configuracion")).toBe("/tenteo/pedidos/configuracion");
    expect(await destinoDe("/admin/repartos")).toBe("/tenteo/repartos");
  });
  it("no toca el resto del admin ni el storefront público", async () => {
    for (const p of ["/admin/dashboard", "/admin/pedidoya", "/admin/repartos-x", "/pedir/parque", "/admin/sucursales/abc"]) {
      expect(await destinoDe(p), p).toBeNull();
    }
  });
  it("son temporales (307): un 308 queda cacheado para siempre en el navegador", async () => {
    for (const r of await reglas()) expect(r.permanent).toBe(false);
  });
});
