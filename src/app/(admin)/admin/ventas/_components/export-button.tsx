"use client";

import { fechaHoyAR } from "@/lib/fecha";

type VentaExport = {
  producto:  string;
  unidad:    string;
  cantidad:  number;
  facturado: number;
  costo:     number | null;
  margen:    number | null;
};

function toCSV(rows: VentaExport[]): string {
  const headers = ["Producto", "Unidad", "Cantidad", "Facturado", "Costo", "Margen"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((r) => [
      escape(r.producto),
      escape(r.unidad),
      r.cantidad,
      r.facturado,
      r.costo ?? "",
      r.margen ?? "",
    ].join(",")),
  ];
  return lines.join("\n");
}

export function VentasExportButton({ filas }: { filas: VentaExport[] }) {
  function handleExport() {
    const csv = "﻿" + toCSV(filas); // BOM para Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `ventas-${fechaHoyAR()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
    >
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      Exportar CSV
    </button>
  );
}
