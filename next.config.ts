import type { NextConfig } from "next";

// Cabeceras de seguridad básicas (auditoría 19/09/2026, H-20). Sin CSP a propósito:
// el admin y el storefront usan estilos y scripts en línea (tickets con document.write)
// y una CSP mal puesta rompería la venta; se agrega aparte, con prueba en el navegador.
const nextConfig: NextConfig = {
  // Pedidos online y entregas se mudaron de /admin a /tenteo. Los enlaces viejos
  // (favoritos, mensajes ya enviados, pestañas abiertas) siguen funcionando.
  // Temporales (307) a propósito: un 308 queda cacheado para siempre en el navegador.
  async redirects() {
    return [
      // Reglas exactas y con subruta por separado: en producción (OpenNext) el comodín opcional
      // ":path*" sin subruta quedaba literal en el destino ("/tenteo/pedidos/:path*").
      { source: "/admin/pedidos-online", destination: "/tenteo/pedidos", permanent: false },
      { source: "/admin/pedidos-online/:path+", destination: "/tenteo/pedidos/:path+", permanent: false },
      { source: "/admin/repartos", destination: "/tenteo/repartos", permanent: false },
      { source: "/admin/repartos/:path+", destination: "/tenteo/repartos/:path+", permanent: false },
      // Pagos a proveedores y Socios se unificaron en Tesorería (un solo módulo, lo carga el administrativo).
      // Las pantallas por kiosco ya no se usan; los enlaces viejos llegan a Tesorería.
      { source: "/admin/pagos-proveedores", destination: "/admin/tesoreria?vista=egresos", permanent: false },
      { source: "/admin/socios", destination: "/admin/tesoreria?vista=egresos", permanent: false },
      { source: "/admin/sucursales/:id/pagos-proveedores", destination: "/admin/tesoreria?vista=egresos", permanent: false },
      { source: "/admin/sucursales/:id/socios", destination: "/admin/tesoreria?vista=egresos", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
