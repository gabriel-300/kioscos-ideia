import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Solo se acepta un destino interno: una ruta que empiece con UNA sola "/".
// `next=@sitio-malo.com` daba `https://<origen>@sitio-malo.com` (redirección abierta,
// auditoría 19/09, H-24); `//sitio-malo.com` y `/\sitio-malo.com` tampoco pasan.
function destinoSeguro(next: string | null): string {
  const porDefecto = "/auth/set-password";
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return porDefecto;
  return next;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type       = searchParams.get("type");
  const next       = destinoSeguro(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type:       type as any,
      token_hash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link-invalido`);
}
