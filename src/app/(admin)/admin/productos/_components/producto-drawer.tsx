"use client";

import { useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { Input, Textarea, Select } from "@/components/ui";
import { Button } from "@/components/ui";
import { crearProducto, actualizarProducto } from "../actions";
import type { Database } from "@/types/database";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = Database["public"]["Tables"]["categories"]["Row"];

const nPos = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number().positive().nullable()
);

const schema = z.object({
  sku:               z.string().min(1, "Requerido"),
  name:              z.string().min(2, "Mínimo 2 caracteres"),
  short_description: z.string().optional(),
  category_id:       z.string().optional(),
  unit_label:        z.string().min(1, "Requerido"),
  freezer_required:  z.boolean(),
  is_active:         z.boolean(),
  costo:             nPos,
  precio_dist:       nPos,
  precio_publico:    nPos,
  pkg_unitario:      z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive().nullable()),
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
  open:       boolean;
  product:    Product | null;
  categories: Category[];
  onClose:    () => void;
}

export function ProductoDrawer({ open, product, categories, onClose }: Props) {
  const [pending, startTransition] = useTransition();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sku: "", name: "", short_description: "", category_id: "",
      unit_label: "unidad", freezer_required: false, is_active: true,
      costo: null, precio_dist: null, precio_publico: null, pkg_unitario: null,
    },
  });

  useEffect(() => {
    if (!open) return;
    reset(product ? {
      sku:               product.sku,
      name:              product.name,
      short_description: product.short_description ?? "",
      category_id:       product.category_id ?? "",
      unit_label:        product.unit_label,
      freezer_required:  product.freezer_required,
      is_active:         product.is_active,
      costo:             product.costo ?? null,
      precio_dist:       product.precio_dist ?? null,
      precio_publico:    product.price_b2c ?? null,
      pkg_unitario:      product.pkg_unitario ?? null,
    } : {
      sku: "", name: "", short_description: "", category_id: "",
      unit_label: "unidad", freezer_required: false, is_active: true,
      costo: null, precio_dist: null, precio_publico: null, pkg_unitario: null,
    });
  }, [open, product, reset]);

  function onSubmit(values: FormValues) {
    const payload = {
      sku:               values.sku,
      name:              values.name,
      slug:              "",
      short_description: values.short_description || null,
      category_id:       values.category_id || null,
      unit_label:        values.unit_label,
      freezer_required:  values.freezer_required,
      is_active:         values.is_active,
      costo:             values.costo,
      precio_dist:       values.precio_dist,
      price_b2c:         values.precio_publico ?? 0,
      pkg_unitario:      values.pkg_unitario,
    };

    startTransition(async () => {
      try {
        if (product) {
          await actualizarProducto(product.id, payload);
        } else {
          await crearProducto(payload);
        }
        onClose();
      } catch (e) {
        alert((e as Error).message);
      }
    });
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
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" {...register("freezer_required")} />
                <span className="text-sm text-neutral-700">Requiere freezer</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" {...register("is_active")} />
                <span className="text-sm text-neutral-700">Activo</span>
              </label>
            </div>
          </div>

          {/* Precios */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Precios</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Input
                  label="Costo $"
                  type="number"
                  step="1"
                  placeholder="0"
                  {...register("costo")}
                />
                <p className="text-[11px] text-neutral-400 mt-1">Lo que paga IDEIA</p>
              </div>
              <div>
                <Input
                  label="Precio kiosco $"
                  type="number"
                  step="1"
                  placeholder="0"
                  {...register("precio_dist")}
                />
                <p className="text-[11px] text-neutral-400 mt-1">Lo que cobra IDEIA</p>
              </div>
              <div>
                <Input
                  label="Precio público $"
                  type="number"
                  step="1"
                  placeholder="0"
                  {...register("precio_publico")}
                />
                <p className="text-[11px] text-neutral-400 mt-1">Sugerido al cliente</p>
              </div>
            </div>
          </div>

          {/* Embalaje */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Embalaje</p>
            <div className="w-1/2 pr-1.5">
              <Input
                label="Unidades por caja"
                type="number"
                step="1"
                placeholder="12"
                {...register("pkg_unitario")}
              />
            </div>
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
