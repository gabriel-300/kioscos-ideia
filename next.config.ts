import type { NextConfig } from "next";

// Cabeceras de seguridad básicas (auditoría 19/09/2026, H-20). Sin CSP a propósito:
// el admin y el storefront usan estilos y scripts en línea (tickets con document.write)
// y una CSP mal puesta rompería la venta; se agrega aparte, con prueba en el navegador.
const nextConfig: NextConfig = {
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
