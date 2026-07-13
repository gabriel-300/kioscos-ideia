"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

const ESTADOS = ["nuevo", "en_atencion", "convertido", "perdido"] as const;
type Estado = (typeof ESTADOS)[number];

// Encargado solo puede tocar contactos de la sucursal que le pertenece (mismo
// criterio que crearMovimiento/cerrarCaja); admin, cualquiera.
async function checkAccesoSucursal(sucursalId: string) {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") throw new Error("No tenés permisos para el CRM de nichos");
  if (role === "encargado") {
    const admin = createAdminClient();
    const { data: suc } = await admin
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", sucursalId)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  return { userId, role };
}

export async function crearContacto(data: {
  sucursal_id:       string;
  nicho_id:          string | null;
  canal:             "whatsapp" | "instagram" | "pedidosya" | "otro";
  nombre_contacto:   string | null;
  consulta_mensaje:  string | null;
}) {
  const { userId } = await checkAccesoSucursal(data.sucursal_id);
  const admin = createAdminClient();

  const { error } = await (admin as any).from("contactos_crm").insert({
    sucursal_id:      data.sucursal_id,
    nicho_id:         data.nicho_id,
    canal:            data.canal,
    nombre_contacto:  data.nombre_contacto,
    consulta_mensaje: data.consulta_mensaje,
    estado:           "nuevo",
    created_by:       userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin/nichos");
}

export async function actualizarContacto(
  id: string,
  sucursalId: string,
  data: { estado?: Estado; convertido_pedido?: boolean; monto?: number | null; notas?: string | null }
) {
  const { userId } = await checkAccesoSucursal(sucursalId);
  const admin = createAdminClient();

  if (data.estado && !ESTADOS.includes(data.estado)) {
    throw new Error("Estado inválido");
  }

  const { error } = await (admin as any)
    .from("contactos_crm")
    .update({ ...data, atendido_por: userId })
    .eq("id", id)
    .eq("sucursal_id", sucursalId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/nichos");
}
