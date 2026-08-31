"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { fechaHoyAR } from "@/lib/fecha";

export async function registrarRetiro(data: {
  sucursal_id: string;
  monto:       number;
  motivo:      string;
  comprobante_image_url?: string | null;
}) {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, data.sucursal_id);
  if (accesoError) throw new Error(accesoError);

  const hoy = fechaHoyAR();

  const { error } = await (admin as any).from("retiros_caja").insert({
    sucursal_id: data.sucursal_id,
    fecha:       hoy,
    monto:       data.monto,
    motivo:      data.motivo,
    created_by:  userId,
    comprobante_image_url: data.comprobante_image_url ?? null,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
}
