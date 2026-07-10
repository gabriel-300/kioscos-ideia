"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Input, Combobox } from "@/components/ui";
import { crearPromo, actualizarPromo, type PromoItemInput } from "../actions";
import { ImageUploader } from "../../productos/_components/image-uploader";
import type { PromoWithItems } from "./promos-table";

type ProductOption = { id: string; name: string; unit_label: string };

interface LineItem {
  product_id: string;
  cantidad:   string;
}

const emptyLine = (): LineItem => ({ product_id: "", cantidad: "" });

interface Props {
  open:     boolean;
  promo:    PromoWithItems | null;
  products: ProductOption[];
  onClose:  () => void;
}

export function PromoDrawer({ open, promo, products, onClose }: Props) {
  const [pending, startTransition] = useTransition();
  const [name,      setName]      = useState("");
  const [price,     setPrice]     = useState("");
  const [isActive,  setIsActive]  = useState(true);
  const [tipo,      setTipo]      = useState<"promo" | "receta">("promo");
  const [items,     setItems]     = useState<LineItem[]>([emptyLine()]);
  const [error,     setError]     = useState<string | null>(null);
  const [imageUrl,  setImageUrl]  = useState<string | null>(null);
  const [rindeMode,  setRindeMode]  = useState<Record<number, boolean>>({});
  const [rindeTexto, setRindeTexto] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) return;
    if (promo) {
      setName(promo.name);
      setPrice(String(promo.price));
      setIsActive(promo.is_active);
      setTipo(promo.tipo);
      setImageUrl(promo.cover_image_url ?? null);
      const loadedItems = promo.promo_items.length > 0
        ? promo.promo_items.map((i) => ({ product_id: i.product_id, cantidad: String(i.cantidad) }))
        : [emptyLine()];
      setItems(loadedItems);

      const nextRindeMode: Record<number, boolean> = {};
      const nextRindeTexto: Record<number, string> = {};
      if (promo.tipo === "receta") {
        loadedItems.forEach((item, idx) => {
          const n = detectRinde(parseFloat(item.cantidad));
          if (n) { nextRindeMode[idx] = true; nextRindeTexto[idx] = n; }
        });
      }
      setRindeMode(nextRindeMode);
      setRindeTexto(nextRindeTexto);
    } else {
      setName(""); setPrice(""); setIsActive(true); setTipo("promo"); setItems([emptyLine()]);
      setImageUrl(null);
      setRindeMode({});
      setRindeTexto({});
    }
    setError(null);
  }, [open, promo]);

  function handleClose() { onClose(); }

  function addLine()              { setItems((p) => [...p, emptyLine()]); }
  function removeLine(i: number)  { setItems((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, field: keyof LineItem, value: string) {
    setItems((p) => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  // Para insumos que se compran en un paquete y se usan de a fracciones por
  // receta (ej: bolsita de 6 panes para pancho) -- en vez de hacer la cuenta a
  // mano y tipear un decimal, se ingresa "para cuántas unidades rinde" y acá
  // se calcula la fracción sola.
  function toggleRindeMode(i: number) {
    setRindeMode((p) => ({ ...p, [i]: !p[i] }));
    setRindeTexto((p) => ({ ...p, [i]: "" }));
    updateLine(i, "cantidad", "");
  }
  function handleRindeChange(i: number, raw: string) {
    setRindeTexto((p) => ({ ...p, [i]: raw }));
    const n = parseFloat(raw);
    if (!raw || isNaN(n) || n <= 0) { updateLine(i, "cantidad", ""); return; }
    updateLine(i, "cantidad", (1 / n).toFixed(6));
  }
  // Si una receta ya guardada tiene una cantidad que es ~1/n para un entero
  // razonable, precargamos el modo "rinde para" en vez de mostrar el decimal
  // crudo -- así el toggle no es una sesión de un solo uso.
  function detectRinde(cantidad: number): string | null {
    if (!(cantidad > 0) || cantidad >= 1) return null;
    const n = Math.round(1 / cantidad);
    if (n < 2 || n > 999) return null;
    if (Math.abs(1 / n - cantidad) > 0.0005) return null;
    return String(n);
  }

  function handleSubmit() {
    setError(null);
    if (!name.trim()) { setError("Ingresá un nombre"); return; }
    const priceNum = parseFloat(price);
    if (!priceNum || priceNum <= 0) { setError("Ingresá un precio válido"); return; }
    const validItems = items.filter((i) => i.product_id && parseFloat(i.cantidad) > 0);
    if (validItems.length === 0) { setError("Agregá al menos un producto con cantidad"); return; }

    const parsedItems: PromoItemInput[] = validItems.map((i) => ({
      product_id: i.product_id,
      cantidad:   parseFloat(i.cantidad),
    }));

    startTransition(async () => {
      try {
        if (promo) {
          await actualizarPromo(promo.id, { name: name.trim(), price: priceNum, is_active: isActive, tipo, cover_image_url: imageUrl, items: parsedItems });
        } else {
          await crearPromo({ name: name.trim(), price: priceNum, is_active: isActive, tipo, cover_image_url: imageUrl, items: parsedItems });
        }
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">
            {promo ? `Editar ${promo.tipo === "receta" ? "receta" : "promoción"}` : "Nueva promoción / receta"}
          </h2>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Tipo *</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "promo" as const,  title: "Promo",   desc: "Combo con precio de oferta" },
                { value: "receta" as const, title: "Receta",  desc: "Cómo se arma un producto preparado" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTipo(opt.value)}
                  className={`text-left rounded-lg border-2 px-3 py-2 transition-colors ${
                    tipo === opt.value ? "border-tierra-700 bg-tierra-50" : "border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <p className="text-sm font-semibold text-neutral-900">{opt.title}</p>
                  <p className="text-xs text-neutral-500">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium tracking-wide uppercase text-neutral-500 mb-1.5">Imagen</p>
            <ImageUploader value={imageUrl} onChange={setImageUrl} folder="promos" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Input label="Nombre *" value={name} onChange={(e) => setName(e.target.value)} placeholder={tipo === "receta" ? "Ej: Hamburguesa Completa" : "Ej: Combo Simple"} />
            </div>
            <div>
              <Input label="Precio *" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Estado</label>
              <label className="h-11 flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" />
                <span className="text-sm text-neutral-700">{isActive ? "Activa" : "Inactiva"}</span>
              </label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">
                {tipo === "receta" ? "Insumos que lleva la receta" : "Productos que componen la promo"}
              </p>
              <button onClick={addLine} className="text-xs text-tierra-700 hover:underline font-medium">
                + Agregar línea
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, i) => (
                <div
                  key={i}
                  className={`grid gap-2 items-end ${tipo === "receta" ? "grid-cols-[1fr_140px_auto]" : "grid-cols-[1fr_100px_auto]"}`}
                >
                  <div>
                    {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Producto</p>}
                    <Combobox
                      options={products.map((p) => ({ value: p.id, label: p.name }))}
                      value={item.product_id}
                      onChange={(v) => updateLine(i, "product_id", v)}
                    />
                  </div>
                  <div>
                    {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Cant.</p>}
                    {tipo === "receta" ? (
                      <>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            step={rindeMode[i] ? "1" : "0.01"}
                            placeholder={rindeMode[i] ? "ej: 6" : "0"}
                            value={rindeMode[i] ? (rindeTexto[i] ?? "") : item.cantidad}
                            onChange={(e) => rindeMode[i] ? handleRindeChange(i, e.target.value) : updateLine(i, "cantidad", e.target.value)}
                            className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => toggleRindeMode(i)}
                            title={rindeMode[i] ? "Cargar la cantidad directa" : "Esto rinde para varias unidades (ej: una bolsita de 6 panes)"}
                            className={`shrink-0 h-10 w-9 rounded-lg border text-[10px] font-bold transition-colors ${
                              rindeMode[i] ? "border-tierra-700 bg-tierra-50 text-tierra-700" : "border-neutral-300 text-neutral-500"
                            }`}
                          >
                            {rindeMode[i] ? "1x" : "1/n"}
                          </button>
                        </div>
                        {rindeMode[i] && rindeTexto[i] && parseFloat(rindeTexto[i]) > 0 && (
                          <p className="text-[11px] text-neutral-400 mt-1">Cada unidad usa 1/{rindeTexto[i]} de esto</p>
                        )}
                      </>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={item.cantidad}
                        onChange={(e) => updateLine(i, "cantidad", e.target.value)}
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                      />
                    )}
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
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={handleClose} type="button" className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
            {promo ? "Guardar cambios" : tipo === "receta" ? "Crear receta" : "Crear promoción"}
          </Button>
        </div>
      </aside>
    </>
  );
}
