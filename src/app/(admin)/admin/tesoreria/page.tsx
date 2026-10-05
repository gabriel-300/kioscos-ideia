import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { fechaHoyAR } from "@/lib/fecha";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import {
  cargarConfig, cargarSucursales, cargarProveedores, cargarGastosFijos, cargarRetirosPendientes, cargarEntregasPendientes,
  cargarEgresosDelPeriodo, cargarEgresosPendientes, cargarSalidasEfectivo, cargarVentasDelPeriodo, cargarSobresRetirados, cargarSobresSinRetirar,
  cargarEntregasDescartadas, cargarTotalesKiosco,
} from "@/lib/tesoreria/consultas";
import { agruparDeuda, efectivoDeTesoreria, mesAnteriorYSiguiente, montoSobre, rangoDelMes, resumirEgresos } from "@/lib/tesoreria/calculos";
import { ResumenView, type ResumenData } from "./_components/resumen-view";
import { ParaRegistrar } from "./_components/para-registrar";
import { EgresosLista } from "./_components/egresos-lista";
import { FijosLista } from "./_components/fijos-lista";

export const revalidate = 0;
export const metadata: Metadata = { title: "Tesorería — Kioscos IDEIA" };

const VISTAS = [
  { id: "resumen",        etiqueta: "Resumen" },
  { id: "para-registrar", etiqueta: "Para registrar" },
  { id: "egresos",        etiqueta: "Egresos" },
  { id: "fijos",          etiqueta: "Gastos fijos" },
] as const;
type Vista = (typeof VISTAS)[number]["id"];

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; mes?: string }>;
}) {
  const permisos = await permisosTesoreria();
  if (!permisos) redirect("/login");
  // Ver Tesorería: admin o socio. Cargar: solo el administrativo (lib/tesoreria/permisos.ts).
  if (!permisos.puedeVer) redirect("/admin/dashboard");

  const sp    = await searchParams;
  const vista = (VISTAS.find((v) => v.id === sp.vista)?.id ?? "resumen") as Vista;
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
    if (vista === "para-registrar") descartadas = await cargarEntregasDescartadas(admin, sucursalIds, config.fecha_inicio);
    if (vista === "fijos") fijos = await cargarGastosFijos(admin);

    if (vista === "resumen") {
      const [entro, pendientes, salidasEfectivo, sobresRetirados, sobresSinRetirar] = await Promise.all([
        cargarVentasDelPeriodo(admin, sucursalIds, rango.desde, rango.hasta),
        cargarEgresosPendientes(admin),
        cargarSalidasEfectivo(admin, config.fecha_inicio),
        cargarSobresRetirados(admin, sucursalIds, config.fecha_inicio),
        cargarSobresSinRetirar(admin, sucursalIds, config.fecha_inicio),
      ]);
      const nombreProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]));
      const efectivo = efectivoDeTesoreria({ efectivoInicial: config.efectivo_inicial, sobresRecibidos: sobresRetirados, egresos: salidasEfectivo });
      resumen = {
        entro: entro,
        gasto: resumirEgresos(egresosMes),
        deuda: agruparDeuda(pendientes, nombreProveedor),
        efectivo: { ...efectivo, inicial: config.efectivo_inicial },
        sobresSinRetirar: sobresSinRetirar.reduce((s, c) => s + montoSobre(c), 0),
      };
    }

    datos = { config, sucursales, proveedores, retiros, entregas, descartadas, totalesKiosco, resumen, egresosMes, fijos, pendientesTodos };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Tesorería todavía no está lista en la base de datos.</p>
          <p className="mt-1">Falta aplicar las migraciones 101, 102 y 103 (carpeta supabase/migrations) en el SQL Editor de Supabase.</p>
          <p className="mt-2 text-xs text-amber-700">Detalle técnico: {detalle}</p>
        </div>
      </div>
    );
  }

  const { sucursales, proveedores, retiros, entregas, descartadas, totalesKiosco, resumen, egresosMes, fijos, pendientesTodos } = datos;
  // El contador cuenta solo los retiros de caja (son la tarea). Los ingresos del kiosco son un control, no una deuda.
  const pendientesDeRegistrar = retiros.length;
  const enlace = (v: string, m: string = mes) => `/admin/tesoreria?vista=${v}&mes=${m}`;

  const pagadosPorFijo: Record<string, { monto: number; fecha: string }> = {};
  for (const e of egresosMes) if (e.gasto_fijo_id) pagadosPorFijo[e.gasto_fijo_id] = { monto: e.monto, fecha: e.fecha };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Tesorería</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Lo que entra, lo que sale y lo que se debe de {sucursales.map((s) => s.nombre).join(" y ")}
          {!permisos.puedeCargar && " — solo lectura"}
        </p>
      </div>

      <nav className="flex gap-1 border-b border-neutral-200 mb-6 overflow-x-auto">
        {VISTAS.map((v) => (
          <Link key={v.id} href={enlace(v.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              vista === v.id ? "border-tierra-700 font-semibold text-tierra-900" : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}>
            {v.etiqueta}
            {v.id === "para-registrar" && pendientesDeRegistrar > 0 && (
              <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800">{pendientesDeRegistrar}</span>
            )}
          </Link>
        ))}
      </nav>

      {vista !== "para-registrar" && (
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
      {vista === "fijos" && (
        <FijosLista fijos={fijos} pagadosPorFijo={pagadosPorFijo} mes={mes} sucursales={sucursales} proveedores={proveedores} puedeCargar={permisos.puedeCargar} />
      )}
    </div>
  );
}
