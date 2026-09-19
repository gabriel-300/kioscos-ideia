import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  // Falla CERRADO: si CRON_SECRET no está configurado, el encabezado esperado
  // sería "Bearer undefined" y cualquiera podía pasar (auditoría 19/09/2026, B-01).
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Endpoint no configurado todavía (falta CRON_SECRET)" }, { status: 501 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("categories").select("id").limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
