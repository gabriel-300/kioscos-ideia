"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  cerrarLiquidacion, completarConExcel, diaAR, leerCsvPedidos, leerExcelEstadoCuenta, parsearMontoAR, resumirExcel, sumarDias,
  type EstadoCuentaPeya, type LecturaExcel, type LecturaPedidos,
} from "@/lib/tesoreria/peya";
import { crearUrlSubidaPeya, guardarLiquidacionPeya, previsualizarPeya, type VistaPreviaPeya } from "../peya-actions";
import { hojasDeExcel } from "./excel-navegador";

// Una persona baja del Portal de PedidosYa el CSV de pedidos y el Excel del estado de cuenta (y mira el PDF) y los sube acá.
// Los archivos se abren en el navegador; al servidor viajan los pedidos ya leídos (no hay datos de clientes en el CSV), los totales
// del Excel y el estado de cuenta tipeado. El servidor vuelve a calcular todo antes de guardar: si la cuenta no cierra a $0,00, no se confirma.

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const pesos = (centavos: number) => AR.format(centavos / 100);
const MAX_BYTES = 2 * 1024 * 1024;

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";

// Lunes a domingo de la semana en que cae el primer pedido entregado.
function semanaDe(lectura: LecturaPedidos): { desde: string; hasta: string } {
  const fechas = lectura.pedidos.filter((p) => p.estado === "entregado" && p.fecha_pedido).map((p) => diaAR(p.fecha_pedido as string)).sort();
  const base = fechas[0] ?? diaAR(new Date().toISOString());
  const dow = new Date(`${base}T12:00:00Z`).getUTCDay();          // 0 = domingo
  const lunes = sumarDias(base, dow === 0 ? -6 : 1 - dow);
  return { desde: lunes, hasta: sumarDias(lunes, 6) };
}

type Campos = {
  desde: string; hasta: string; tengoEstado: boolean; total: string; publicidad: string; iva: string; sirtac: string;
  reintegros: string; ajustes: string; saldoAnterior: string; fechaPago: string; cuenta: string; nota: string;
};
const CAMPOS_INICIALES: Campos = {
  desde: "", hasta: "", tengoEstado: true, total: "", publicidad: "0", iva: "", sirtac: "0", reintegros: "0", ajustes: "0",
  saldoAnterior: "0", fechaPago: "", cuenta: "", nota: "",
};

function Fila({ ok, texto, detalle }: { ok: boolean; texto: string; detalle?: string }) {
  return (
    <li className="flex gap-2 text-sm">
      <span className={ok ? "text-selva-700" : "text-danger"} aria-hidden>{ok ? "✔" : "✖"}</span>
      <span>
        <span className={ok ? "text-neutral-700" : "text-danger font-medium"}>{texto}</span>
        {detalle && <span className="block text-xs text-neutral-500">{detalle}</span>}
      </span>
    </li>
  );
}

export function ImportarPeya({ puedeCargar }: { puedeCargar: boolean }) {
  const router = useRouter();
  const [csv, setCsv] = useState<File | null>(null);
  const [excelArchivo, setExcelArchivo] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [lectura, setLectura] = useState<LecturaPedidos | null>(null);
  const [excel, setExcel] = useState<LecturaExcel | null>(null);
  const [errorExcel, setErrorExcel] = useState("");
  const [campos, setCampos] = useState<Campos>(CAMPOS_INICIALES);
  const [previa, setPrevia] = useState<VistaPreviaPeya | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [revisando, empezarRevision] = useTransition();
  const [guardando, empezarGuardado] = useTransition();

  const set = (k: keyof Campos) => (e: React.ChangeEvent<HTMLInputElement>) => { setPrevia(null); setCampos({ ...campos, [k]: e.target.value }); };

  async function elegirCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPrevia(null); setError(""); setAviso(""); setLectura(null); setCsv(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setError("El primer archivo tiene que ser el CSV de pedidos (orderDetails.csv)."); return; }
    if (f.size > MAX_BYTES) { setError("El CSV es demasiado grande (máximo 2 MB)."); return; }
    const l = leerCsvPedidos(await f.text());
    setCsv(f); setLectura(l);
    if (l.pedidos.length > 0) { const s = semanaDe(l); setCampos((c) => ({ ...c, desde: s.desde, hasta: s.hasta })); }
  }

  async function elegirExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPrevia(null); setError(""); setAviso(""); setExcel(null); setErrorExcel(""); setExcelArchivo(null);
    if (!f) return;
    if (f.size > MAX_BYTES) { setErrorExcel("El Excel es demasiado grande (máximo 2 MB)."); return; }
    try {
      const x = leerExcelEstadoCuenta(await hojasDeExcel(f));
      if (x.pedidos.length === 0) setErrorExcel(x.errores[0] ?? "No se encontraron pedidos en el Excel.");
      else { setExcel(x); setExcelArchivo(f); if (x.errores.length > 0) setErrorExcel(x.errores.slice(0, 3).join(" ")); }
    } catch {
      setErrorExcel("No se pudo abrir el Excel. Verificá que sea el archivo de «Estado de Cuenta» tal como lo bajó el portal.");
    }
  }

  function elegirPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError("");
    if (f && f.size > MAX_BYTES) { setError("El PDF es demasiado grande (máximo 2 MB)."); e.target.value = ""; setPdf(null); return; }
    setPdf(f);
  }

  // Convierte lo tipeado en el estado de cuenta. Los importes se copian del PDF TAL COMO ESTÁN (los descuentos con signo menos).
  function armarEstado(): { estado: EstadoCuentaPeya | null; error?: string } {
    if (!campos.tengoEstado) return { estado: null };
    const imp = (txt: string): number | null => parsearMontoAR(txt);
    const v = { total: imp(campos.total), pub: imp(campos.publicidad), iva: imp(campos.iva), sirtac: imp(campos.sirtac), rei: imp(campos.reintegros), aju: imp(campos.ajustes), sal: imp(campos.saldoAnterior) };
    if (campos.total.trim() === "" || v.total === null) return { estado: null, error: "Cargá el «Total liquidado» del estado de cuenta (por ejemplo 37.243,04)." };
    if (campos.iva.trim() === "" || v.iva === null) return { estado: null, error: "Cargá el «Impuesto en comisiones - IVA» del estado de cuenta (con signo menos, por ejemplo -8.814,61)." };
    if (v.pub === null || v.sirtac === null || v.rei === null || v.aju === null || v.sal === null) return { estado: null, error: "Hay un importe mal escrito. Usá el formato del PDF: 1.234,56 (con punto de miles y coma decimal)." };
    return {
      estado: {
        periodo_desde: campos.desde, periodo_hasta: campos.hasta, total_liquidado: v.total, publicidad: v.pub, iva_comisiones: v.iva, retenciones_sirtac: v.sirtac,
        reintegros: v.rei, ajustes: v.aju, saldo_anterior: v.sal, fecha_pago_procesado: campos.fechaPago || null, cuenta_destino: campos.cuenta.trim() || null, ajustes_nota: campos.nota.trim() || null,
      },
    };
  }

  function entradaServidor() {
    const pedidos = excel ? completarConExcel(lectura?.pedidos ?? [], excel) : (lectura?.pedidos ?? []);
    const { estado, error: e } = armarEstado();
    return { pedidos, excel: excel ? resumirExcel(excel) : null, estado, periodo: { desde: campos.desde, hasta: campos.hasta }, errorEstado: e };
  }

  function revisar() {
    setError(""); setAviso(""); setPrevia(null);
    const ent = entradaServidor();
    if (ent.errorEstado) { setError(ent.errorEstado); return; }
    if (!campos.desde || !campos.hasta) { setError("Indicá el período de la liquidación."); return; }
    empezarRevision(async () => {
      const r = await previsualizarPeya({ pedidos: ent.pedidos, excel: ent.excel, estado: ent.estado, periodo: ent.periodo });
      if (r.error) { setError(r.error); return; }
      setPrevia(r);
    });
  }

  async function subir(archivo: File, tipo: "csv" | "excel" | "pdf"): Promise<{ tipo: string; nombre: string; path: string; bytes: number }> {
    const firma = await crearUrlSubidaPeya(tipo);
    if ("error" in firma) throw new Error(firma.error);
    const { error: err } = await createBrowserClient().storage.from("peya").uploadToSignedUrl(firma.path, firma.token, archivo, { contentType: firma.mime });
    if (err) throw new Error(`No se pudo guardar el archivo original (${archivo.name}): ${err.message}`);
    return { tipo, nombre: archivo.name, path: firma.path, bytes: archivo.size };
  }

  function guardar() {
    if (!csv || !lectura) return;
    setError(""); setAviso("");
    const ent = entradaServidor();
    if (ent.errorEstado) { setError(ent.errorEstado); return; }
    empezarGuardado(async () => {
      try {
        // Los originales se guardan para poder auditar qué se subió, quién y cuándo.
        const archivos = [await subir(csv, "csv")];
        if (excelArchivo) archivos.push(await subir(excelArchivo, "excel"));
        if (pdf) archivos.push(await subir(pdf, "pdf"));
        const r = await guardarLiquidacionPeya({ pedidos: ent.pedidos, excel: ent.excel, estado: ent.estado, periodo: ent.periodo, archivos });
        if (r.error && !r.id) { setError(r.error); return; }
        setAviso(r.estado === "confirmado" ? "Listo: la liquidación quedó confirmada y la cuenta cerró a $0,00." : "Listo: la liquidación quedó guardada como estimada.");
        if (r.error) setError(r.error);
        setCsv(null); setExcelArchivo(null); setPdf(null); setLectura(null); setExcel(null); setPrevia(null); setCampos(CAMPOS_INICIALES);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar.");
      }
    });
  }

  // Cierre que se ve ANTES de revisar con el servidor: solo para dar feedback inmediato al tipear. Lo que manda es el del servidor.
  const cierreLocal = lectura && lectura.pedidos.length > 0 && !previa
    ? (() => { const { estado } = armarEstado(); try { return cerrarLiquidacion(excel ? completarConExcel(lectura.pedidos, excel) : lectura.pedidos, excel, estado); } catch { return null; } })()
    : null;
  const cierre = previa?.cierre ?? null;
  const pedidosPorNro = new Map((lectura?.pedidos ?? []).map((p) => [p.nro_pedido, p]));
  const cruce = previa?.cruce ?? [];
  const cuenta = (e: string) => cruce.filter((c) => c.estado === e).length;
  const puedeGuardar = !!previa && !!cierre && !cierre.hayErrores && (campos.tengoEstado ? cierre.cierra : true);

  if (!puedeCargar) {
    return <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Solo el administrativo de Tesorería puede importar liquidaciones.</p>;
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Importar la liquidación semanal de PedidosYa</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Una vez por semana, del Portal de PedidosYa: <b>Pedidos → «Descargar informe» (CSV)</b> y <b>Finanzas → semana → «Ver detalle» → Descargar → Estado de Cuenta</b>
          (baja un .zip con un Excel y un PDF). Los archivos se abren en tu navegador; no se automatiza el ingreso al portal.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className={etiqueta}>1. CSV de pedidos</label>
          <input type="file" accept=".csv" onChange={elegirCsv} disabled={revisando || guardando} className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-tierra-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
        </div>
        <div>
          <label className={etiqueta}>2. Excel del estado de cuenta</label>
          <input type="file" accept=".xls,.xlsx" onChange={elegirExcel} disabled={revisando || guardando} className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-tierra-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
        </div>
        <div>
          <label className={etiqueta}>3. PDF del estado de cuenta</label>
          <input type="file" accept=".pdf" onChange={elegirPdf} disabled={revisando || guardando} className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-200 file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-700" />
          <p className="text-xs text-neutral-400 mt-1">Se guarda como respaldo; los importes se copian abajo.</p>
        </div>
      </div>

      {lectura && lectura.errores.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {lectura.errores.slice(0, 5).map((m) => <p key={m}>{m}</p>)}
        </div>
      )}
      {lectura && lectura.advertencias.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{lectura.advertencias.slice(0, 5).map((m) => <p key={m}>{m}</p>)}</div>
      )}
      {errorExcel && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{errorExcel}</p>}

      {lectura && lectura.pedidos.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm space-y-4">
          <p className="text-neutral-700">
            <b>{lectura.pedidos.length}</b> pedidos en el CSV ({lectura.pedidos.filter((p) => p.estado === "entregado").length} entregados,
            {" "}{lectura.pedidos.filter((p) => p.estado === "cancelado").length} cancelados){excel ? <> · <b>{excel.pedidos.length}</b> en el Excel</> : <> · falta el Excel (sin él no se puede verificar contra PedidosYa)</>}
          </p>

          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={etiqueta}>Período desde</label><input type="date" value={campos.desde} onChange={set("desde")} className={campo} /></div>
              <div><label className={etiqueta}>Período hasta</label><input type="date" value={campos.hasta} onChange={set("hasta")} className={campo} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={campos.tengoEstado} onChange={(e) => { setPrevia(null); setCampos({ ...campos, tengoEstado: e.target.checked }); }} />
              Tengo el estado de cuenta (PDF o portal) de esta semana
            </label>
            {campos.tengoEstado ? (
              <div className="space-y-3">
                <p className="text-xs text-neutral-500">
                  Copiá los importes del PDF <b>tal como figuran</b>, los descuentos con signo menos (por ejemplo <code>-11.121,55</code>). Si alguno no existe esa semana, dejá 0.
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div><label className={etiqueta}>Total liquidado</label><input value={campos.total} onChange={set("total")} inputMode="decimal" placeholder="37.243,04" className={campo} /></div>
                  <div><label className={etiqueta}>Publicidad en la aplicación</label><input value={campos.publicidad} onChange={set("publicidad")} inputMode="decimal" placeholder="-11.121,55" className={campo} /></div>
                  <div><label className={etiqueta}>Impuesto en comisiones - IVA</label><input value={campos.iva} onChange={set("iva")} inputMode="decimal" placeholder="-8.814,61" className={campo} /></div>
                  <div><label className={etiqueta}>Retenciones fiscales (SIRTAC)</label><input value={campos.sirtac} onChange={set("sirtac")} inputMode="decimal" placeholder="-3.668,00" className={campo} /></div>
                  <div><label className={etiqueta}>Reintegros</label><input value={campos.reintegros} onChange={set("reintegros")} inputMode="decimal" className={campo} /></div>
                  <div><label className={etiqueta}>Ajustes de liquidación</label><input value={campos.ajustes} onChange={set("ajustes")} inputMode="decimal" className={campo} /></div>
                  <div><label className={etiqueta}>Saldo pendiente liquidación anterior</label><input value={campos.saldoAnterior} onChange={set("saldoAnterior")} inputMode="decimal" className={campo} /></div>
                  <div><label className={etiqueta}>Fecha de pago («procesaremos el pago el…»)</label><input type="date" value={campos.fechaPago} onChange={set("fechaPago")} className={campo} /></div>
                  <div><label className={etiqueta}>Cuenta destino (opcional)</label><input value={campos.cuenta} onChange={set("cuenta")} maxLength={60} placeholder="PSP PEYA terminada en 8313" className={campo} /></div>
                </div>
                <div><label className={etiqueta}>Nota sobre reintegros o ajustes (opcional)</label><input value={campos.nota} onChange={set("nota")} maxLength={200} className={campo} /></div>
              </div>
            ) : (
              <p className="text-xs text-neutral-500">
                Se guarda como <b>estimada</b>: el monto sale de los pedidos (falta lo que descuentan la publicidad y las retenciones) y la fecha de cobro se estima con el
                plazo de la última liquidación. Cuando tengas el estado de cuenta, volvé a importar la misma semana y se confirma.
              </p>
            )}
          </div>

          {cierreLocal && !previa && cierreLocal.diferencia !== null && (
            <p className={`text-xs ${cierreLocal.diferencia === 0 ? "text-selva-700" : "text-neutral-500"}`}>
              {cierreLocal.diferencia === 0 ? "Con estos importes la cuenta cierra." : `Con estos importes la diferencia es ${pesos(cierreLocal.diferencia)}.`} Tocá «Revisar» para verificarlo todo.
            </p>
          )}

          <button type="button" onClick={revisar} disabled={revisando || guardando || lectura.pedidos.length === 0}
            className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
            {revisando ? "Revisando…" : "Revisar"}
          </button>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {aviso && <p role="status" className="rounded-lg border border-selva-200 bg-selva-50 px-3 py-2 text-sm text-selva-700">{aviso}</p>}

      {previa && cierre && (
        <div className="rounded-lg border border-neutral-200 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Vista previa — {previa.tienda?.local} · {campos.desde.split("-").reverse().join("/")} al {campos.hasta.split("-").reverse().join("/")}</h3>
            {previa.advertencias?.map((a) => <p key={a} className="text-xs text-amber-800 mt-1">{a}</p>)}
          </div>

          <ul className="space-y-1.5">
            {cierre.verificaciones.map((v) => (
              <Fila key={v.id} ok={v.ok} texto={`${v.etiqueta}${v.esperado !== null && v.obtenido !== null ? `: ${pesos(v.obtenido)}${v.ok ? "" : ` (esperado ${pesos(v.esperado)})`}` : ""}`} detalle={v.detalle} />
            ))}
            {cierre.neto_calculado !== null && (
              <li className="text-sm text-neutral-700 pt-1 border-t border-neutral-100">
                Neto a la billetera: <b>{pesos(cierre.neto_calculado)}</b>
                {cierre.diferencia !== null && cierre.diferencia !== 0 && <span className="text-danger"> — diferencia con el Total liquidado: {pesos(cierre.diferencia)}</span>}
              </li>
            )}
            {cierre.neto_calculado === null && <li className="text-sm text-neutral-700 pt-1 border-t border-neutral-100">Ingreso estimado de los pedidos: <b>{pesos(cierre.ingreso_estimado)}</b> (sin publicidad ni retenciones)</li>}
          </ul>

          <div className="grid sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-lg bg-selva-50 border border-selva-200 p-2"><b className="block text-base text-selva-700">{cuenta("conciliado")}</b>cruzados con una venta</div>
            <div className={`rounded-lg border p-2 ${cuenta("sin_venta") > 0 ? "bg-amber-50 border-amber-200" : "bg-neutral-50 border-neutral-200"}`}><b className="block text-base">{cuenta("sin_venta")}</b>en PedidosYa sin venta en el sistema</div>
            <div className={`rounded-lg border p-2 ${cuenta("importe_distinto") > 0 ? "bg-amber-50 border-amber-200" : "bg-neutral-50 border-neutral-200"}`}><b className="block text-base">{cuenta("importe_distinto")}</b>con importe distinto</div>
            <div className={`rounded-lg border p-2 ${(previa.ventasSinPeya?.length ?? 0) > 0 ? "bg-amber-50 border-amber-200" : "bg-neutral-50 border-neutral-200"}`}><b className="block text-base">{previa.ventasSinPeya?.length ?? 0}</b>ventas del kiosco sin pedido en PedidosYa</div>
          </div>
          {cuenta("efectivo_pendiente") > 0 && (
            <p className="text-xs text-amber-800">{cuenta("efectivo_pendiente")} pedido(s) en efectivo: quedan «pendiente de validar» (todavía no hay una regla contable confirmada para el efectivo).</p>
          )}
          {cruce.filter((c) => c.estado === "sin_venta" || c.estado === "importe_distinto").map((c) => {
            const p = pedidosPorNro.get(c.nro_pedido);
            return (
              <p key={c.nro_pedido} className="text-xs text-neutral-600">
                <b>Pedido {c.nro_pedido}</b> ({p?.fecha_pedido ? p.fecha_pedido.slice(0, 16).replace("T", " ") : ""}, {p ? pesos(p.total_parcial) : ""}{p?.articulos ? ` · ${p.articulos}` : ""}):{" "}
                {c.estado === "sin_venta" ? "no hay una venta del kiosco con ese importe ese día" : `la venta más cercana tiene otro importe (${c.diferencia !== null ? pesos(c.diferencia) : ""} de diferencia)`}
              </p>
            );
          })}

          {previa.plazo && (
            <div className="text-sm text-neutral-700">
              {previa.plazo.confirmado ? (
                <p>Cobro: PedidosYa procesa el pago el <b>{previa.plazo.fecha_pago_procesado?.split("-").reverse().join("/")}</b> ({previa.plazo.plazo_dias} días después de cerrar el período); la acreditación puede demorar hasta 72 hs hábiles
                  {previa.plazo.fecha_acreditacion_hasta ? ` (hasta el ${previa.plazo.fecha_acreditacion_hasta.split("-").reverse().join("/")})` : ""}.</p>
              ) : previa.plazo.fecha_pago_estimada ? (
                <p>Cobro <b>estimado</b> para el <b>{previa.plazo.fecha_pago_estimada.split("-").reverse().join("/")}</b>, con el mismo plazo que la última liquidación ({previa.plazo.plazo_dias} días). Todavía no lo confirmó PedidosYa.</p>
              ) : (
                <p>No hay una liquidación anterior para estimar la fecha de cobro: cargá el estado de cuenta para tenerla confirmada.</p>
              )}
              {previa.plazo.alerta && <p className="text-amber-800 font-medium mt-1">{previa.plazo.alerta}</p>}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={guardar} disabled={!puedeGuardar || guardando}
              className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
              {guardando ? "Guardando…" : campos.tengoEstado ? "Confirmar y guardar" : "Guardar como estimada"}
            </button>
            {!puedeGuardar && campos.tengoEstado && (
              <p className="text-xs text-danger">
                La cuenta no cierra{cierre.diferencia !== null && cierre.diferencia !== 0 ? ` (diferencia ${pesos(cierre.diferencia)})` : ""}: no se puede confirmar. Revisá los importes del estado de cuenta o los archivos.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
