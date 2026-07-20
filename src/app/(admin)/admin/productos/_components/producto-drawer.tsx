"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { Input, Select } from "@/components/ui";
import { Button } from "@/components/ui";
import { crearProducto, actualizarProducto, type PrecioSucursalInput } from "../actions";
import { ImageUploader } from "./image-uploader";
import type { Database } from "@/types/database";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = Database["public"]["Tables"]["categories"]["Row"];
type Sucursal = { id: string; nombre: string };
type PrecioRow = { product_id: string; sucursal_id: string; precio_dist: number; costo: number };

// Precio y costo dejaron de ser un campo del form -- son un valor por
// sucursal, manejados aparte en `preciosPorSucursal` (igual que `imageUrl`).
const schema = z.object({
  sku:               z.string().min(1, "Requerido"),
  name:              z.string().min(2, "Mínimo 2 caracteres"),
  short_description: z.string().optional(),
  category_id:       z.string().optional(),
  unit_label:        z.string().min(1, "Requerido"),
  freezer_required:  z.boolean(),
  is_active:         z.boolean(),
  vendible_pos:      z.boolean(),
  stock_minimo:      z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().min(0)),
  weight_grams:      z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive().nullable()),
  merma_pct:         z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(99).nullable()),
});

type FormValues = z.infer<typeof schema>;

const UNIT_OPTIONS = [
  { value: "unidad", label: "Unidad" },
  { value: "kg",     label: "Kilogramo (kg)" },
  { value: "bolsa",  label: "Bolsa" },
  { value: "caja",   label: "Caja" },
  { value: "pack",   label: "Pack" },
];

interface Props {
  open:         boolean;
  product:      Product | null;
  categories:   Category[];
  sucursales:   Sucursal[];
  precios:      PrecioRow[];
  existingSkus: string[];
  onClose:      () => void;
  role?:        string;
}

function nextSku(existing: string[]): string {
  const prefix = "KIO-";
  let max = 0;
  for (const sku of existing) {
    const m = sku.match(/^KIO-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type PriceHistoryEntry = {
  id: string;
  sucursal_id: string | null;
  precio_dist_anterior: number | null;
  precio_dist_nuevo: number | null;
  costo_anterior: number | null;
  costo_nuevo: number | null;
  changed_at: string;
};

type PrecioTexto = { precio_dist: string; costo: string };

export function ProductoDrawer({ open, product, categories, sucursales, precios, existingSkus, onClose, role }: Props) {
  const esAdmin = role === "admin";
  const [pending,      startTransition] = useTransition();
  const [imageUrl,     setImageUrl]     = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [preciosForm,  setPreciosForm]  = useState<Record<string, PrecioTexto>>({});
  const [precioError,  setPrecioError]  = useState<string | null>(null);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      sku: "", name: "", short_description: "", category_id: "",
      unit_label: "unidad", freezer_required: false, is_active: true, vendible_pos: true,
      stock_minimo: 0, weight_grams: null, merma_pct: null,
    },
  });

  useEffect(() => {
    if (!open || !product || !esAdmin) { setPriceHistory([]); return; }
    const supabase = createBrowserClient();
    (supabase as any)
      .from("product_price_history")
      .select("id, sucursal_id, precio_dist_anterior, precio_dist_nuevo, costo_anterior, costo_nuevo, changed_at")
      .eq("product_id", product.id)
      .order("changed_at", { ascending: false })
      .limit(12)
      .then(({ data }: { data: PriceHistoryEntry[] | null }) => setPriceHistory(data ?? []));
  }, [open, product?.id, esAdmin]);

  useEffect(() => {
    if (!open) return;
    setImageUrl(product?.cover_image_url ?? null);
    setPrecioError(null);

    const nuevosPrecios: Record<string, PrecioTexto> = {};
    for (const s of sucursales) {
      const actual = product ? precios.find((p) => p.product_id === product.id && p.sucursal_id === s.id) : null;
      nuevosPrecios[s.id] = {
        precio_dist: actual ? String(actual.precio_dist) : "",
        costo:       actual ? String(actual.costo) : "",
      };
    }
    setPreciosForm(nuevosPrecios);

    reset(product ? {
      sku:               product.sku,
      name:              product.name,
      short_description: product.short_description ?? "",
      category_id:       product.category_id ?? "",
      unit_label:        product.unit_label,
      freezer_required:  product.freezer_required,
      is_active:         product.is_active,
      vendible_pos:      (product as any).vendible_pos ?? true,
      stock_minimo:      (product as any).stock_minimo ?? 0,
      weight_grams:      product.weight_grams ?? null,
      merma_pct:         product.merma_coccion_pct != null ? Math.round(product.merma_coccion_pct * 1000) / 10 : null,
    } : {
      sku: nextSku(existingSkus), name: "", short_description: "", category_id: "",
      unit_label: "unidad", freezer_required: false, is_active: true, vendible_pos: true,
      stock_minimo: 0, weight_grams: null, merma_pct: null,
    });
  }, [open, product, reset, existingSkus, sucursales, precios]);

  function setPrecioCampo(sucursalId: string, campo: keyof PrecioTexto, valor: string) {
    setPreciosForm((prev) => ({ ...prev, [sucursalId]: { ...prev[sucursalId], [campo]: valor } }));
  }

  function copiarDeSucursal(destinoId: string, origenId: string) {
    const origen = preciosForm[origenId];
    if (!origen) return;
    setPreciosForm((prev) => ({ ...prev, [destinoId]: { ...origen } }));
  }

  function onSubmit(values: FormValues) {
    setPrecioError(null);

    const preciosPayload: PrecioSucursalInput[] = [];
    for (const s of sucursales) {
      const texto = preciosForm[s.id] ?? { precio_dist: "", costo: "" };
      const precio_dist = parseFloat(texto.precio_dist);
      const costo = texto.costo === "" ? 0 : parseFloat(texto.costo);
      if (!texto.precio_dist || isNaN(precio_dist) || precio_dist <= 0) {
        setPrecioError(`Falta el precio de venta para "${s.nombre}"`);
        return;
      }
      if (isNaN(costo) || costo < 0) {
        setPrecioError(`El costo de "${s.nombre}" no es válido`);
        return;
      }
      preciosPayload.push({ sucursal_id: s.id, precio_dist, costo });
    }

    const payload = {
      sku:               values.sku,
      name:              values.name,
      short_description: values.short_description || null,
      category_id:       values.category_id || null,
      unit_label:        values.unit_label,
      freezer_required:  values.freezer_required,
      is_active:         values.is_active,
      vendible_pos:      values.vendible_pos,
      stock_minimo:      values.stock_minimo,
      weight_grams:      values.weight_grams,
      merma_coccion_pct: values.merma_pct != null ? values.merma_pct / 100 : null,
      cover_image_url:   imageUrl,
      precios:           preciosPayload,
    };

    startTransition(async () => {
      const result = product
        ? await actualizarProducto(product.id, payload)
        : await crearProducto({ ...payload, slug: "" });
      if (result.error) {
        setPrecioError(result.error);
        return;
      }
      onClose();
    });
  }

  const watchedUnitLabel = watch("unit_label");

  function margenDe(sucursalId: string): number | null {
    const texto = preciosForm[sucursalId];
    if (!texto) return null;
    const precio = parseFloat(texto.precio_dist);
    const costo  = parseFloat(texto.costo);
    if (isNaN(precio) || isNaN(costo) || costo <= 0) return null;
    return Math.round(((precio - costo) / costo) * 100);
  }

  if (!open) return null;

  const catOptions = [
    { value: "", label: "Sin categoría" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">
            {product ? "Editar producto" : "Nuevo producto"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Imagen */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Imagen</p>
            <ImageUploader value={imageUrl} onChange={setImageUrl} />
          </div>

          {/* Identificación */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Producto</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="SKU *" placeholder="EJ-001" error={errors.sku?.message} {...register("sku")} />
              <Select label="Unidad" options={UNIT_OPTIONS} {...register("unit_label")} />
            </div>
            <Input label="Nombre *" placeholder="Empanadas de carne x12" error={errors.name?.message} {...register("name")} />
            <Input label="Descripción corta" placeholder="Descripción breve" {...register("short_description")} />
            <Select label="Categoría" options={catOptions} {...register("category_id")} />
            <div className="flex gap-6 pt-1 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" {...register("freezer_required")} />
                <span className="text-sm text-neutral-700">Requiere freezer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" {...register("is_active")} />
                <span className="text-sm text-neutral-700">Activo</span>
              </label>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" {...register("vendible_pos")} />
              <span className="text-sm text-neutral-700">Vendible en el POS</span>
            </label>
            <p className="text-[11px] text-neutral-400 -mt-2">
              Desmarcalo para insumos (ej. salchicha, pan de pancho) que no se venden sueltos al público — sigue contando stock y disponible para armar recetas/promos, pero no aparece como tile en Registrar venta.
            </p>
          </div>

          {/* Precios por sucursal -- cada sucursal es un negocio independiente,
              no hay un precio "general": las dos son obligatorias. */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Precios por sucursal</p>
            {sucursales.map((s) => {
              const texto = preciosForm[s.id] ?? { precio_dist: "", costo: "" };
              const otras = sucursales.filter((o) => o.id !== s.id);
              const margen = margenDe(s.id);
              return (
                <div key={s.id} className="rounded-lg border border-neutral-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-neutral-800">{s.nombre}</p>
                    {otras.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <select
                          className="h-7 rounded-md border border-neutral-300 bg-white text-xs px-1.5 focus:outline-none focus:border-tierra-700"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) copiarDeSucursal(s.id, e.target.value);
                            e.target.value = "";
                          }}
                        >
                          <option value="" disabled>Copiar de…</option>
                          {otras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className={esAdmin ? "grid grid-cols-3 gap-3" : "grid grid-cols-1 gap-3"}>
                    {esAdmin && (
                      <div>
                        <label className="block text-xs font-medium text-neutral-500 mb-1">Costo $</label>
                        <input
                          type="number" step="1" placeholder="0"
                          value={texto.costo}
                          onChange={(e) => setPrecioCampo(s.id, "costo", e.target.value)}
                          className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">Precio kiosco $ *</label>
                      <input
                        type="number" step="1" placeholder="0"
                        value={texto.precio_dist}
                        onChange={(e) => setPrecioCampo(s.id, "precio_dist", e.target.value)}
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                      />
                    </div>
                    {esAdmin && (
                      <div>
                        <p className="text-xs font-medium text-neutral-500 mb-1">Margen</p>
                        {margen != null ? (
                          <p className={`text-lg font-bold font-display tabular-nums ${margen > 0 ? "text-selva-700" : margen < 0 ? "text-red-600" : "text-neutral-500"}`}>
                            {margen}%
                          </p>
                        ) : (
                          <p className="text-lg text-neutral-300 font-bold">—</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {precioError && (
              <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{precioError}</p>
            )}
          </div>

          {/* Historial de precios */}
          {esAdmin && product && priceHistory.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Historial de precios</p>
              <div className="rounded-xl border border-neutral-100 overflow-hidden divide-y divide-neutral-100">
                {priceHistory.map((h) => (
                  <div key={h.id} className="flex justify-between items-start px-3 py-2 text-xs">
                    <span className="text-neutral-400">
                      {sucursales.find((s) => s.id === h.sucursal_id)?.nombre ?? "—"}
                      {" · "}
                      {new Date(h.changed_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <div className="text-right space-y-0.5">
                      {h.precio_dist_nuevo != null && (
                        <p className="text-neutral-700">
                          Precio: {h.precio_dist_anterior != null ? `${AR.format(h.precio_dist_anterior)} → ` : ""}
                          <span className="font-semibold">{AR.format(h.precio_dist_nuevo)}</span>
                        </p>
                      )}
                      {h.costo_nuevo != null && (
                        <p className="text-neutral-500">
                          Costo: {h.costo_anterior != null ? `${AR.format(h.costo_anterior)} → ` : ""}
                          <span className="font-semibold">{AR.format(h.costo_nuevo)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stock */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Stock</p>
            <div>
              <Input
                label="Stock mínimo (alerta)"
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                {...register("stock_minimo")}
              />
              <p className="text-[11px] text-neutral-400 mt-1">Marca "Bajo Stock" al llegar a este valor</p>
            </div>
            {watchedUnitLabel === "unidad" && (
              <div>
                <Input
                  label="Peso por unidad (gramos)"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="Ej: 500"
                  {...register("weight_grams")}
                />
                <p className="text-[11px] text-neutral-400 mt-1">
                  Opcional. Si el remito de entrega viene en kilos (ej. pan), completá esto para poder cargar la entrega por peso total y que convierta solo a unidades/bolsas.
                </p>
              </div>
            )}
            {esAdmin && (
              <div>
                <Input
                  label="% de merma al preparar"
                  type="number"
                  step="0.1"
                  min="0"
                  max="99"
                  placeholder="Ej: 15"
                  error={errors.merma_pct?.message}
                  {...register("merma_pct")}
                />
                <p className="text-[11px] text-neutral-400 mt-1">
                  Opcional. Si lo que se carga en stock no es lo mismo que se vende (ej: se compra congelado y se vende cocido), esa diferencia se descuenta sola en cada venta, sin que el vendedor haga nada.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} type="button" className="flex-1">
            Cancelar
          </Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit(onSubmit)} className="flex-1">
            {product ? "Guardar cambios" : "Crear producto"}
          </Button>
        </div>
      </aside>
    </>
  );
}
