"use client";

import { useState } from "react";
import { AperturaCajaModal } from "./apertura-caja-modal";

type AperturaExistente = {
  fondo_inicial: number;
  notas:         string | null;
};

interface Props {
  sucursalId:     string;
  sucursalNombre: string;
  aperturaHoy:    AperturaExistente | null;
}

export function AperturaCajaButton({ sucursalId, sucursalNombre, aperturaHoy }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 h-9 px-4 rounded-lg border text-sm font-medium transition-colors ${
          aperturaHoy
            ? "border-selva-300 bg-selva-50 text-selva-700 hover:bg-selva-100"
            : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
        }`}
      >
        <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        {aperturaHoy ? "Caja abierta ✓" : "Abrir caja"}
      </button>

      <AperturaCajaModal
        open={open}
        onClose={() => setOpen(false)}
        sucursalId={sucursalId}
        sucursalNombre={sucursalNombre}
        aperturaHoy={aperturaHoy}
      />
    </>
  );
}
