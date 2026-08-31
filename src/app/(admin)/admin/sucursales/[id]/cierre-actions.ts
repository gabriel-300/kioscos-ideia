"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

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
  fondo_siguiente:          number | null;
  total_fiado:              number;
  total_plataforma:         number;
}): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await requireSucursalAccess(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  // Billetera/tarjeta/transferencia: encargado y vendedor no los pueden declarar
  // manualmente (ya los registra el sistema en cada venta) — el frontend los
  // muestra de solo lectura, pero acá se recalculan server-side igual, por si
  // alguien intenta mandar otro valor directo a la action.
  let billeteraDeclarada     = data.billetera_declarada;
  let tarjetaDeclarada       = data.tarjeta_declarada;
  let transferenciaDeclarada = data.transferencia_declarada;
  let totalVentas            = data.total_ventas;
  let totalFiado             = data.total_fiado;
  let totalPlataforma        = data.total_plataforma;
  // fondo_inicial: mismo motivo que los de arriba -- es un hecho histórico ya
  // registrado al abrir la caja (aperturas_caja.fondo_inicial), no una
  // declaración del que cierra. El frontend lo muestra de solo lectura, pero
  // sin recalcularlo acá alguien podía mandar otro valor directo a la action
  // para que la diferencia diera $0 y esconder un faltante real (hallazgo de
  // la auditoría de seguridad del 08/08 -- ver memoria del proyecto).
  let fondoInicial           = data.fondo_inicial;

  const aperturaRes = await (admin as any)
    .from("aperturas_caja")
    .select("id, created_at, created_by, fondo_inicial")
    .eq("sucursal_id", data.sucursal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimaApertura = aperturaRes.data as { id: string; created_at: string; created_by: string | null; fondo_inicial: number } | null;

  // Auditoría de stock obligatoria (por sucursal, ver migración 054): si está
  // activada, no se puede cerrar sin haber auditado este turno. Arranca en
  // false en todas las sucursales a propósito -- este chequeo no bloquea a
  // nadie hasta que el usuario prenda el flag de la sucursal que corresponda,
  // después de capacitar al personal.
  const { data: sucAuditoria } = await (admin as any)
    .from("sucursales")
    .select("auditoria_obligatoria")
    .eq("id", data.sucursal_id)
    .single();
  if (sucAuditoria?.auditoria_obligatoria && ultimaApertura) {
    const { data: auditoriaTurno } = await (admin as any)
      .from("auditorias_stock")
      .select("id")
      .eq("apertura_id", ultimaApertura.id)
      .maybeSingle();
    if (!auditoriaTurno) {
      return { error: "Hay que hacer la auditoría de stock de este turno antes de cerrar la caja." };
    }
  }

  if (role !== "admin") {
    // Un vendedor solo puede cerrar el turno que él mismo abrió (el encargado,
    // ya validado como dueño de la sucursal arriba, puede cerrar cualquiera).
    if (role === "vendedor" && ultimaApertura?.created_by && ultimaApertura.created_by !== userId) {
      return { error: "Esta caja la abrió otra persona — pedile que la cierre ella, un encargado o un admin." };
    }

    let ventasQuery = (admin as any)
      .from("movimientos")
      .select("canal, pago_billetera, pago_tarjeta, pago_transferencia, movimiento_items(subtotal)")
      .eq("sucursal_id", data.sucursal_id)
      .eq("tipo", "venta")
      .is("anulado_en", null);
    if (ultimaApertura) ventasQuery = ventasQuery.gte("created_at", ultimaApertura.created_at);
    else ventasQuery = ventasQuery.eq("fecha", data.fecha);

    const { data: ventasTurnoRaw } = await ventasQuery as { data: {
      canal: string | null;
      pago_billetera: number | null; pago_tarjeta: number | null; pago_transferencia: number | null;
      movimiento_items: { subtotal: number | null }[];
    }[] | null };

    // Las ventas a Cta. Corriente no se cobran en el momento -- no tienen contraparte
    // en ningún medio de pago, así que no deben sumar al total que se concilia contra
    // caja (si no, generan un faltante ficticio por el mismo monto fiado). Pedido Ya
    // Plataforma es el mismo caso (la app paga después), pero NO se mezcla con
    // total_fiado -- ese campo alimenta el informe de descuento a personal y Pedido
    // Ya Plataforma no es deuda de nadie del staff.
    const ventasTurno = (ventasTurnoRaw ?? []).filter((m) => m.canal !== "cuenta_corriente" && m.canal !== "pedido_ya_plataforma");
    const ventasFiadoTurno = (ventasTurnoRaw ?? []).filter((m) => m.canal === "cuenta_corriente");
    const ventasPlataformaTurno = (ventasTurnoRaw ?? []).filter((m) => m.canal === "pedido_ya_plataforma");

    billeteraDeclarada     = ventasTurno.reduce((s, m) => s + (m.pago_billetera ?? 0), 0);
    tarjetaDeclarada       = ventasTurno.reduce((s, m) => s + (m.pago_tarjeta ?? 0), 0);
    transferenciaDeclarada = ventasTurno.reduce((s, m) => s + (m.pago_transferencia ?? 0), 0);
    // total_ventas tampoco se confía del cliente -- se recalcula desde los movimientos
    // reales del turno (mismo criterio que el resto: no se puede manipular con devtools
    // para que la diferencia "cuadre" ocultando un faltante real).
    totalVentas = ventasTurno.reduce(
      (s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0
    );
    totalFiado = ventasFiadoTurno.reduce(
      (s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0
    );
    totalPlataforma = ventasPlataformaTurno.reduce(
      (s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0
    );

    // Ver comentario donde se declara fondoInicial más arriba -- si hay una
    // apertura registrada, ese es el fondo real, no lo que mande el cliente.
    if (ultimaApertura) fondoInicial = ultimaApertura.fondo_inicial;
  }

  // Cierre atómico: la RPC lockea por sucursal, valida el ciclo y calcula
  // retiros_turno server-side (no confía en lo que mande el cliente)
  const { error } = await (admin as any).rpc("cerrar_caja", {
    p_sucursal_id:             data.sucursal_id,
    p_fecha:                   data.fecha,
    p_fondo_inicial:           fondoInicial,
    p_total_ventas:            totalVentas,
    p_efectivo_declarado:      data.efectivo_declarado,
    p_billetera_declarada:     billeteraDeclarada,
    p_tarjeta_declarada:       tarjetaDeclarada,
    p_transferencia_declarada: transferenciaDeclarada,
    p_notas:                   data.notas,
    p_created_by:              userId,
    p_fondo_siguiente:         data.fondo_siguiente,
    p_total_fiado:             totalFiado,
    p_total_plataforma:        totalPlataforma,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
  revalidatePath("/admin/tesoreria");
  return {};
}

export async function getCierreDelDia(sucursalId: string, fecha: string) {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  const accesoError = await requireSucursalAccess(supabase, userId, role, sucursalId);
  if (accesoError) throw new Error(accesoError);

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
