"use server";

import { createClient } from "@/lib/supabase/server";

export async function requireAdmin(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  if (user.app_metadata?.role !== "admin") throw new Error("Sin permisos de administrador");
}

export async function requireStaff(): Promise<{ userId: string; role: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  const role = user.app_metadata?.role as string | undefined;
  if (!role || !["admin", "encargado", "vendedor"].includes(role)) throw new Error("Sin permisos");
  return { userId: user.id, role };
}
