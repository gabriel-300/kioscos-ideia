"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
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
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await (supabase as any).from("gastos").insert({
    categoria:   data.categoria,
    monto:       data.monto,
    fecha:       data.fecha,
    proveedor:   data.proveedor   || null,
    sucursal_id: data.sucursal_id || null,
    notas:       data.notas       || null,
    created_by:  userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

export async function actualizarGasto(id: string, data: GastoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await (supabase as any).from("gastos").update({
    categoria:   data.categoria,
    monto:       data.monto,
    fecha:       data.fecha,
    proveedor:   data.proveedor   || null,
    sucursal_id: data.sucursal_id || null,
    notas:       data.notas       || null,
    updated_by:  userId,
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

export interface GastoFijoInput {
  categoria:       Categoria;
  descripcion:     string;
  monto_estimado:  number;
  dia_vencimiento: number;
  sucursal_id:     string | null;
}

export async function crearGastoFijo(data: GastoFijoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("gastos_fijos").insert({
    categoria:       data.categoria,
    descripcion:     data.descripcion,
    monto_estimado:  data.monto_estimado,
    dia_vencimiento: data.dia_vencimiento,
    sucursal_id:     data.sucursal_id || null,
    created_by:      userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

export async function actualizarGastoFijo(id: string, data: GastoFijoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("gastos_fijos").update({
    categoria:       data.categoria,
    descripcion:     data.descripcion,
    monto_estimado:  data.monto_estimado,
    dia_vencimiento: data.dia_vencimiento,
    sucursal_id:     data.sucursal_id || null,
    updated_by:      userId,
    updated_at:      new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

export async function toggleGastoFijoActivo(id: string, activo: boolean) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("gastos_fijos")
    .update({ is_active: !activo, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

export async function eliminarGastoFijo(id: string) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("gastos_fijos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}

// Convierte un gasto fijo "comprometido" en "ejecutado": crea el gasto real
// vinculado (gasto_fijo_id) para que deje de contar como pendiente ese mes.
export async function marcarGastoFijoPagado(data: {
  gasto_fijo_id: string;
  categoria:     Categoria;
  monto:         number;
  fecha:         string;
  proveedor:     string | null;
  sucursal_id:   string | null;
}) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("gastos").insert({
    categoria:     data.categoria,
    monto:         data.monto,
    fecha:         data.fecha,
    proveedor:     data.proveedor   || null,
    sucursal_id:   data.sucursal_id || null,
    gasto_fijo_id: data.gasto_fijo_id,
    created_by:    userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/gastos");
}
