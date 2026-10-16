// Lo que necesita el panel «Para revisar» del Resumen (ver alertas.ts). Cliente admin: quien llama ya verificó el permiso.
// Cada fuente tolera que su migración todavía no esté aplicada: sin ella simplemente no hay avisos de ese tipo.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { aCentavos, diaAR, aPesos, sumarDias } from "./peya";
import { cargarLiquidacionesPeyaSiExiste, cargarVentasParaCruce, cargarVentasYaCruzadas, type LiquidacionPeya } from "./peya-consultas";
import { cargarCobrosSinClasificar } from "./mp-consultas";
import type { EntradaAlertas } from "./alertas";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

const sinTabla = (e: unknown, ...nombres: string[]) => e instanceof Error && nombres.some((n) => e.message.includes(n));

// Pedidos entregados que no cruzaron con ninguna venta (o con otro importe) y nadie dio por revisados.
async function pedidosParaRevisar(admin: Admin): Promise<Pick<EntradaAlertas, "peyaSinVenta" | "peyaImporteDistinto">> {
  const vacio = { peyaSinVenta: { cantidad: 0, monto: 0 }, peyaImporteDistinto: { cantidad: 0, monto: 0 } };
  try {
    const filas = await fetchAll<{ conciliacion: string; total_parcial: number | string; diferencia_importe: number | string | null }>((d, h) =>
      tabla(admin, "peya_pedidos").select("conciliacion, total_parcial, diferencia_importe", { count: "exact" })
        .eq("estado", "entregado").in("conciliacion", ["sin_venta", "importe_distinto"]).is("revisado_en", null).order("id").range(d, h));
    let sv = 0, svMonto = 0, id = 0, idMonto = 0;
    for (const f of filas) {
      if (f.conciliacion === "sin_venta") { sv++; svMonto += aCentavos(Number(f.total_parcial)); }
      else { id++; idMonto += Math.abs(aCentavos(Number(f.diferencia_importe ?? 0))); }
    }
    return { peyaSinVenta: { cantidad: sv, monto: aPesos(svMonto) }, peyaImporteDistinto: { cantidad: id, monto: aPesos(idMonto) } };
  } catch (e) {
    if (sinTabla(e, "peya_pedidos", "revisado_en")) return vacio;
    throw e;
  }
}

// Ventas del kiosco cargadas como PedidosYa dentro de las últimas liquidaciones que ningún pedido reclama. Solo las dos más recientes
// (son las que todavía se pueden corregir): el costo es una consulta de ventas por liquidación.
async function ventasSinPedido(admin: Admin, liquidaciones: LiquidacionPeya[]): Promise<{ cantidad: number; monto: number }> {
  let cantidad = 0, monto = 0;
  for (const l of liquidaciones.slice(0, 2)) {
    if (!l.sucursal_id) continue;
    const ventas = await cargarVentasParaCruce(admin, l.sucursal_id, l.periodo_desde, l.periodo_hasta);
    const cruzadas = await cargarVentasYaCruzadas(admin, ventas.map((v) => v.id));
    for (const v of ventas) {
      const dia = diaAR(v.creado_en);
      if (!cruzadas.has(v.id) && dia >= l.periodo_desde && dia <= l.periodo_hasta && v.total > 0) { cantidad++; monto += v.total; }
    }
  }
  return { cantidad, monto: aPesos(monto) };
}

export async function cargarEntradaAlertas(admin: Admin, hoy: string, yaCargadas?: LiquidacionPeya[]): Promise<EntradaAlertas> {
  const liquidaciones = yaCargadas ?? await cargarLiquidacionesPeyaSiExiste(admin);
  const [pedidos, sinPedido, sinClasificar, pagosSinVenta] = await Promise.all([
    pedidosParaRevisar(admin),
    ventasSinPedido(admin, liquidaciones),
    cargarCobrosSinClasificar(admin).catch((e) => { if (sinTabla(e, "mp_cobros")) return []; throw e; }),
    tabla(admin, "mercadopago_qr_orders").select("id", { count: "exact", head: true }).eq("estado", "pagado").is("movimiento_id", null)
      .gte("paid_at", `${sumarDias(hoy, -30)}T00:00:00-03:00`) as Promise<{ count: number | null }>,   // solo los últimos 30 días: lo viejo no es accionable
  ]);
  return {
    hoy, liquidaciones, ...pedidos, peyaVentasSinPedido: sinPedido,
    mpSinClasificar: { cantidad: sinClasificar.length, monto: aPesos(sinClasificar.reduce((s, c) => s + aCentavos(c.monto_neto), 0)) },
    mpPagosSinVenta: pagosSinVenta.count ?? 0,
  };
}

