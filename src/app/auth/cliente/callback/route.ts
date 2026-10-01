import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/auth/destino-seguro";
import { esPersonal } from "@/lib/auth/acceso";

// Vuelta de "Ingresar con Google" del catálogo público. Cambia el código que
// manda Google por una sesión y, si es la primera vez, da de alta al cliente.
// El callback del personal (/auth/callback) es otro: ese valida links de mail.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = destinoSeguro(searchParams.get("next"), "/");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const user = data?.user;

    if (!error && user) {
      // Una cuenta del personal que entra con Google (Supabase une identidades
      // por mail) sigue siendo personal: no se la da de alta como cliente.
      if (!esPersonal(user)) {
        const nombre = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? null) as string | null;
        await (createAdminClient() as any)
          .from("clientes")
          .upsert({ id: user.id, nombre }, { onConflict: "id", ignoreDuplicates: true }); // si ya existe, no pisa lo que el cliente editó
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const separador = next.includes("?") ? "&" : "?";
  return NextResponse.redirect(`${origin}${next}${separador}login=error`);
}
