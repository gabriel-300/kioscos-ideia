"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

export async function abrirCaja(data: {
  sucursal_id:   string;
  fecha:         string;
  fondo_inicial: number;
  notas:         string | null;
}) {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, data.sucursal_id);
  if (accesoError) throw new Error(accesoError);

  // Apertura atómica: la RPC lockea por sucursal y valida que no haya un ciclo abierto
  const { error } = await (admin as any).rpc("abrir_caja", {
    p_sucursal_id:   data.sucursal_id,
    p_fecha:         data.fecha,
    p_fondo_inicial: data.fondo_inicial,
    p_notas:         data.notas,
    p_created_by:    userId,
  });

  if (error) throw new Error(error.message);

  // Un vendedor puede estar habilitado en más de una sucursal
  // (profile_sucursales) -- profiles.sucursal_id pasa a significar "la
  // sucursal activa ahora", y este es el único momento en que se
  // sincroniza: al elegir dónde abre el turno. El resto de la app (nav,
  // RLS de movimientos/caja/etc.) sigue leyendo profiles.sucursal_id sin
  // cambios, apuntando a la que se elija acá.
  if (role === "vendedor") {
    await (admin as any).from("profiles").update({ sucursal_id: data.sucursal_id }).eq("id", userId);
  }

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
  revalidatePath("/admin/tesoreria");
}
