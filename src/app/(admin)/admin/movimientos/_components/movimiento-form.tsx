"use client";

import { useState, useTransition } from "react";
import { Button, Input, Select, Textarea, Combobox } from "@/components/ui";
import { crearMovimiento, type ItemInput } from "../actions";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Sucursal = Pick<Database["public"]["Tables"]["sucursales"]["Row"], "id" | "nombre">;
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

type Proveedor = { id: string; nombre: string };

interface Props {
  open:               boolean;
  sucursales:         Sucursal[];
  products:           Product[];
  proveedores?:       Proveedor[];
  onClose:            () => void;
  defaultSucursalId?: string;
  defaultTipo?:       TipoMov;
  formTitle?:         string;
}

export function MovimientoForm({ open, sucursales, products, proveedores = [], onClose, defaultSucursalId, defaultTipo, formTitle }: Props) {
  const [pending, startTransition] = useTransition();
  const [sucursalId, setSucursalId] = useState(defaultSucursalId ?? "");
  const [fecha,      setFecha]      = useState(new Date().toISOString().slice(0, 10));
  const [tipo,       setTipo]       = useState<TipoMov>(defaultTipo ?? "entrega");
  const [notas,      setNotas]      = useState("");
  const [proveedor,  setProveedor]  = useState("");
  const [nroRemito,  setNroRemito]  = useState("");
  const [items,      setItems]      = useState<LineItem[]>([emptyLine()]);
  const [error,        setError]        = useState<string | null>(null);
  const [remitoImage,  setRemitoImage]  = useState<File | null>(null);
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null);
  const [uploading,    setUploading]    = useState(false);

  function resetForm() {
    setSucursalId(defaultSucursalId ?? "");
    setFecha(new Date().toISOString().slice(0, 10));
    setTipo(defaultTipo ?? "entrega");
    setNotas("");
    setProveedor("");
    setNroRemito("");
    setItems([emptyLine()]);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRemitoImage(null);
    setPreviewUrl(null);
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRemitoImage(file);
    setPreviewUrl(URL.createObjectURL(file));
    e.target.value = "";
  }

  function handleRemoveImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRemitoImage(null);
    setPreviewUrl(null);
  }

  async function uploadImage(file: File): Promise<string> {
    const supabase = createBrowserClient();
    const ext  = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("remitos").upload(path, file);
    if (error) throw new Error(`No se pudo subir la imagen: ${error.message}`);
    const { data } = supabase.storage.from("remitos").getPublicUrl(path);
    return data.publicUrl;
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
        let remitoImageUrl: string | null = null;
        if (remitoImage) {
          setUploading(true);
          try { remitoImageUrl = await uploadImage(remitoImage); }
          finally { setUploading(false); }
        }
        await crearMovimiento({
          sucursal_id:      sucursalId,
          fecha,
          tipo,
          notas:            notas     || null,
          proveedor:        proveedor || null,
          nro_remito:       nroRemito || null,
          remito_image_url: remitoImageUrl,
          items:            parsed,
        });
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
                      <Combobox
                        options={products.map((p) => ({ value: p.id, label: p.name }))}
                        value={item.product_id}
                        onChange={(v) => autoPrecio(i, v)}
                      />
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

          {/* Datos de factura — solo en entregas */}
          {tipo === "entrega" && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">
                Datos de factura / remito (opcional)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">
                    Proveedor
                  </label>
                  {proveedores.length > 0 ? (
                    <select
                      value={proveedor}
                      onChange={(e) => setProveedor(e.target.value)}
                      className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
                    >
                      <option value="">Sin proveedor</option>
                      {proveedores.map((p) => (
                        <option key={p.id} value={p.nombre}>{p.nombre}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={proveedor}
                      onChange={(e) => setProveedor(e.target.value)}
                      placeholder="Nombre del proveedor"
                      className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">
                    N° Remito / Factura
                  </label>
                  <input
                    type="text"
                    value={nroRemito}
                    onChange={(e) => setNroRemito(e.target.value)}
                    placeholder="Ej: 0001-00012345"
                    className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
                  />
                </div>
              </div>

              {/* Imagen del remito */}
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">
                  Foto de remito / factura
                </label>
                {previewUrl ? (
                  <div className="flex items-start gap-3">
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={previewUrl}
                        alt="Preview remito"
                        className="h-24 rounded-lg border border-neutral-200 object-contain bg-neutral-50"
                      />
                    </a>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="mt-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      Quitar imagen
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 h-10 px-3 w-full rounded-lg border border-dashed border-neutral-300 bg-white hover:bg-neutral-50 cursor-pointer transition-colors">
                    <svg className="size-4 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                    </svg>
                    <span className="text-sm text-neutral-500">Agregar imagen</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={handleImageSelect}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

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
          <Button variant="primary" size="sm" loading={pending || uploading} onClick={handleSubmit} className="flex-1">
            {uploading ? "Subiendo imagen…" : TIPO_BTN[tipo]}
          </Button>
        </div>
      </aside>
    </>
  );
}
