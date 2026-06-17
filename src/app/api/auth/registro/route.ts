import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { emailNuevoRegistroB2B } from "@/lib/email";
import { z } from "zod";

const Schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  empresa:  z.string().min(2),
  canal:    z.enum(["dist", "gastro", "min"]),
  zonaId:   z.string().uuid(),
  zonaNombre: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { email, password, empresa, canal, zonaId, zonaNombre } = parsed.data;
  const supabase = createAdminClient();

  // Crear usuario con confirmación automática (B2B: aprobación manual de todas formas)
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: empresa, canal, zona_id: zonaId },
  });

  if (error) {
    const msg = error.message.includes("already been registered")
      ? "Ya existe una cuenta con ese email."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Notificar al admin — fire and forget
  emailNuevoRegistroB2B({
    empresa,
    email,
    canal,
    zona: zonaNombre ?? zonaId,
  }).catch(() => {});

  return NextResponse.json({ ok: true, userId: data.user.id });
}
