import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const STAFF_ROLES = ["admin", "encargado", "vendedor", "concesionario", "repartidor"];

// Bloqueadas para encargado Y vendedor
const ADMIN_ONLY_PREFIXES = [
  "/admin/categorias",
  "/admin/staff",
  "/admin/movimientos",
  "/admin/productos",
  "/admin/pedidos-online/configuracion",
];

// Bloqueadas solo para vendedor (encargado sí puede)
const VENDEDOR_BLOCKED_PREFIXES = [
  "/admin/pronostico",
];

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabaseResponse = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseKey) {
    const pathname = request.nextUrl.pathname;
    if (pathname.startsWith("/admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  try {
    // ── Admin routes ───────────────────────────────────────────────────
    if (pathname.startsWith("/admin")) {
      if (!user) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      const role = user.app_metadata?.role as string | undefined;

      // Usuarios sin rol de staff no tienen acceso
      if (!role || !STAFF_ROLES.includes(role)) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      // Encargados, vendedores y concesionarios no pueden acceder a rutas
      // exclusivas de admin -- productos/categorías/proveedores son catálogo
      // GLOBAL (todas las sucursales comparten el mismo SKU), así que ni el
      // concesionario ve el de otros locales acá.
      if ((role === "encargado" || role === "vendedor" || role === "concesionario") && ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }

      // Pronóstico: encargado sí, vendedor no
      if (role === "vendedor" && VENDEDOR_BLOCKED_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }

      // Repartidor: contención total, no una lista de exclusiones como el
      // resto de los roles -- solo puede ver su cola de entregas. A
      // diferencia de encargado/vendedor/concesionario (que ya tenían
      // acceso amplio al admin antes de esta feature), repartidor es un rol
      // nuevo de bajo privilegio y el resto del admin (47 archivos con
      // chequeos de rol dispersos, sin una matriz central) nunca fue
      // auditado pensando en él -- contenerlo acá evita tener que revisar
      // cada uno de esos archivos uno por uno.
      if (role === "repartidor" && !pathname.startsWith("/admin/repartos")) {
        return NextResponse.redirect(new URL("/admin/repartos", request.url));
      }
    }

    // ── Redirect logged-in staff away from public pages ────────────────
    // /api no es "página pública" -- son requests hechas con fetch() desde
    // el propio admin (ej. exportar Excel); redirigirlas manda el HTML del
    // dashboard en vez del archivo pedido, y como el fetch sigue el redirect
    // con status 200, el cliente ni se entera y descarga el HTML con
    // extensión .xlsx.
    // /pedir tampoco: es el storefront público (catálogo por sucursal) -- un
    // admin/encargado/vendedor tiene que poder mirarlo igual que un cliente
    // cualquiera, sin que lo manden de vuelta al dashboard.
    if (user && !pathname.startsWith("/auth") && !pathname.startsWith("/login") && !pathname.startsWith("/admin") && !pathname.startsWith("/api") && !pathname.startsWith("/pedir")) {
      const jwtRole = user.app_metadata?.role as string | undefined;
      if (jwtRole && STAFF_ROLES.includes(jwtRole)) {
        const destino = jwtRole === "repartidor" ? "/admin/repartos" : "/admin/dashboard";
        return NextResponse.redirect(new URL(destino, request.url));
      }
    }
  } catch {
    // Si algo falla, dejar pasar; las páginas hacen su propio auth check
  }

  return supabaseResponse;
}
