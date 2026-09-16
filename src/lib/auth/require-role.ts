"use server";

import { createClient } from "@/lib/supabase/server";

export async function requireAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  if (user.app_metadata?.role !== "admin") throw new Error("Sin permisos de administrador");
  return { userId: user.id };
}

export async function requireStaff(): Promise<{ userId: string; role: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const role = user.app_metadata?.role as string | undefined;
  if (!role || !["admin", "encargado", "vendedor", "concesionario"].includes(role)) throw new Error("Sin permisos");
  return { userId: user.id, role };
}

// Repartidor es un rol aparte, a propósito NO incluido en requireStaff()
// (esa función la usan decenas de Server Actions del resto del admin, y
// nunca se auditaron pensando en un repartidor viendo esas pantallas). Solo
// las acciones de /admin/repartos usan este chequeo angosto. Admin siempre
// puede, mismo criterio que requireAdminOAccesoSucursal en reposicion.
export async function requireRepartidor(): Promise<{ userId: string; role: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const role = user.app_metadata?.role as string | undefined;
  if (role !== "repartidor" && role !== "admin") throw new Error("Sin permisos");
  return { userId: user.id, role };
}
