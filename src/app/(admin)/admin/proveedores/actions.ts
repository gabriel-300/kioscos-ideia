"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";

export type ModoFacturacion = "costo" | "precio_sugerido";

export async function listarProveedores() {
  await requireStaff();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("proveedores")
    .select("id, nombre, contacto, is_active, modo_facturacion, porcentaje_descuento")
    .order("nombre");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function crearProveedor(
  nombre: string,
  contacto?: string,
  modoFacturacion: ModoFacturacion = "costo",
  porcentajeDescuento?: number | null
) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("proveedores").insert({
    nombre: nombre.trim(),
    contacto: contacto?.trim() || null,
    modo_facturacion: modoFacturacion,
    porcentaje_descuento: modoFacturacion === "precio_sugerido" ? porcentajeDescuento ?? null : null,
    created_by: userId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/proveedores");
}

export async function actualizarProveedor(
  id: string,
  nombre: string,
  contacto?: string,
  modoFacturacion: ModoFacturacion = "costo",
  porcentajeDescuento?: number | null
) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("proveedores").update({
    nombre: nombre.trim(),
    contacto: contacto?.trim() || null,
    modo_facturacion: modoFacturacion,
    porcentaje_descuento: modoFacturacion === "precio_sugerido" ? porcentajeDescuento ?? null : null,
    updated_by: userId,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/proveedores");
}

export async function toggleProveedorActivo(id: string, activo: boolean) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("proveedores").update({ is_active: !activo, updated_by: userId }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/proveedores");
}
