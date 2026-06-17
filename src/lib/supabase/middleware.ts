import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const STAFF_ROLES = ["admin", "vendedor", "produccion", "distribucion"];

const ADMIN_ONLY_PREFIXES = [
  "/admin/productos",
  "/admin/categorias",
  "/admin/zonas",
  "/admin/staff",
];

const PRODUCCION_ALLOWED = [
  "/admin/dashboard",
  "/admin/produccion",
  "/admin/cocina",
];

const DISTRIBUCION_ALLOWED = [
  "/admin/dashboard",
  "/admin/distribucion",
];

// Reads raw_app_meta_data via admin API, bypassing JWT claims.
// The custom_access_token_hook overwrites app_metadata.role with profiles.role
// for all users, making staff appear as customer_b2c in the JWT.
// Admin API reads auth.users.raw_app_meta_data directly.
async function getRealRole(
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string | undefined> {
  try {
    const admin = createServerClient(supabaseUrl, serviceKey, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const { data: { user } } = await (admin as any).auth.admin.getUserById(userId);
    return user?.app_metadata?.role as string | undefined;
  } catch {
    return undefined;
  }
}

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let supabaseResponse = NextResponse.next({ request });

  if (!supabaseUrl || !supabaseKey) {
    const pathname = request.nextUrl.pathname;
    const dashboardRoutes = ["/admin", "/b2b", "/repartidor", "/mi-cuenta"];
    if (dashboardRoutes.some((r) => pathname.startsWith(r))) {
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
    // ── Admin routes (security-critical: use admin API for real role) ──
    if (pathname.startsWith("/admin")) {
      if (!user) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      const role = serviceKey
        ? await getRealRole(user.id, supabaseUrl, serviceKey)
        : undefined;

      if (role !== undefined && !STAFF_ROLES.includes(role)) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      if (role && ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) {
        if (role !== "admin") {
          return NextResponse.redirect(new URL("/admin/dashboard", request.url));
        }
      }

      if (role === "produccion") {
        const allowed = PRODUCCION_ALLOWED.some((p) => pathname.startsWith(p));
        if (!allowed) {
          return NextResponse.redirect(new URL("/admin/produccion", request.url));
        }
      }

      if (role === "distribucion") {
        const allowed = DISTRIBUCION_ALLOWED.some((p) => pathname.startsWith(p));
        if (!allowed) {
          return NextResponse.redirect(new URL("/admin/distribucion", request.url));
        }
      }
    }

    // ── Portal B2B (security-critical: use admin API for real role) ────
    if (pathname.startsWith("/b2b")) {
      if (!user) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
      const role = serviceKey
        ? await getRealRole(user.id, supabaseUrl, serviceKey)
        : undefined;
      if (role !== "customer_b2b") {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    // ── Redirect logged-in staff/B2B away from public pages ────────────
    // Uses JWT role (fast). The login form server action already redirects
    // correctly after login, so this block only handles edge cases.
    // JWT role may be wrong for staff (shows customer_b2c due to auth hook),
    // but that's acceptable here — it's a UX convenience, not a security gate.
    if (user && !pathname.startsWith("/auth") && !pathname.startsWith("/login") && !pathname.startsWith("/admin") && !pathname.startsWith("/b2b") && !pathname.startsWith("/remito")) {
      const jwtRole = user.app_metadata?.role as string | undefined;

      if (jwtRole === "customer_b2b") {
        return NextResponse.redirect(new URL("/b2b/catalogo", request.url));
      }

      if (jwtRole && STAFF_ROLES.includes(jwtRole)) {
        if (jwtRole === "produccion")   return NextResponse.redirect(new URL("/admin/produccion",   request.url));
        if (jwtRole === "distribucion") return NextResponse.redirect(new URL("/admin/distribucion", request.url));
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }
    }

    // ── Rutas genéricas protegidas ─────────────────────────────────
    const dashboardRoutes = ["/repartidor", "/mi-cuenta"];
    if (dashboardRoutes.some((r) => pathname.startsWith(r)) && !user) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(url);
    }
  } catch {
    // Si algo falla, dejar pasar; las páginas hacen su propio auth check
  }

  return supabaseResponse;
}
