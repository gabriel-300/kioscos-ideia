import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { reintentarPendientes } from "@/lib/arca/emitir";

// Reintenta los comprobantes que quedaron 'pendiente' (ARCA caída, red). Pensado para un cron
// externo (ej. GitHub Actions cada 10 minutos). Falla CERRADO si falta CRON_SECRET, igual que /api/ping.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Endpoint no configurado todavía (falta CRON_SECRET)" }, { status: 501 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await reintentarPendientes(createAdminClient(), 20);
  return NextResponse.json({ ok: true, ...r });
}
