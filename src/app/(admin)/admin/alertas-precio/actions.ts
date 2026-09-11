"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

// Admin ve/resuelve alertas de cualquier sucursal; concesionario solo las
// de la suya (mismo criterio que el resto de sus permisos -- ve costo real,
// pero nunca el de otro kiosco). Vendedor/encargado sin acceso: la variación
// de costo es plata real, no una tarea operativa más.
async function requireAdminOAccesoSucursal(sucursalId: string) {
  const { userId, role } = await requireStaff();
  if (role === "vendedor" || role === "encargado") throw new Error("No tenés permisos para resolver alertas de precio");
  if (role !== "admin") {
    const admin = createAdminClient();
    const error = await requireSucursalAccess(admin, userId, role, sucursalId);
    if (error) throw new Error(error);
  }
  return { userId };
}

type AlertaRow = {
  id:             string;
  product_id:     string;
  movimiento_id:  string;
  costo_nuevo:    number;
  revisado_por:   string | null;
};

export async function actualizarCosto(alertaId: string, notaAdmin?: string): Promise<{ error?: string }> {
  const supabase = createAdminClient();

  const { data: alerta, error: errAlerta } = await (supabase as any)
    .from("alertas_precio")
    .select("id, product_id, movimiento_id, costo_nuevo, revisado_por")
    .eq("id", alertaId)
    .single();
  const row = alerta as AlertaRow | null;
  if (errAlerta || !row) return { error: "No se encontró la alerta" };
  if (row.revisado_por) return { error: "Esta alerta ya fue revisada" };

  // El costo es por sucursal (migración 059) -- alertas_precio no guarda
  // sucursal_id propio, se resuelve vía la entrega que generó la alerta.
  const { data: movimiento } = await supabase.from("movimientos").select("sucursal_id").eq("id", row.movimiento_id).single();
  if (!movimiento) return { error: "No se encontró la entrega asociada a esta alerta" };
  const sucursalId = movimiento.sucursal_id;

  let userId: string;
  try {
    userId = (await requireAdminOAccesoSucursal(sucursalId)).userId;
  } catch (e) { return { error: (e as Error).message }; }

  const { data: precioActual } = await supabase
    .from("product_prices").select("costo")
    .eq("product_id", row.product_id).eq("sucursal_id", sucursalId).single();

  const { error: errUpdate } = await supabase
    .from("product_prices")
    .update({ costo: row.costo_nuevo, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("product_id", row.product_id).eq("sucursal_id", sucursalId);
  if (errUpdate) return { error: errUpdate.message };

  await supabase.from("product_price_history").insert({
    product_id:     row.product_id,
    sucursal_id:    sucursalId,
    costo_anterior: precioActual?.costo ?? null,
    costo_nuevo:    row.costo_nuevo,
    changed_by:     userId,
  });

  const { error: errAlertaUpdate } = await (supabase as any)
    .from("alertas_precio")
    .update({
      revisado_por:      userId,
      revisado_en:       new Date().toISOString(),
      costo_actualizado: true,
      nota_admin:        notaAdmin || null,
    })
    .eq("id", alertaId);
  if (errAlertaUpdate) return { error: errAlertaUpdate.message };

  revalidatePath("/admin/alertas-precio");
  revalidatePath("/admin/productos");
  return {};
}

export async function ignorarAlerta(alertaId: string, notaAdmin?: string): Promise<{ error?: string }> {
  const supabase = createAdminClient();

  const { data: alerta, error: errAlerta } = await (supabase as any)
    .from("alertas_precio").select("movimiento_id").eq("id", alertaId).single();
  if (errAlerta || !alerta) return { error: "No se encontró la alerta" };
  const { data: movimiento } = await supabase.from("movimientos").select("sucursal_id").eq("id", alerta.movimiento_id).single();
  if (!movimiento) return { error: "No se encontró la entrega asociada a esta alerta" };

  let userId: string;
  try {
    userId = (await requireAdminOAccesoSucursal(movimiento.sucursal_id)).userId;
  } catch (e) { return { error: (e as Error).message }; }

  const { error } = await (supabase as any)
    .from("alertas_precio")
    .update({
      revisado_por: userId,
      revisado_en:  new Date().toISOString(),
      nota_admin:   notaAdmin || null,
    })
    .eq("id", alertaId)
    .is("revisado_por", null);
  if (error) return { error: error.message };

  revalidatePath("/admin/alertas-precio");
  return {};
}
