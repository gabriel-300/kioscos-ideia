"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

export async function cerrarCaja(data: {
  sucursal_id:              string;
  fecha:                    string;
  fondo_inicial:           number;
  total_ventas:            number;
  efectivo_declarado:      number;
  billetera_declarada:     number;
  tarjeta_declarada:       number;
  transferencia_declarada: number;
  notas:                    string | null;
}) {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  if (role === "encargado") {
    const { data: suc } = await admin
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", data.sucursal_id)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  if (role === "vendedor") {
    const profileRes = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== data.sucursal_id) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  // Billetera/tarjeta/transferencia: encargado y vendedor no los pueden declarar
  // manualmente (ya los registra el sistema en cada venta) — el frontend los
  // muestra de solo lectura, pero acá se recalculan server-side igual, por si
  // alguien intenta mandar otro valor directo a la action.
  let billeteraDeclarada     = data.billetera_declarada;
  let tarjetaDeclarada       = data.tarjeta_declarada;
  let transferenciaDeclarada = data.transferencia_declarada;
  let totalVentas            = data.total_ventas;

  if (role !== "admin") {
    const aperturaRes = await (admin as any)
      .from("aperturas_caja")
      .select("created_at, created_by")
      .eq("sucursal_id", data.sucursal_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultimaApertura = aperturaRes.data as { created_at: string; created_by: string | null } | null;

    // Un vendedor solo puede cerrar el turno que él mismo abrió (el encargado,
    // ya validado como dueño de la sucursal arriba, puede cerrar cualquiera).
    if (role === "vendedor" && ultimaApertura?.created_by && ultimaApertura.created_by !== userId) {
      throw new Error("Esta caja la abrió otra persona — pedile que la cierre ella, un encargado o un admin.");
    }

    let ventasQuery = (admin as any)
      .from("movimientos")
      .select("pago_billetera, pago_tarjeta, pago_transferencia, movimiento_items(subtotal)")
      .eq("sucursal_id", data.sucursal_id)
      .eq("tipo", "venta");
    if (ultimaApertura) ventasQuery = ventasQuery.gte("created_at", ultimaApertura.created_at);
    else ventasQuery = ventasQuery.eq("fecha", data.fecha);

    const { data: ventasTurno } = await ventasQuery as { data: {
      pago_billetera: number | null; pago_tarjeta: number | null; pago_transferencia: number | null;
      movimiento_items: { subtotal: number | null }[];
    }[] | null };

    billeteraDeclarada     = (ventasTurno ?? []).reduce((s, m) => s + (m.pago_billetera ?? 0), 0);
    tarjetaDeclarada       = (ventasTurno ?? []).reduce((s, m) => s + (m.pago_tarjeta ?? 0), 0);
    transferenciaDeclarada = (ventasTurno ?? []).reduce((s, m) => s + (m.pago_transferencia ?? 0), 0);
    // total_ventas tampoco se confía del cliente -- se recalcula desde los movimientos
    // reales del turno (mismo criterio que el resto: no se puede manipular con devtools
    // para que la diferencia "cuadre" ocultando un faltante real).
    totalVentas = (ventasTurno ?? []).reduce(
      (s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0
    );
  }

  // Cierre atómico: la RPC lockea por sucursal, valida el ciclo y calcula
  // retiros_turno server-side (no confía en lo que mande el cliente)
  const { error } = await (admin as any).rpc("cerrar_caja", {
    p_sucursal_id:             data.sucursal_id,
    p_fecha:                   data.fecha,
    p_fondo_inicial:           data.fondo_inicial,
    p_total_ventas:            totalVentas,
    p_efectivo_declarado:      data.efectivo_declarado,
    p_billetera_declarada:     billeteraDeclarada,
    p_tarjeta_declarada:       tarjetaDeclarada,
    p_transferencia_declarada: transferenciaDeclarada,
    p_notas:                   data.notas,
    p_created_by:              userId,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
}

export async function getCierreDelDia(sucursalId: string, fecha: string) {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", sucursalId)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  if (role === "vendedor") {
    const profileRes = await (supabase as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== sucursalId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  const res = await (supabase as any)
    .from("cierres_caja")
    .select("*")
    .eq("sucursal_id", sucursalId)
    .eq("fecha", fecha)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return res.data ?? null;
}
