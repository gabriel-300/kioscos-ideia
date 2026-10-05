"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { rolDe } from "@/lib/auth/acceso";
import { fechaHoyAR } from "@/lib/fecha";
import { validarRetiro, type RetiroEntrada } from "@/lib/retiros";

// Devuelve { error } en vez de lanzar (architecture.md §9, punto 3): Next.js oculta el mensaje de un throw en producción.

// Para el formulario del retiro: proveedores de la lista y administradores que pueden autorizar un pago a proveedor.
// Solo nombres (sin correos): lo ve el personal del kiosco.
export async function listarOpcionesRetiro(): Promise<
  { error: string } | { proveedores: { id: string; nombre: string }[]; autorizadores: { id: string; nombre: string }[] }
> {
  await requireStaff();
  const admin = createAdminClient();

  const [{ data: proveedores, error: errProv }, { data: { users }, error: errUsers }] = await Promise.all([
    admin.from("proveedores").select("id, nombre").eq("is_active", true).order("nombre"),
    admin.auth.admin.listUsers({ perPage: 200 }),
  ]);
  if (errProv || errUsers) return { error: "No se pudieron cargar las opciones" };

  const autorizadores = users
    .filter((u) => rolDe(u) === "admin" && !((u as { banned_until?: string | null }).banned_until && (u as { banned_until?: string | null }).banned_until !== "none"))
    .map((u) => ({ id: u.id, nombre: ((u.user_metadata?.full_name as string | undefined) ?? "").trim() }))
    .filter((u) => u.nombre)   // sin nombre cargado no se ofrece: no se muestran correos al personal del kiosco
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return { proveedores: proveedores ?? [], autorizadores };
}

export async function registrarRetiro(data: RetiroEntrada & { sucursal_id: string }): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const validado = validarRetiro(data);
  if ("error" in validado) return { error: validado.error };
  const r = validado.valor;

  // Un pago a proveedor lo autoriza un administrador de verdad (el navegador no es de fiar) y el proveedor tiene que existir.
  if (r.proveedor_id) {
    const [{ data: proveedor }, { data: autorizador }] = await Promise.all([
      admin.from("proveedores").select("id").eq("id", r.proveedor_id).eq("is_active", true).maybeSingle(),
      admin.auth.admin.getUserById(r.autorizado_por!),
    ]);
    if (!proveedor) return { error: "Ese proveedor no está en la lista" };
    if (rolDe(autorizador?.user ?? null) !== "admin") return { error: "Quien autoriza tiene que ser un administrador" };
  }

  const { error } = await admin.from("retiros_caja").insert({
    sucursal_id: data.sucursal_id,
    fecha:       fechaHoyAR(),
    monto:       r.monto,
    motivo:      r.motivo,
    created_by:  userId,
    comprobante_image_url: r.comprobante_image_url,
    // Solo se mandan si hay proveedor: el retiro común sigue andando igual aunque la migración 103 no esté aplicada.
    ...(r.proveedor_id ? { proveedor_id: r.proveedor_id, autorizado_por: r.autorizado_por } : {}),
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/tesoreria");
  return {};
}
