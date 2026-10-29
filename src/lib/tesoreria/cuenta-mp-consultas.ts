// Lecturas de la cuenta de Mercado Pago (migración 107). Cliente admin: quien llama ya verificó el permiso.
// Las tablas nuevas todavía no están en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { cargarFlujosPersonas } from "./persona-cuenta-consultas";
import { calcularSaldoMp, type CobroParaSaldo, type MovimientoMp, type PagoDesdeMp, type SaldoMp, type TipoMovimientoMp } from "./cuenta-mp";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

export async function cargarMovimientosMp(admin: Admin): Promise<MovimientoMp[]> {
  const filas = await fetchAll<Record<string, unknown>>((d, h) =>
    tabla(admin, "cuenta_mp").select("id, tipo, fecha, monto, nota, created_at, created_by", { count: "exact" })
      .is("anulado_en", null).order("id").range(d, h));
  return filas.map((f) => ({
    id: String(f.id), tipo: f.tipo as TipoMovimientoMp, fecha: String(f.fecha), monto: Number(f.monto),
    nota: (f.nota as string | null) ?? null, created_at: String(f.created_at), created_by: (f.created_by as string | null) ?? null,
  }));
}

// Todo lo que hace falta para el saldo. Sin saldo inicial no hay nada más que leer: el saldo no está configurado.
// `tolerarSinTabla`: el Resumen no se rompe si la migración 107 todavía no está aplicada (el saldo queda «sin configurar»).
export async function cargarCuentaMp(admin: Admin, tolerarSinTabla = false): Promise<{ saldo: SaldoMp; movimientos: MovimientoMp[] }> {
  let movimientos: MovimientoMp[];
  try {
    movimientos = await cargarMovimientosMp(admin);
  } catch (e) {
    if (tolerarSinTabla && e instanceof Error && e.message.includes("cuenta_mp")) {
      return { saldo: calcularSaldoMp({ movimientos: [], cobros: [], pagos: [], ahoraMs: Date.now() }), movimientos: [] };
    }
    throw e;
  }
  const inicial = movimientos.find((m) => m.tipo === "saldo_inicial");
  if (!inicial) return { saldo: calcularSaldoMp({ movimientos, cobros: [], pagos: [], ahoraMs: Date.now() }), movimientos };

  const desdeIso = `${inicial.fecha}T00:00:00-03:00`;
  const [cobros, egresos, pagosProv, personas] = await Promise.all([
    fetchAll<Record<string, unknown>>((d, h) =>
      tabla(admin, "mp_cobros").select("fecha_cobro, fecha_liberacion, monto_neto, estado, clase, clasificacion", { count: "exact" })
        .gte("fecha_cobro", desdeIso).order("operation_id").range(d, h)),
    fetchAll<{ monto: number | string; fecha_pago: string }>((d, h) =>
      tabla(admin, "egresos").select("monto, fecha_pago", { count: "exact" })
        .eq("pagado", true).eq("origen", "mercadopago").is("anulado_en", null).gte("fecha_pago", inicial.fecha).order("id").range(d, h)),
    fetchAll<{ monto: number | string; fecha: string }>((d, h) =>
      tabla(admin, "proveedor_cuenta").select("monto, fecha", { count: "exact" })
        .eq("tipo", "pago").eq("origen", "mercadopago").is("anulado_en", null).gte("fecha", inicial.fecha).order("id").range(d, h)),
    cargarFlujosPersonas(admin, "mercadopago", inicial.fecha),
  ]);

  const cobrosSaldo: CobroParaSaldo[] = cobros.map((c) => ({
    fecha_cobro: String(c.fecha_cobro), fecha_liberacion: (c.fecha_liberacion as string | null) ?? null, monto_neto: Number(c.monto_neto),
    estado: String(c.estado), clase: c.clase as CobroParaSaldo["clase"], clasificacion: (c.clasificacion as string | null) ?? null,
  }));
  const pagos: PagoDesdeMp[] = [
    ...egresos.map((e) => ({ monto: Number(e.monto), fecha: String(e.fecha_pago) })),
    ...pagosProv.map((p) => ({ monto: Number(p.monto), fecha: String(p.fecha) })),
    // Adelantos a personas que salieron de Mercado Pago (migración 129); ya vienen filtrados desde el saldo inicial.
    ...(personas.adelantos > 0 ? [{ monto: personas.adelantos, fecha: inicial.fecha }] : []),
  ];
  const reposiciones: PagoDesdeMp[] = personas.reposiciones > 0 ? [{ monto: personas.reposiciones, fecha: inicial.fecha }] : [];
  return { saldo: calcularSaldoMp({ movimientos, cobros: cobrosSaldo, pagos, reposiciones, ahoraMs: Date.now() }), movimientos };
}
