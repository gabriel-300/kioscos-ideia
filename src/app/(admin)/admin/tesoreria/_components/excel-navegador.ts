// Abre un Excel EN EL NAVEGADOR y devuelve sus hojas como grillas de celdas. El archivo nunca viaja entero al servidor.
// Se detecta por contenido, no por extensión: el estado de cuenta de PedidosYa se llama «.xls» pero es un .xlsx por dentro.
// Se usa el bundle de navegador de exceljs (el índice del paquete arrastra código de Node que no corre en el Worker).

import type { Celda, HojaExcel } from "@/lib/tesoreria/peya";

type CeldaExcel = unknown;

function aCelda(v: CeldaExcel): Celda {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return aCelda(o.result);                       // fórmula
    if (typeof o.text === "string") return o.text;                             // hipervínculo
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
  }
  return String(v);
}

export async function hojasDeExcel(archivo: File): Promise<HojaExcel[]> {
  // @ts-expect-error -- exceljs no publica tipos para este subpath
  const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default as typeof import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  const hojas: HojaExcel[] = [];
  wb.eachSheet((ws) => {
    const filas: Celda[][] = [];
    ws.eachRow({ includeEmpty: false }, (fila) => filas.push((fila.values as CeldaExcel[]).slice(1).map(aCelda)));
    hojas.push({ nombre: ws.name, filas });
  });
  return hojas;
}
