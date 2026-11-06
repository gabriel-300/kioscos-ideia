import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reintentarPendientes } from "@/lib/arca/emitir";

// Reintenta los comprobantes que quedaron 'pendiente' (ARCA caída, red). Pensado para un cron
// externo (GitHub Actions cada 10 minutos). Usa un secret PROPIO (ARCA_CRON_SECRET), distinto del CRON_SECRET
// de /api/ping, para no tener que compartir ni cambiar el que ya está en uso. Falla CERRADO si falta.
export async function GET(request: Request) {
  const secret = process.env.ARCA_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Endpoint no configurado todavía (falta ARCA_CRON_SECRET)" }, { status: 501 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await reintentarPendientes(createAdminClient(), 20);
  return NextResponse.json({ ok: true, ...r });
}
