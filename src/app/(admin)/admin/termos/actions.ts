"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

// Mismo criterio que el resto de las server actions del proyecto (ver
// cierre-actions.ts / movimientos/actions.ts): devolver {error} en vez de
// throw, porque Next.js oculta el mensaje de las excepciones lanzadas desde
// Server Actions en producción.

async function checkAccesoSucursal(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  sucursalId: string
): Promise<string | null> {
  if (role === "encargado") {
    const { data: suc } = await admin.from("sucursales").select("encargado_user_id").eq("id", sucursalId).single();
    if (suc?.encargado_user_id !== userId) return "No tenés permisos para esta sucursal";
  }
  if (role === "vendedor") {
    const profileRes = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== sucursalId) return "No tenés permisos para esta sucursal";
  }
  return null;
}

export async function crearTermo(data: { sucursal_id: string; numero: string }): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para dar de alta termos" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const numero = data.numero.trim();
  if (!numero) return { error: "Ingresá un número de termo" };

  const { error } = await (admin as any).from("termos").insert({ sucursal_id: data.sucursal_id, numero });
  if (error) {
    if (error.code === "23505") return { error: `Ya existe un termo N° ${numero} en esta sucursal` };
    return { error: error.message };
  }

  revalidatePath("/admin/termos");
  return {};
}

export async function darDeBajaTermo(termoId: string, sucursalId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para dar de baja un termo" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };

  const { data: termo } = await (admin as any).from("termos").select("estado").eq("id", termoId).single();
  if (termo?.estado === "prestado") {
    return { error: "No podés dar de baja un termo prestado -- registrá la devolución primero" };
  }

  const { error } = await (admin as any).from("termos").update({ estado: "baja" }).eq("id", termoId);
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  return {};
}

export async function reactivarTermo(termoId: string, sucursalId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para reactivar un termo" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };

  const { error } = await (admin as any).from("termos").update({ estado: "disponible" }).eq("id", termoId);
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  return {};
}

export async function prestarTermo(data: {
  sucursal_id:    string;
  termo_id:       string;
  dni:            string;
  nombre?:        string | null;
  movimiento_id?: string | null;
}): Promise<{ error?: string; id?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const dni = data.dni.trim();
  if (!dni) return { error: "Ingresá el DNI" };

  const { data: rpcData, error } = await (admin as any).rpc("prestar_termo", {
    p_termo_id:      data.termo_id,
    p_dni:           dni,
    p_nombre:        data.nombre || null,
    p_movimiento_id: data.movimiento_id || null,
    p_created_by:    userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  return { id: rpcData as string };
}

export async function devolverTermo(data: { prestamo_id: string; sucursal_id: string }): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const { error } = await (admin as any).rpc("devolver_termo", {
    p_prestamo_id: data.prestamo_id,
    p_devuelto_by: userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  return {};
}
