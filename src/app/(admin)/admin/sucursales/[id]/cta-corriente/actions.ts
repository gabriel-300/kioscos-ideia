"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function requireEditRole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  if (!role || !["admin", "encargado"].includes(role)) throw new Error("Sin permiso");
  return { supabase, user };
}

export async function registrarPagoCTC(params: {
  sucursal_id: string;
  personal_id: string;
  monto: number;
  fecha: string;
  notas?: string;
}) {
  const { supabase, user } = await requireEditRole();
  const { error } = await (supabase as any)
    .from("cta_corriente_pagos")
    .insert({ ...params, created_by: user.id });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/sucursales/${params.sucursal_id}/cta-corriente`);
}

export async function eliminarPagoCTC(id: string, sucursalId: string) {
  const { supabase } = await requireEditRole();
  const { error } = await (supabase as any).from("cta_corriente_pagos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/sucursales/${sucursalId}/cta-corriente`);
}
