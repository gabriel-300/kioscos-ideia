import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import {
  COOKIE_SISTEMA,
  RUTA_TENTEO_REPARTOS,
  destinoDeSistema,
  destinoPorDefecto,
  enRuta,
  esPersonal,
  puedeEntrar,
  rolDe,
  sistemaDeRuta,
  sistemaValido,
} from "@/lib/auth/acceso";

// Las listas de roles y sistemas viven en lib/auth/acceso.ts (una sola fuente).

// Bloqueadas para encargado Y vendedor
const ADMIN_ONLY_PREFIXES = [
  "/admin/categorias",
  "/admin/staff",
  "/admin/movimientos",
  "/admin/productos",
  "/tenteo/pedidos/configuracion",
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
    if (pathname.startsWith("/admin") || pathname.startsWith("/tenteo")) {
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
    // ── Zonas de personal: /admin (kiosco) y /tenteo ───────────────────
    if (pathname.startsWith("/admin") || pathname.startsWith("/tenteo")) {
      if (!user) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      // Usuarios sin rol de personal (ej. un cliente de Google) no tienen acceso
      if (!esPersonal(user)) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
      const role = rolDe(user);
      // Para rebotar sin salir del sistema donde está (las rutas de solo admin de
      // Tenteo vuelven a Tenteo, las del kiosco al kiosco).
      const sistemaRuta = sistemaDeRuta(pathname) ?? "kiosco";
      const destinoZona = destinoDeSistema(sistemaRuta, role);

      // Cada zona exige pertenecer a su sistema. Quien no, vuelve a donde sí
      // puede estar (el destino siempre es de un sistema permitido: no hay bucle).
      const sistema = sistemaDeRuta(pathname);
      if (sistema && !puedeEntrar(user, sistema)) {
        return NextResponse.redirect(new URL(destinoPorDefecto(user) ?? "/login", request.url));
      }

      // Encargados, vendedores y concesionarios no pueden acceder a rutas
      // exclusivas de admin -- productos/categorías/proveedores son catálogo
      // GLOBAL (todas las sucursales comparten el mismo SKU), así que ni el
      // concesionario ve el de otros locales acá.
      if ((role === "encargado" || role === "vendedor" || role === "concesionario") && ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL(destinoZona, request.url));
      }

      // Pronóstico: encargado sí, vendedor no
      if (role === "vendedor" && VENDEDOR_BLOCKED_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL(destinoZona, request.url));
      }

      // Repartidor: contención total, no una lista de exclusiones como el
      // resto de los roles -- solo puede ver su cola de entregas. A
      // diferencia de encargado/vendedor/concesionario (que ya tenían
      // acceso amplio al admin antes de esta feature), repartidor es un rol
      // nuevo de bajo privilegio y el resto del admin (47 archivos con
      // chequeos de rol dispersos, sin una matriz central) nunca fue
      // auditado pensando en él -- contenerlo acá evita tener que revisar
      // cada uno de esos archivos uno por uno.
      if (role === "repartidor" && !enRuta(pathname, RUTA_TENTEO_REPARTOS)) {
        return NextResponse.redirect(new URL(RUTA_TENTEO_REPARTOS, request.url));
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
    if (user && !pathname.startsWith("/auth") && !pathname.startsWith("/login") && !pathname.startsWith("/admin") && !pathname.startsWith("/tenteo") && !pathname.startsWith("/elegir-sistema") && !pathname.startsWith("/api") && !pathname.startsWith("/pedir")) {
      const destino = destinoPorDefecto(user, sistemaValido(request.cookies.get(COOKIE_SISTEMA)?.value));
      if (destino) return NextResponse.redirect(new URL(destino, request.url));
    }
  } catch {
    // Si algo falla, dejar pasar; las páginas hacen su propio auth check
  }

  return supabaseResponse;
}
