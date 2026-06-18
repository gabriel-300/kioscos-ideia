"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { MovimientoForm } from "@/app/(admin)/admin/movimientos/_components/movimiento-form";
import { VentaRapidaForm } from "./venta-rapida-form";
import type { Database } from "@/types/database";

type Product = Database["public"]["Tables"]["products"]["Row"];
type TipoMov = "entrega" | "devolucion" | "ajuste" | "venta";

export function NuevaEntregaButton({
  sucursalId,
  sucursalNombre,
  products,
  defaultTipo = "entrega",
  label,
  variant = "primary",
  stockMap,
  categories,
}: {
  sucursalId:     string;
  sucursalNombre: string;
  products:       Product[];
  defaultTipo?:   TipoMov;
  label?:         string;
  variant?:       "primary" | "ghost";
  stockMap?:      Record<string, number>;
  categories?:    { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  const btnLabel = label ?? (defaultTipo === "venta" ? "Registrar venta" : "Nueva entrega");

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        {btnLabel}
      </Button>

      {defaultTipo === "venta" ? (
        <VentaRapidaForm
          open={open}
          onClose={() => setOpen(false)}
          sucursalId={sucursalId}
          sucursalNombre={sucursalNombre}
          products={products}
          stockMap={stockMap}
          categories={categories}
        />
      ) : (
        <MovimientoForm
          open={open}
          sucursales={[{ id: sucursalId, nombre: sucursalNombre } as Database["public"]["Tables"]["sucursales"]["Row"]]}
          products={products}
          defaultSucursalId={sucursalId}
          defaultTipo={defaultTipo}
          formTitle={btnLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
