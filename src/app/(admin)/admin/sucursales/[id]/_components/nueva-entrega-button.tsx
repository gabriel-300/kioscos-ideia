"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { MovimientoForm } from "@/app/(admin)/admin/movimientos/_components/movimiento-form";
import { VentaRapidaForm } from "./venta-rapida-form";
import type { Database } from "@/types/database";

type Product = Database["public"]["Tables"]["products"]["Row"];
type TipoMov = "entrega" | "devolucion" | "ajuste" | "venta";
type Promo = { id: string; name: string; price: number; promo_items: { product_id: string; cantidad: number }[] };

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
  autoOpen,
  preselectProductId,
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
  proveedores?:   { id: string; nombre: string }[];
  promos?:        Promo[];
  autoOpen?:            boolean;
  preselectProductId?:  string;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  const router   = useRouter();
  const pathname = usePathname();

  const btnLabel = label ?? (defaultTipo === "venta" ? "Registrar venta" : "Nueva entrega");

  function handleClose() {
    setOpen(false);
    // Si se abrió sola vía deep-link (?ajuste=...), limpiar la URL al cerrar
    // para que un refresh no la vuelva a abrir.
    if (autoOpen) router.replace(pathname);
  }

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
          onClose={handleClose}
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
          preselectProductId={preselectProductId}
          stockMap={stockMap}
          onClose={handleClose}
        />
      )}
    </>
  );
}
