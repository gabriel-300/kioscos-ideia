"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leerReporteCobros, type Celda, type LecturaReporte } from "@/lib/tesoreria/mp-cobros";
import { importarCobrosMp } from "../mp-actions";

// Sube el reporte de cobros de Mercado Pago. El archivo se abre ACÁ, en el navegador: al servidor viajan solo las columnas que
// se guardan (importes, fechas, nº de operación…), nunca los nombres, mails ni documentos de los clientes.

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const MAX_BYTES = 8 * 1024 * 1024;

type CeldaExcel = unknown;
function aCelda(v: CeldaExcel): Celda {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown };
    if (o.result !== undefined) return aCelda(o.result);       // fórmula
    if (typeof o.text === "string") return o.text;             // hipervínculo
    if (Array.isArray((v as { richText?: unknown[] }).richText)) {
      return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    }
  }
  return String(v);
}

async function leerArchivo(archivo: File): Promise<Celda[][]> {
  // @ts-expect-error -- exceljs no publica tipos para este subpath (el paquete ya usa el bundle de navegador por su campo "browser")
  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default as typeof import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  const hoja = wb.worksheets[0];
  if (!hoja) return [];
  const grilla: Celda[][] = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    const valores = (fila.values as CeldaExcel[]).slice(1);
    grilla.push(valores.map(aCelda));
  });
  return grilla;
}

export function ImportarMp({ puedeCargar }: { puedeCargar: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [nombre, setNombre] = useState("");
  const [lectura, setLectura] = useState<LecturaReporte | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [pendiente, empezar] = useTransition();

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    setLectura(null); setError(""); setAviso(""); setNombre("");
    if (!archivo) return;
    if (!/\.xlsx$/i.test(archivo.name)) { setError("El archivo tiene que ser un Excel (.xlsx) del reporte de cobros de Mercado Pago."); return; }
    if (archivo.size > MAX_BYTES) { setError("El archivo es demasiado grande. Bajalo por períodos más cortos."); return; }
    setLeyendo(true);
    try {
      const grilla = await leerArchivo(archivo);
      const l = leerReporteCobros(grilla);
      setNombre(archivo.name);
      if (l.filas.length === 0) setError(l.errores[0] ?? "No se encontraron cobros en el archivo.");
      setLectura(l);
    } catch {
      setError("No se pudo leer el archivo. Verificá que sea el Excel original que bajaste de Mercado Pago.");
    } finally {
      setLeyendo(false);
    }
  }

  function importar() {
    if (!lectura || lectura.filas.length === 0) return;
    setError(""); setAviso("");
    empezar(async () => {
      const r = await importarCobrosMp(lectura.filas, nombre);
      if (r.error && r.nuevas === undefined) { setError(r.error); return; }
      setAviso(
        `Listo: ${r.nuevas} cobros nuevos y ${r.actualizadas} que ya estaban cargados.` +
        (r.sinLocal ? ` ${r.sinLocal} no se pudieron atar a un local y quedan para clasificar.` : "") +
        (r.error ? ` ${r.error}` : ""),
      );
      setLectura(null); setNombre("");
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  const bruto = lectura?.filas.reduce((s, f) => s + (f.estado === "approved" ? f.monto_bruto : 0), 0) ?? 0;
  const tarifa = lectura?.filas.reduce((s, f) => s + (f.estado === "approved" ? f.tarifa : 0), 0) ?? 0;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Importar cobros de Mercado Pago</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          En Mercado Pago: <b>Reportes → Cobros</b> (el Excel «collection-…»). Podés subir el mismo período más de una vez: lo ya
          cargado no se duplica. El archivo se abre en tu navegador y no se envían los datos de los clientes.
        </p>
      </div>

      {puedeCargar ? (
        <input ref={input} type="file" accept=".xlsx" onChange={elegir} disabled={leyendo || pendiente}
          className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-tierra-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-tierra-800" />
      ) : (
        <p className="text-xs text-neutral-500">Solo el administrativo de Tesorería puede importar.</p>
      )}

      {leyendo && <p className="text-sm text-neutral-500">Leyendo el archivo…</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {aviso && <p role="status" className="rounded-lg border border-selva-200 bg-selva-50 px-3 py-2 text-sm text-selva-700">{aviso}</p>}

      {lectura && lectura.filas.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-900">{nombre}</p>
          <ul className="text-neutral-600 space-y-0.5">
            <li><b>{lectura.filas.length}</b> cobros del {lectura.desde} al {lectura.hasta}</li>
            <li>Cobrado: <b>{AR.format(bruto)}</b> · Comisión de Mercado Pago: <b>{AR.format(tarifa)}</b></li>
            {lectura.ignoradas > 0 && <li>{lectura.ignoradas} rechazados o sin plata (no se importan)</li>}
          </ul>
          {lectura.errores.length > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="font-semibold">Filas que no se pudieron leer ({lectura.errores.length}):</p>
              {lectura.errores.slice(0, 5).map((m) => <p key={m}>{m}</p>)}
            </div>
          )}
          <button type="button" onClick={importar} disabled={pendiente}
            className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
            {pendiente ? "Importando…" : `Importar ${lectura.filas.length} cobros`}
          </button>
        </div>
      )}
    </div>
  );
}
