"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { CierreCajaModal } from "./cierre-caja-modal";

export type MovimientoCierre = {
  fecha:              string;
  created_at:         string;
  tipo:               string;
  pago_efectivo:      number | null;
  pago_billetera:     number | null;
  pago_tarjeta:       number | null;
  pago_transferencia: number | null;
  movimiento_items: { subtotal: number | null }[];
};

export type UltimoCierre = {
  fecha:                   string;
  fondo_inicial:           number;
  total_ventas:            number;
  efectivo_declarado:      number;
  billetera_declarada:     number;
  tarjeta_declarada:       number | null;
  transferencia_declarada: number | null;
  diferencia:              number | null;
  notas:                   string | null;
  created_at:              string;
} | null;

export function CierreCajaButton({
  sucursalId,
  sucursalNombre,
  movimientos,
  cajaAbierta,
  ultimoCierre,
  aperturaActual,
  retiros,
  role,
}: {
  sucursalId:     string;
  sucursalNombre: string;
  movimientos:    MovimientoCierre[];
  cajaAbierta:    boolean;
  ultimoCierre:   UltimoCierre;
  aperturaActual?: { fondo_inicial: number; created_at: string } | null;
  retiros?:        { monto: number; created_at: string }[];
  role?:           string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-medium border transition-colors ${
          !cajaAbierta
            ? "border-selva-300 bg-selva-50 text-selva-700 hover:bg-selva-100"
            : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:border-neutral-400"
        }`}
      >
        {!cajaAbierta ? (
          <>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Caja cerrada
          </>
        ) : (
          <>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Cerrar caja
          </>
        )}
      </button>

      <CierreCajaModal
        open={open}
        onClose={() => setOpen(false)}
        sucursalId={sucursalId}
        sucursalNombre={sucursalNombre}
        movimientos={movimientos}
        cajaAbierta={cajaAbierta}
        ultimoCierre={ultimoCierre}
        aperturaActual={aperturaActual}
        retiros={retiros}
        role={role}
      />
    </>
  );
}
