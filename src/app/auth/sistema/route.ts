import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_SISTEMA, puedeEntrar, sistemaValido } from "@/lib/auth/acceso";

// Cambio de sistema de quien tiene los dos (selector y enlaces de los menús).
// Guarda la última elección en una cookie -- solo para saber adónde mandarlo
// la próxima vez; el acceso se vuelve a verificar siempre contra app_metadata --
// y sigue por /auth/redirect, que resuelve el destino fino de cada sistema.
export async function GET(request: NextRequest) {
  // Next precarga los enlaces visibles: una precarga no puede cambiar la preferencia.
  if (request.headers.get("next-router-prefetch")) return new NextResponse(null, { status: 204 });

  const ir = sistemaValido(request.nextUrl.searchParams.get("ir"));
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !ir || !puedeEntrar(user, ir)) {
    return NextResponse.redirect(new URL(user ? "/auth/redirect" : "/login", request.url));
  }

  const res = NextResponse.redirect(new URL(`/auth/redirect?sistema=${ir}`, request.url));
  res.cookies.set(COOKIE_SISTEMA, ir, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: request.nextUrl.protocol === "https:", httpOnly: true });
  return res;
}
