import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { rolDe } from "@/lib/auth/acceso";
import { fechaHoyAR } from "@/lib/fecha";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import {
  cargarConfig, cargarSucursales, cargarProveedores, cargarGastosFijos, cargarRetirosPendientes, cargarEntregasPendientes,
  cargarEgresosDelPeriodo, cargarEgresosPendientes, cargarSalidasEfectivo, cargarVentasDelPeriodo, cargarSobresRetirados, cargarSobresSinRetirar,
  cargarEntregasDescartadas, cargarTotalesKiosco, cargarHistorial, cargarCambiosEfectivoInicial,
} from "@/lib/tesoreria/consultas";
import { HistorialView } from "./_components/historial-view";
import { efectivoDeTesoreria, mesAnteriorYSiguiente, montoSobre, obligacionesDelMes, rangoDelMes, resumirEgresos, tengoMenosDebo } from "@/lib/tesoreria/calculos";
import { ResumenView, type ResumenData } from "./_components/resumen-view";
import { ParaRegistrar } from "./_components/para-registrar";
import { EgresosLista } from "./_components/egresos-lista";
import { FijosLista } from "./_components/fijos-lista";
import { MercadoPagoView, type MercadoPagoData } from "./_components/mercadopago-view";
import { ProveedoresView, type ProveedoresData } from "./_components/proveedores-view";
import { CuentasView, type CuentasData } from "./_components/cuentas-view";
import { PeyaView, type PeyaData } from "./_components/peya-view";
import { aCobrarPeya, diaAR } from "@/lib/tesoreria/peya";
import {
  cargarArchivosDeLiquidacion, cargarLiquidacionPeya, cargarLiquidacionesPeya, cargarLiquidacionesPeyaSiExiste, cargarPedidosDeLiquidacion, cargarVentasParaCruce, cargarVentasYaCruzadas,
} from "@/lib/tesoreria/peya-consultas";
import { cargarCuentaMp } from "@/lib/tesoreria/cuenta-mp-consultas";
import { cargarMovimientosProveedor } from "@/lib/tesoreria/proveedores-consultas";
import { deudaDelResumen, totalAdeudado } from "@/lib/tesoreria/proveedores-cuenta";
import { cargarCobrosMp, cargarCobrosSinClasificar, cargarImportacionesMp, cargarRangosImportados, cargarOrdenesQr, cargarVentasMp } from "@/lib/tesoreria/mp-consultas";
import { compararPorDia, cruzarConSistema, resumirCobros } from "@/lib/tesoreria/mp-cobros";
import { SolapasTesoreria } from "./_components/solapas";

export const revalidate = 0;
export const metadata: Metadata = { title: "Tesorería — Kioscos IDEIA" };

const VISTAS = ["resumen", "cuentas", "para-registrar", "egresos", "proveedores", "fijos", "mercadopago", "pedidosya", "historial"] as const;
type Vista = (typeof VISTAS)[number];

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; mes?: string; liq?: string }>;
}) {
  const permisos = await permisosTesoreria();
  if (!permisos) redirect("/login");
  // Ver Tesorería: admin o socio. Cargar: solo el administrativo (lib/tesoreria/permisos.ts).
  if (!permisos.puedeVer) redirect("/admin/dashboard");

  const esAdmin = rolDe(await getUser()) === "admin";
  const sp    = await searchParams;
  const vista = (VISTAS.find((v) => v === sp.vista) ?? "resumen") as Vista;
  const mesActual = fechaHoyAR().slice(0, 7);
  const mes   = sp.mes && rangoDelMes(sp.mes) ? sp.mes : mesActual;
  const rango = rangoDelMes(mes)!;
  const { anterior, siguiente } = mesAnteriorYSiguiente(mes);
  const mesLabel = new Date(`${mes}-01T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  const admin = createAdminClient();

  let datos;
  try {
    const config = await cargarConfig(admin);
    if (!config) throw new Error("falta la migración 101");

    const [sucursales, proveedores] = await Promise.all([cargarSucursales(admin), cargarProveedores(admin)]);
    const sucursalIds = sucursales.map((s) => s.id);

    const [retiros, entregas] = await Promise.all([
      cargarRetirosPendientes(admin, sucursalIds, config.fecha_inicio),
      cargarEntregasPendientes(admin, sucursalIds, config.fecha_inicio),
    ]);

    let resumen: ResumenData | null = null;
    let egresosMes: Awaited<ReturnType<typeof cargarEgresosDelPeriodo>> = [];
    let fijos: Awaited<ReturnType<typeof cargarGastosFijos>> = [];
    let pendientesTodos: Awaited<ReturnType<typeof cargarEgresosPendientes>> = [];
    let descartadas: Awaited<ReturnType<typeof cargarEntregasDescartadas>> = [];
    let historial: Awaited<ReturnType<typeof cargarHistorial>> = [];
    const totalesKiosco: Record<string, number> = {};

    if (vista === "resumen" || vista === "egresos" || vista === "fijos") {
      egresosMes = await cargarEgresosDelPeriodo(admin, rango.desde, rango.hasta);
    }
    // Las compras que todavía se deben se muestran en Egresos sin importar el mes: si no, una de agosto no se podría
    // marcar pagada desde ningún lado.
    if (vista === "egresos") {
      pendientesTodos = await cargarEgresosPendientes(admin);
      // Lo que cargó el kiosco en las entregas vinculadas a cada compra de mercadería: para mostrar la diferencia con la factura.
      const idsMercaderia = [...egresosMes, ...pendientesTodos].filter((e) => e.categoria === "mercaderia").map((e) => e.id);
      for (const [id, total] of await cargarTotalesKiosco(admin, [...new Set(idsMercaderia)])) totalesKiosco[id] = total;
    }
    if (vista === "historial") historial = await cargarHistorial(admin, rango.desde, rango.hasta);
    if (vista === "para-registrar") descartadas = await cargarEntregasDescartadas(admin, sucursalIds, config.fecha_inicio);
    if (vista === "fijos" || vista === "resumen") fijos = await cargarGastosFijos(admin);

    if (vista === "resumen") {
      const [entro, pendientes, salidasEfectivo, sobresRetirados, sobresSinRetirar, cambiosEfectivoInicial, movimientosProv, cuentaMp, liquidacionesPeya] = await Promise.all([
        cargarVentasDelPeriodo(admin, sucursalIds, rango.desde, rango.hasta),
        cargarEgresosPendientes(admin),
        cargarSalidasEfectivo(admin, config.fecha_inicio),
        cargarSobresRetirados(admin, sucursalIds, config.fecha_inicio),
        cargarSobresSinRetirar(admin, sucursalIds, config.fecha_inicio),
        cargarCambiosEfectivoInicial(admin),
        cargarMovimientosProveedor(admin, true),
        cargarCuentaMp(admin, true),
        cargarLiquidacionesPeyaSiExiste(admin),
      ]);
      const nombreProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]));
      const efectivo = efectivoDeTesoreria({ efectivoInicial: config.efectivo_inicial, sobresRecibidos: sobresRetirados, egresos: salidasEfectivo });
      const deudaResumen = (({ items, total }) => ({ items, total }))(
        deudaDelResumen(pendientes, movimientosProv, nombreProveedor, new Map(sucursales.map((s) => [s.id, s.nombre]))),
      );
      const obligaciones = obligacionesDelMes(fijos, egresosMes, mes, fechaHoyAR());
      resumen = {
        entro: entro,
        gasto: resumirEgresos(egresosMes),
        // Con cuenta corriente (migración 106) lo que se debe a un proveedor es su saldo, no la suma de compras sueltas.
        deuda: deudaResumen,
        obligaciones,
        mp: { configurada: cuentaMp.saldo.configurada, disponible: cuentaMp.saldo.disponible },
        peya: aCobrarPeya(liquidacionesPeya),
        // «Tengo» es lo de hoy: solo tiene sentido junto con las obligaciones del mes en curso, no con las de un mes pasado.
        tengoMenosDebo: mes === mesActual
          ? tengoMenosDebo({ efectivo: efectivo.efectivo, mpDisponible: cuentaMp.saldo.configurada ? cuentaMp.saldo.disponible : 0, deudaProveedores: deudaResumen.total, obligacionesPendientes: obligaciones.pendiente })
          : null,
        efectivo: { ...efectivo, inicial: config.efectivo_inicial },
        sobresSinRetirar: sobresSinRetirar.reduce((s, c) => s + montoSobre(c), 0),
        cambiosEfectivoInicial,
      };
    }

    datos = { config, sucursales, proveedores, retiros, entregas, descartadas, totalesKiosco, resumen, egresosMes, fijos, pendientesTodos, historial };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Tesorería todavía no está lista en la base de datos.</p>
          <p className="mt-1">Falta aplicar las migraciones 101 a 104 (carpeta supabase/migrations) en el SQL Editor de Supabase.</p>
          <p className="mt-2 text-xs text-amber-700">Detalle técnico: {detalle}</p>
        </div>
      </div>
    );
  }

  // Solapa «Cobros MP» (migración 105). Aparte del bloque de arriba para que, sin la migración, solo esta solapa muestre el aviso.
  let mp: MercadoPagoData | null = null;
  let mpError = "";
  if (vista === "mercadopago") {
    try {
      const desdeIso = `${rango.desde}T00:00:00-03:00`;
      const hastaIso = `${rango.hasta}T23:59:59-03:00`;
      const [cobros, sinClasificar, importaciones, rangos, ordenes, ventasMp] = await Promise.all([
        cargarCobrosMp(admin, desdeIso, hastaIso), cargarCobrosSinClasificar(admin),
        cargarImportacionesMp(admin), cargarRangosImportados(admin), cargarOrdenesQr(admin, desdeIso, hastaIso),
        cargarVentasMp(admin, rango.desde, rango.hasta),
      ]);
      const cruce = cruzarConSistema(cobros, ordenes, rangos);
      const { total, porSucursal } = resumirCobros(cobros);
      const nombreLocal = Object.fromEntries(datos.sucursales.map((s) => [s.id, s.nombre]));
      mp = {
        total,
        porLocal: [...porSucursal.entries()].map(([sucursalId, totales]) => ({ sucursalId, nombre: nombreLocal[sucursalId] ?? "Sin local", totales }))
          .sort((a, b) => b.totales.bruto - a.totales.bruto),
        sinClasificar,
        clasificados: cobros.filter((c) => c.clase === "a_clasificar" && c.clasificacion),
        cruce,
        porDia: compararPorDia(cobros, ventasMp, new Set(cruce.mpSinSistema.map((c) => c.operation_id)), rangos),
        importaciones, nombreLocal,
      };
    } catch (e) {
      mpError = e instanceof Error ? e.message : String(e);
    }
  }

  // Solapa «PedidosYa» (migración 108). Aparte del bloque de arriba para que, sin la migración, solo esta solapa muestre el aviso.
  let peya: PeyaData | null = null;
  let peyaError = "";
  if (vista === "pedidosya") {
    try {
      const liquidaciones = await cargarLiquidacionesPeya(admin);
      const nombreLocal = Object.fromEntries(datos.sucursales.map((s) => [s.id, s.nombre]));
      let detalle: PeyaData["detalle"] = null;
      const liqId = sp.liq && /^[0-9a-f-]{36}$/i.test(sp.liq) ? sp.liq : null;
      if (liqId) {
        const liquidacion = await cargarLiquidacionPeya(admin, liqId);
        if (liquidacion) {
          const [pedidos, archivos, ventas] = await Promise.all([
            cargarPedidosDeLiquidacion(admin, liqId),
            cargarArchivosDeLiquidacion(admin, liqId),
            liquidacion.sucursal_id ? cargarVentasParaCruce(admin, liquidacion.sucursal_id, liquidacion.periodo_desde, liquidacion.periodo_hasta) : Promise.resolve([]),
          ]);
          // Ventas del kiosco del período que no están cruzadas con ningún pedido (de esta ni de otra liquidación).
          const cruzadas = await cargarVentasYaCruzadas(admin, ventas.map((v) => v.id));
          const ventasSinPeya = ventas
            .filter((v) => !cruzadas.has(v.id) && diaAR(v.creado_en) >= liquidacion.periodo_desde && diaAR(v.creado_en) <= liquidacion.periodo_hasta)
            .map((v) => ({ id: v.id, creado_en: v.creado_en, total: v.total / 100, canal: v.canal }));
          detalle = { liquidacion, pedidos, archivos, ventasSinPeya };
        }
      }
      peya = { liquidaciones, nombreLocal, aCobrar: aCobrarPeya(liquidaciones), detalle };
    } catch (e) {
      peyaError = e instanceof Error ? e.message : String(e);
    }
  }

  // Solapa «Cuentas» (migración 107). Aparte del bloque de arriba para que, sin la migración, solo esta solapa muestre el aviso.
  let cuentas: CuentasData | null = null;
  let cuentasError = "";
  if (vista === "cuentas") {
    try {
      const idsSucursales = datos.sucursales.map((s) => s.id);
      const [salidas, sobres, cuentaMp] = await Promise.all([
        cargarSalidasEfectivo(admin, datos.config.fecha_inicio),
        cargarSobresRetirados(admin, idsSucursales, datos.config.fecha_inicio),
        cargarCuentaMp(admin),
      ]);
      const ef = efectivoDeTesoreria({ efectivoInicial: datos.config.efectivo_inicial, sobresRecibidos: sobres, egresos: salidas });
      cuentas = { efectivo: { ...ef, inicial: datos.config.efectivo_inicial }, mp: cuentaMp.saldo, movimientos: cuentaMp.movimientos };
    } catch (e) {
      cuentasError = e instanceof Error ? e.message : String(e);
    }
  }

  // Solapa «Proveedores» (migración 106). Aparte del bloque de arriba para que, sin la migración, solo esta solapa muestre el aviso.
  let prov: ProveedoresData | null = null;
  let provError = "";
  if (vista === "proveedores") {
    try {
      const [pendientes, movimientos] = await Promise.all([cargarEgresosPendientes(admin), cargarMovimientosProveedor(admin)]);
      const nombreProveedor = new Map(datos.proveedores.map((p) => [p.id, p.nombre]));
      const nombreLocal = new Map(datos.sucursales.map((s) => [s.id, s.nombre]));
      const d = deudaDelResumen(pendientes, movimientos, nombreProveedor, nombreLocal);
      prov = {
        cuentas: d.cuentas, totales: totalAdeudado(d.cuentas), sinProveedor: d.sinProveedor,
        nombreProveedor: Object.fromEntries(nombreProveedor), nombreLocal: Object.fromEntries(nombreLocal),
      };
    } catch (e) {
      provError = e instanceof Error ? e.message : String(e);
    }
  }

  const { sucursales, proveedores, retiros, entregas, descartadas, totalesKiosco, resumen, egresosMes, fijos, pendientesTodos, historial } = datos;
  // El contador cuenta solo los retiros de caja (son la tarea). Los ingresos del kiosco son un control, no una deuda.
  const pendientesDeRegistrar = retiros.length;
  const enlace = (v: string, m: string = mes) => `/admin/tesoreria?vista=${v}&mes=${m}`;

  // Un gasto fijo puede pagarse en partes (el sueldo en dos veces): se suma lo registrado y se muestra la fecha del último pago.
  const pagadosPorFijo: Record<string, { monto: number; fecha: string; pagos: number }> = {};
  for (const e of egresosMes) {
    if (!e.gasto_fijo_id) continue;
    const p = pagadosPorFijo[e.gasto_fijo_id] ?? { monto: 0, fecha: e.fecha, pagos: 0 };
    p.monto += e.monto;
    p.pagos += 1;
    if (e.fecha > p.fecha) p.fecha = e.fecha;
    pagadosPorFijo[e.gasto_fijo_id] = p;
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Tesorería</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Lo que entra, lo que sale y lo que se debe de {sucursales.map((s) => s.nombre).join(" y ")}
          {!permisos.puedeCargar && " — solo lectura"}
        </p>
      </div>

      <SolapasTesoreria activa={vista} esAdmin={esAdmin} pendientes={pendientesDeRegistrar} mes={mes} />

      {vista !== "para-registrar" && vista !== "proveedores" && vista !== "cuentas" && vista !== "pedidosya" && (
        <div className="flex items-center gap-3 mb-6">
          <Link href={enlace(vista, anterior)} aria-label="Mes anterior" className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
            <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </Link>
          <span className="font-semibold text-neutral-900 capitalize min-w-36 text-center">{mesLabel}</span>
          {mes < mesActual ? (
            <Link href={enlace(vista, siguiente)} aria-label="Mes siguiente" className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
              <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            </Link>
          ) : <div className="size-9" />}
        </div>
      )}

      {vista === "resumen" && resumen && <ResumenView data={resumen} mesLabel={mesLabel} puedeCargar={permisos.puedeCargar} />}
      {vista === "para-registrar" && (
        <ParaRegistrar retiros={retiros} entregas={entregas} descartadas={descartadas} sucursales={sucursales} proveedores={proveedores} puedeCargar={permisos.puedeCargar} />
      )}
      {vista === "egresos" && (
        <EgresosLista egresos={egresosMes} pendientes={pendientesTodos} entregasDisponibles={entregas} totalesKiosco={totalesKiosco} sucursales={sucursales} proveedores={proveedores} puedeCargar={permisos.puedeCargar} />
      )}
      {vista === "pedidosya" && peya && <PeyaView data={peya} puedeCargar={permisos.puedeCargar} />}
      {vista === "pedidosya" && peyaError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Las liquidaciones de PedidosYa todavía no están listas en la base de datos.</p>
          <p className="mt-1">Falta aplicar la migración 108 (carpeta supabase/migrations) en el SQL Editor de Supabase.</p>
          <p className="mt-2 text-xs text-amber-700">Detalle técnico: {peyaError}</p>
        </div>
      )}
      {vista === "cuentas" && cuentas && <CuentasView data={cuentas} puedeCargar={permisos.puedeCargar} />}
      {vista === "cuentas" && cuentasError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Las cuentas todavía no están listas en la base de datos.</p>
          <p className="mt-1">Falta aplicar la migración 107 (carpeta supabase/migrations) en el SQL Editor de Supabase.</p>
          <p className="mt-2 text-xs text-amber-700">Detalle técnico: {cuentasError}</p>
        </div>
      )}
      {vista === "proveedores" && prov && (
        <ProveedoresView data={prov} proveedores={proveedores} sucursales={sucursales} puedeCargar={permisos.puedeCargar} />
      )}
      {vista === "proveedores" && provError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">La cuenta corriente de proveedores todavía no está lista en la base de datos.</p>
          <p className="mt-1">Falta aplicar la migración 106 (carpeta supabase/migrations) en el SQL Editor de Supabase.</p>
          <p className="mt-2 text-xs text-amber-700">Detalle técnico: {provError}</p>
        </div>
      )}
      {vista === "mercadopago" && mp && <MercadoPagoView data={mp} puedeCargar={permisos.puedeCargar} mesLabel={mesLabel} />}
      {vista === "mercadopago" && mpError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Cobros de Mercado Pago todavía no está listo en la base de datos.</p>
          <p className="mt-1">Falta aplicar la migración 105 (carpeta supabase/migrations) en el SQL Editor de Supabase.</p>
          <p className="mt-2 text-xs text-amber-700">Detalle técnico: {mpError}</p>
        </div>
      )}
      {vista === "historial" && <HistorialView filas={historial} />}
      {vista === "fijos" && (
        <FijosLista fijos={fijos} pagadosPorFijo={pagadosPorFijo} mes={mes} sucursales={sucursales} proveedores={proveedores} puedeCargar={permisos.puedeCargar} />
      )}
    </div>
  );
}
