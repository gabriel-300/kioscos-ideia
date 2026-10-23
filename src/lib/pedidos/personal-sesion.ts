import type { createAdminClient } from "@/lib/supabase/server";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

// ¿La sesión es de una persona del personal con acceso a ESA sucursal (o un administrador)? Se decide
// en el servidor con el rol de la sesión, nunca con lo que mande el navegador. Hoy sirve para que quien
// está logueado en la sucursal pueda pedir en efectivo en su tienda online.
export async function personalDeSucursal(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; app_metadata?: Record<string, unknown> } | null | undefined,
  sucursalId: string,
): Promise<boolean> {
  const role = user?.app_metadata?.role;
  if (!user || typeof role !== "string") return false;
  return (await requireSucursalAccess(admin, user.id, role, sucursalId)) === null;
}
