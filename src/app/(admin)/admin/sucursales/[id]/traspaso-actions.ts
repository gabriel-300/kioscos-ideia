"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

export async function registrarTraspaso(data: {
  sucursal_id:   string;
  efectivo_real: number;
  notas:         string | null;
}): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  // Atómico: la RPC lockea por sucursal, valida que haya una caja abierta,
  // determina quién la tenía (entregado_por) y calcula efectivo_esperado
  // server-side (no confía en lo que mande el cliente) -- mismo criterio que
  // cerrarCaja.
  const { error } = await (admin as any).rpc("registrar_traspaso_caja", {
    p_sucursal_id:   data.sucursal_id,
    p_efectivo_real: data.efectivo_real,
    p_notas:         data.notas,
    p_recibido_por:  userId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  return {};
}
