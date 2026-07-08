"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

export type Categoria = "mercaderia" | "sueldos" | "alquiler" | "servicios" | "otro";

export interface GastoInput {
  categoria:   Categoria;
  monto:       number;
  fecha:       string;
  proveedor:   string | null;
  sucursal_id: string | null;
  notas:       string | null;
}

export async function crearGasto(data: GastoInput) {
  await requireAdmin();
  const supabase = createAdminClient();
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const { error } = await (supabase as any).from("gastos").insert({
    categoria:   data.categoria,
    monto:       data.monto,
    fecha:       data.fecha,
    proveedor:   data.proveedor   || null,
    sucursal_id: data.sucursal_id || null,
    notas:       data.notas       || null,
    created_by:  user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

export async function actualizarGasto(id: string, data: GastoInput) {
  await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await (supabase as any).from("gastos").update({
    categoria:   data.categoria,
    monto:       data.monto,
    fecha:       data.fecha,
    proveedor:   data.proveedor   || null,
    sucursal_id: data.sucursal_id || null,
    notas:       data.notas       || null,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

export async function eliminarGasto(id: string) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("gastos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}
