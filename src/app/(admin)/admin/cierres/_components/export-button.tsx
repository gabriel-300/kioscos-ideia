"use client";

import { fechaHoyAR } from "@/lib/fecha";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type CierreExport = {
  fecha: string;
  numero_liquidacion: number | null;
  sucursal: string;
  fondo_inicial: number | null;
  ventas: number;
  efectivo: number;
  billetera: number;
  tarjeta: number;
  transferencia: number;
  diferencia: number | null;
  retiros: number;
  fondo_siguiente: number | null;
  monto_sobre: number | null;
  notas: string;
  encargado: string;
};

function toCSV(rows: CierreExport[]): string {
  const headers = ["Fecha", "N° Liquidación", "Sucursal", "Fondo inicial", "Ventas sistema", "Efectivo", "Billetera", "Tarjeta", "Transferencia", "Diferencia", "Retiros del turno", "Fondo siguiente", "Monto en sobre", "Notas", "Encargado"];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((r) => [
      escape(r.fecha),
      r.numero_liquidacion ?? "",
      escape(r.sucursal),
      r.fondo_inicial ?? "",
      r.ventas,
      r.efectivo,
      r.billetera,
      r.tarjeta,
      r.transferencia,
      r.diferencia ?? "",
      r.retiros,
      r.fondo_siguiente ?? "",
      r.monto_sobre ?? "",
      escape(r.notas),
      escape(r.encargado),
    ].join(",")),
  ];
  return lines.join("\n");
}

export function CierresExportButton({ cierres }: { cierres: CierreExport[] }) {
  function handleExport() {
    const csv = "﻿" + toCSV(cierres); // BOM para Excel
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `cierres-${fechaHoyAR()}.csv`;
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
