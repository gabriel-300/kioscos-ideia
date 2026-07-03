import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const STAFF_ROLES = ["admin", "encargado", "vendedor"];

// Bloqueadas para encargado Y vendedor
const ADMIN_ONLY_PREFIXES = [
  "/admin/categorias",
  "/admin/staff",
  "/admin/movimientos",
];

// Bloqueadas solo para vendedor (encargado sí puede)
const VENDEDOR_BLOCKED_PREFIXES = [
  "/admin/productos",
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

      // Encargados y vendedores no pueden acceder a rutas exclusivas de admin
      if ((role === "encargado" || role === "vendedor") && ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }

      // Productos: encargado sí, vendedor no
      if (role === "vendedor" && VENDEDOR_BLOCKED_PREFIXES.some((p) => pathname.startsWith(p))) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }
    }

    // ── Redirect logged-in staff away from public pages ────────────────
    if (user && !pathname.startsWith("/auth") && !pathname.startsWith("/login") && !pathname.startsWith("/admin")) {
      const jwtRole = user.app_metadata?.role as string | undefined;
      if (jwtRole && STAFF_ROLES.includes(jwtRole)) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }
    }
  } catch {
    // Si algo falla, dejar pasar; las páginas hacen su propio auth check
  }

  return supabaseResponse;
}
