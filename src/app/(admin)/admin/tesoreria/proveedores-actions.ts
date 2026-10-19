"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial } from "@/lib/tesoreria/historial";
import { validarMovimientoProveedor, type MovimientoEntrada } from "@/lib/tesoreria/proveedores-cuenta";
import { cargarCuentaDe } from "@/lib/tesoreria/proveedores-consultas";
import { fechaHoyAR } from "@/lib/fecha";

// Mismas convenciones que actions.ts: devuelven { error } en vez de lanzar, escribe solo el servidor (service_role) y cada
// acción verifica el permiso acá (cargar = administrativo de Tesorería).
// `confirmar`: el pago deja la cuenta a favor; la pantalla pide confirmación y vuelve a mandar el pago con confirmarExceso = true.
type Resultado = { error?: string; confirmar?: { saldo: number; monto: number } };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dma = (f: string) => f.split("-").reverse().join("/");
const msgCorte = (corte: string) =>
  `El saldo inicial de esta cuenta es del ${dma(corte)}: lo comprado y pagado hasta esa fecha ya está incluido en ese saldo. Cargá solo movimientos posteriores.`;

const SIN_PERMISO   = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 106 de la base de datos";

// Tabla nueva que todavía no está en src/types/database.ts (ese archivo se regenera aparte): se castea como en el resto del repo.
type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const esTablaFaltante = (m: string) => m.includes("proveedor_cuenta") && /does not exist|schema cache|no existe/i.test(m);

// Un pago a cuenta o un saldo inicial. El saldo inicial es único por proveedor y local; si se cargó mal, se anula y se vuelve a cargar.
export async function registrarMovimientoProveedor(entrada: MovimientoEntrada, confirmarExceso = false): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const validado = validarMovimientoProveedor(entrada, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };
  const m = validado.valor;

  const admin: Admin = createAdminClient();
  // Un proveedor desactivado con deuda se tiene que poder pagar: la baja solo impide cargarle compras nuevas o un saldo inicial.
  const consultaProveedor = admin.from("proveedores").select("id, nombre").eq("id", m.proveedor_id);
  const [{ data: prov }, { data: suc }] = await Promise.all([
    (m.tipo === "pago" ? consultaProveedor : consultaProveedor.eq("is_active", true)).maybeSingle(),
    admin.from("sucursales").select("id, nombre").eq("id", m.sucursal_id).eq("entra_en_tesoreria", true).maybeSingle(),
  ]);
  if (!prov) return { error: m.tipo === "pago" ? "Ese proveedor no existe" : "Ese proveedor no existe o está desactivado" };
  if (!suc)  return { error: "Ese local no entra en Tesorería" };

  if (m.tipo === "pago") {
    const { saldo, fechaCorte } = await cargarCuentaDe(admin, m.proveedor_id, m.sucursal_id);
    if (fechaCorte && m.fecha <= fechaCorte) return { error: msgCorte(fechaCorte) };
    // Pagar de más (o por adelantado) es posible, pero tiene que ser a propósito: un cero de más no puede pasar sin aviso.
    if (!confirmarExceso && m.monto > saldo) {
      const debe = Math.max(saldo, 0);
      return {
        error: `Este pago (${AR.format(m.monto)}) es mayor que lo que se le debe (${AR.format(debe)}): la cuenta quedaría con ${AR.format(m.monto - debe)} a favor.`,
        confirmar: { saldo, monto: m.monto },
      };
    }
  }

  const { data: creado, error } = await admin.from("proveedor_cuenta")
    .insert({ ...m, created_by: permisos.userId }).select("id").single();
  if (error || !creado) {
    const msg = error?.message ?? "";
    if (esTablaFaltante(msg)) return { error: SIN_MIGRACION };
    if (/proveedor_cuenta_saldo_inicial_uni|duplicate key/i.test(msg)) {
      return { error: "Ya hay un saldo inicial cargado para ese proveedor y local. Si estaba mal, anulalo y cargalo de nuevo." };
    }
    return { error: msg || "No se pudo guardar" };
  }

  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId,
    accion: m.tipo === "pago" ? "proveedor_pago" : "proveedor_saldo_inicial",
    entidad_id: creado.id,
    detalle: { monto: m.monto, proveedor: prov.nombre, sucursal: suc.nombre, origen: m.origen, fecha: m.fecha },
    motivo: m.nota,
  });
  revalidatePath("/admin/tesoreria");
  if (historial.error) {
    console.error("[tesoreria] no se pudo anotar en el historial:", historial.error);
    return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
  }
  return {};
}

export async function anularMovimientoProveedor(id: string, motivo: string): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const texto = (motivo ?? "").trim();
  if (texto.length < 3)   return { error: "Escribí el motivo de la anulación" };
  if (texto.length > 200) return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const admin: Admin = createAdminClient();
  const { data, error } = await admin.from("proveedor_cuenta")
    .update({ anulado_en: new Date().toISOString(), anulado_por: permisos.userId, anulado_motivo: texto })
    .eq("id", id).is("anulado_en", null)
    .select("id, tipo, monto, proveedor:proveedores(nombre), sucursal:sucursales(nombre)");
  if (error) return { error: esTablaFaltante(error.message) ? SIN_MIGRACION : error.message };
  if ((data ?? []).length === 0) return { error: "Ese movimiento ya estaba anulado. Recargá la pantalla." };

  // Si el pago salía de un retiro de caja, el retiro vuelve a «Para registrar».
  await admin.from("retiros_caja").update({ proveedor_cuenta_id: null }).eq("proveedor_cuenta_id", id);

  const fila = data![0] as { tipo: string; monto: number | string; proveedor: { nombre: string } | null; sucursal: { nombre: string } | null };
  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId, accion: "proveedor_movimiento_anulado", entidad_id: id, motivo: texto,
    detalle: { tipo: fila.tipo, monto: Number(fila.monto), proveedor: fila.proveedor?.nombre ?? null, sucursal: fila.sucursal?.nombre ?? null },
  });
  revalidatePath("/admin/tesoreria");
  return historial.error ? { error: "Se anuló, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
}

// Un retiro de caja que pagó a un proveedor (autorizado por un administrador, migración 103) se registra como PAGO a la cuenta de ese
// proveedor, no como un egreso: la compra ya está (o va a estar) cargada como remito «se debe», y registrarlo como gasto la contaría
// dos veces. El pago baja el saldo, no es un gasto y no toca el efectivo ni Mercado Pago (la plata salió del cajón del kiosco).
export async function registrarRetiroComoPago(retiroId: string): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const admin: Admin = createAdminClient();
  const { data: r } = await admin.from("retiros_caja")
    .select("id, sucursal_id, fecha, monto, motivo, proveedor_id, egreso_id, proveedor_cuenta_id").eq("id", retiroId).maybeSingle();
  if (!r) return { error: "No se encontró ese retiro" };
  if (!r.proveedor_id) return { error: "Este retiro no tiene proveedor: se registra como egreso" };
  if (r.egreso_id || r.proveedor_cuenta_id) return { error: "Ese retiro ya fue registrado. Recargá la pantalla." };

  const [{ data: prov }, { data: suc }] = await Promise.all([
    admin.from("proveedores").select("id, nombre").eq("id", r.proveedor_id).maybeSingle(),
    admin.from("sucursales").select("id, nombre").eq("id", r.sucursal_id).eq("entra_en_tesoreria", true).maybeSingle(),
  ]);
  if (!prov) return { error: "Ese proveedor no existe" };
  if (!suc)  return { error: "Ese local no entra en Tesorería" };

  const { fechaCorte } = await cargarCuentaDe(admin, r.proveedor_id, r.sucursal_id);
  if (fechaCorte && r.fecha <= fechaCorte) return { error: msgCorte(fechaCorte) };

  const nota = `Retiro de caja del ${dma(r.fecha)}${r.motivo ? `: ${r.motivo}` : ""}`.slice(0, 200);
  const { data: creado, error } = await admin.from("proveedor_cuenta")
    .insert({ tipo: "pago", proveedor_id: r.proveedor_id, sucursal_id: r.sucursal_id, fecha: r.fecha, monto: Number(r.monto), origen: "retiro_caja", nota, created_by: permisos.userId })
    .select("id").single();
  if (error || !creado) {
    const msg = error?.message ?? "";
    return { error: esTablaFaltante(msg) ? SIN_MIGRACION : /proveedor_cuenta_origen_check/i.test(msg) ? "Falta aplicar la migración 111 de la base de datos" : (msg || "No se pudo guardar") };
  }

  // Tomar el retiro. El filtro evita pisar a otro administrativo que lo registró en el medio.
  const { data: tomado, error: errTomar } = await admin.from("retiros_caja")
    .update({ proveedor_cuenta_id: creado.id }).eq("id", retiroId).is("egreso_id", null).is("proveedor_cuenta_id", null).select("id");
  if (errTomar || (tomado ?? []).length === 0) {
    // Compensación: este pago recién creado nunca llegó a verse; se borra para no dejar un pago sin retiro.
    await admin.from("proveedor_cuenta").delete().eq("id", creado.id);
    return { error: errTomar ? "Falta aplicar la migración 111 de la base de datos" : "Alguien más registró ese retiro mientras tanto. Recargá la pantalla." };
  }

  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId, accion: "proveedor_pago", entidad_id: creado.id, motivo: r.motivo,
    detalle: { monto: Number(r.monto), proveedor: prov.nombre, sucursal: suc.nombre, origen: "retiro_caja", fecha: r.fecha, retiro_de_caja: retiroId },
  });
  revalidatePath("/admin/tesoreria");
  if (historial.error) {
    console.error("[tesoreria] no se pudo anotar en el historial:", historial.error);
    return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
  }
  return {};
}
