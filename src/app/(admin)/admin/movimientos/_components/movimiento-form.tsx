"use client";

import { useState, useTransition } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { crearMovimiento, type ItemInput } from "../actions";
import type { Database } from "@/types/database";

type Sucursal = Database["public"]["Tables"]["sucursales"]["Row"];
type Product  = Database["public"]["Tables"]["products"]["Row"];

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const TIPO_OPTIONS = [
  { value: "entrega",    label: "Entrega" },
  { value: "devolucion", label: "Devolución" },
  { value: "venta",      label: "Venta (salida kiosco)" },
  { value: "ajuste",     label: "Ajuste" },
];

interface LineItem {
  product_id:      string;
  cantidad:        string;
  precio_unitario: string;
}

const emptyLine = (): LineItem => ({ product_id: "", cantidad: "", precio_unitario: "" });

type TipoMov = "entrega" | "devolucion" | "ajuste" | "venta";

interface Props {
  open:               boolean;
  sucursales:         Sucursal[];
  products:           Product[];
  onClose:            () => void;
  defaultSucursalId?: string;
  defaultTipo?:       TipoMov;
  formTitle?:         string;
}

export function MovimientoForm({ open, sucursales, products, onClose, defaultSucursalId, defaultTipo, formTitle }: Props) {
  const [pending, startTransition] = useTransition();
  const [sucursalId, setSucursalId] = useState(defaultSucursalId ?? "");
  const [fecha,      setFecha]      = useState(new Date().toISOString().slice(0, 10));
  const [tipo,       setTipo]       = useState<TipoMov>(defaultTipo ?? "entrega");
  const [notas,      setNotas]      = useState("");
  const [items,      setItems]      = useState<LineItem[]>([emptyLine()]);
  const [error,      setError]      = useState<string | null>(null);

  function resetForm() {
    setSucursalId(defaultSucursalId ?? "");
    setFecha(new Date().toISOString().slice(0, 10));
    setTipo(defaultTipo ?? "entrega");
    setNotas("");
    setItems([emptyLine()]);
    setError(null);
  }

  function handleClose() { resetForm(); onClose(); }

  function addLine()           { setItems((p) => [...p, emptyLine()]); }
  function removeLine(i: number) { setItems((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, field: keyof LineItem, value: string) {
    setItems((p) => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  function autoPrecio(i: number, productId: string) {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    const precio = tipo === "entrega" ? (prod.precio_dist ?? null) : null;
    setItems((p) => p.map((item, idx) =>
      idx === i ? { ...item, product_id: productId, precio_unitario: precio != null ? String(precio) : "" } : item
    ));
  }

  const total = items.reduce((sum, item) => {
    const q = parseFloat(item.cantidad)        || 0;
    const p = parseFloat(item.precio_unitario) || 0;
    return sum + q * p;
  }, 0);

  function handleSubmit() {
    setError(null);
    if (!sucursalId) { setError("Seleccioná una sucursal"); return; }
    const validItems = items.filter((i) => i.product_id && parseFloat(i.cantidad) > 0);
    if (validItems.length === 0) { setError("Agregá al menos un producto con cantidad"); return; }

    const parsed: ItemInput[] = validItems.map((i) => ({
      product_id:      i.product_id,
      cantidad:        parseFloat(i.cantidad),
      precio_unitario: i.precio_unitario ? parseFloat(i.precio_unitario) : null,
    }));

    startTransition(async () => {
      try {
        await crearMovimiento({ sucursal_id: sucursalId, fecha, tipo, notas: notas || null, items: parsed });
        resetForm();
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  if (!open) return null;

  const TIPO_TITULO: Record<TipoMov, string> = {
    entrega:    "Nueva entrega",
    devolucion: "Registrar devolución",
    venta:      "Registrar venta",
    ajuste:     "Ajuste de stock",
  };
  const TIPO_BTN: Record<TipoMov, string> = {
    entrega:    "Registrar entrega",
    devolucion: "Registrar devolución",
    venta:      "Registrar venta",
    ajuste:     "Guardar ajuste",
  };
  const TIPO_PLACEHOLDER: Record<TipoMov, string> = {
    entrega:    "Observaciones sobre la entrega…",
    devolucion: "Motivo de la devolución…",
    venta:      "Observaciones sobre las ventas…",
    ajuste:     "Motivo del ajuste…",
  };

  const sucursalOptions = [
    { value: "", label: "Seleccioná una sucursal…" },
    ...sucursales.map((s) => ({ value: s.id, label: s.nombre })),
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">{formTitle ?? TIPO_TITULO[tipo]}</h2>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Encabezado */}
          <div className="grid grid-cols-2 gap-3">
            {!defaultSucursalId && (
              <div className="col-span-2">
                <Select
                  label="Sucursal *"
                  options={sucursalOptions}
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Fecha *</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3.5 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
              />
            </div>
            {defaultTipo ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Tipo</p>
                <p className="h-11 flex items-center text-sm font-medium text-neutral-700">{TIPO_TITULO[tipo]}</p>
              </div>
            ) : (
              <Select
                label="Tipo"
                options={TIPO_OPTIONS}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as typeof tipo)}
              />
            )}
          </div>

          {/* Líneas de productos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Productos</p>
              <button onClick={addLine} className="text-xs text-tierra-700 hover:underline font-medium">
                + Agregar línea
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, i) => {
                const prod = products.find((p) => p.id === item.product_id);
                return (
                  <div key={i} className="grid grid-cols-[1fr_80px_100px_auto] gap-2 items-end">
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Producto</p>}
                      <select
                        value={item.product_id}
                        onChange={(e) => autoPrecio(i, e.target.value)}
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700"
                      >
                        <option value="">Seleccioná…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Cant.</p>}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={item.cantidad}
                        onChange={(e) => updateLine(i, "cantidad", e.target.value)}
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                      />
                    </div>
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Precio $</p>}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={item.precio_unitario}
                        onChange={(e) => updateLine(i, "precio_unitario", e.target.value)}
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                      />
                    </div>
                    <button
                      onClick={() => removeLine(i)}
                      disabled={items.length === 1}
                      className="h-10 w-8 flex items-center justify-center text-neutral-300 hover:text-danger transition-colors disabled:opacity-30"
                      aria-label="Quitar línea"
                    >
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>

            {total > 0 && (
              <div className="mt-3 flex justify-end">
                <span className="text-sm font-semibold text-neutral-900">
                  Total: {AR.format(total)}
                </span>
              </div>
            )}
          </div>

          <Textarea
            label="Notas"
            placeholder={TIPO_PLACEHOLDER[tipo]}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
            {TIPO_BTN[tipo]}
          </Button>
        </div>
      </aside>
    </>
  );
}
