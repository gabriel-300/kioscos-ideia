"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { MovimientoForm } from "@/app/(admin)/admin/movimientos/_components/movimiento-form";
import { VentaRapidaForm } from "./venta-rapida-form";
import type { Database } from "@/types/database";

type Product = Database["public"]["Tables"]["products"]["Row"];
type TipoMov = "entrega" | "devolucion" | "ajuste" | "venta" | "merma";
type Promo = { id: string; name: string; price: number; tipo: "promo" | "receta"; cover_image_url: string | null; promo_items: { product_id: string; cantidad: number }[] };

export function NuevaEntregaButton({
  sucursalId,
  sucursalNombre,
  products,
  defaultTipo = "entrega",
  label,
  variant = "primary",
  stockMap,
  categories,
  personal,
  cajaAbierta,
  proveedores = [],
  promos,
}: {
  sucursalId:     string;
  sucursalNombre: string;
  products:       Product[];
  defaultTipo?:   TipoMov;
  label?:         string;
  variant?:       "primary" | "ghost";
  stockMap?:      Record<string, number>;
  categories?:    { id: string; name: string }[];
  personal?:      { id: string; nombre: string }[];
  cajaAbierta?:   boolean;
  proveedores?:   { id: string; nombre: string; modo_facturacion?: "costo" | "precio_sugerido"; porcentaje_descuento?: number | null }[];
  promos?:        Promo[];
}) {
  const [open, setOpen] = useState(false);

  const btnLabel = label ?? (defaultTipo === "venta" ? "Registrar venta" : defaultTipo === "merma" ? "Merma" : "Nueva entrega");

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
          personal={personal}
          cajaAbierta={cajaAbierta}
          promos={promos}
        />
      ) : (
        <MovimientoForm
          open={open}
          sucursales={[{ id: sucursalId, nombre: sucursalNombre } as Database["public"]["Tables"]["sucursales"]["Row"]]}
          products={products}
          proveedores={proveedores}
          defaultSucursalId={sucursalId}
          defaultTipo={defaultTipo}
          formTitle={btnLabel}
          stockMap={stockMap}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
