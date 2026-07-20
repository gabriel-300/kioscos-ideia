"use client";

import { useState, useTransition } from "react";
import { Button, Input, Select, Textarea, Combobox } from "@/components/ui";
import { crearMovimiento, leerRemito, type ItemInput } from "../actions";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";
import type { Database } from "@/types/database";

type Sucursal = Pick<Database["public"]["Tables"]["sucursales"]["Row"], "id" | "nombre">;
type Product  = Database["public"]["Tables"]["products"]["Row"];

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const TIPO_OPTIONS = [
  { value: "entrega",    label: "Entrega" },
  { value: "devolucion", label: "Devolución" },
  { value: "venta",      label: "Venta (salida kiosco)" },
  { value: "ajuste",     label: "Ajuste" },
  { value: "merma",      label: "Merma / pérdida" },
];

interface LineItem {
  product_id:      string;
  cantidad:        string;
  precio_unitario: string;
}

const emptyLine = (): LineItem => ({ product_id: "", cantidad: "", precio_unitario: "" });

type TipoMov = "entrega" | "devolucion" | "ajuste" | "venta" | "merma";

type Proveedor = { id: string; nombre: string; modo_facturacion?: "costo" | "precio_sugerido"; porcentaje_descuento?: number | null };

interface Props {
  open:               boolean;
  sucursales:         Sucursal[];
  products:           Product[];
  proveedores?:       Proveedor[];
  onClose:            () => void;
  defaultSucursalId?: string;
  defaultTipo?:       TipoMov;
  formTitle?:         string;
  stockMap?:          Record<string, number>;
  // Costo por sucursal (migración 059) -- sucursal_id -> product_id -> costo.
  // La sucursal se elige DENTRO de este form (no es fija como en la venta
  // rápida), así que necesita el costo de todas, no solo de una.
  costosPorSucursal?: Record<string, Record<string, number>>;
}

export function MovimientoForm({ open, sucursales, products, proveedores = [], onClose, defaultSucursalId, defaultTipo, formTitle, stockMap, costosPorSucursal = {} }: Props) {
  const [pending, startTransition] = useTransition();
  const [sucursalId, setSucursalId] = useState(defaultSucursalId ?? "");
  const [fecha,      setFecha]      = useState(fechaHoyAR());
  const [tipo,       setTipo]       = useState<TipoMov>(defaultTipo ?? "entrega");
  const [notas,      setNotas]      = useState("");
  const [proveedor,  setProveedor]  = useState("");
  const [nroRemito,  setNroRemito]  = useState("");
  const [items,      setItems]      = useState<LineItem[]>([emptyLine()]);
  const [ajusteDireccion, setAjusteDireccion] = useState<"sumar" | "restar">("sumar");
  const [pesoMode,  setPesoMode]  = useState<Record<number, boolean>>({});
  const [pesoTexto, setPesoTexto] = useState<Record<number, string>>({});
  const [gramosTexto, setGramosTexto] = useState<Record<number, string>>({});
  const [error,        setError]        = useState<string | null>(null);
  const [remitoImage,  setRemitoImage]  = useState<File | null>(null);
  const [previewUrl,   setPreviewUrl]   = useState<string | null>(null);
  const [uploading,    setUploading]    = useState(false);
  const [leyendoIA,    setLeyendoIA]    = useState(false);
  const [ocrHints,     setOcrHints]     = useState<Record<number, string>>({});

  function resetForm() {
    setSucursalId(defaultSucursalId ?? "");
    setFecha(fechaHoyAR());
    setTipo(defaultTipo ?? "entrega");
    setNotas("");
    setProveedor("");
    setNroRemito("");
    setItems([emptyLine()]);
    setAjusteDireccion("sumar");
    setPesoMode({});
    setPesoTexto({});
    setGramosTexto({});
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRemitoImage(null);
    setPreviewUrl(null);
    setOcrHints({});
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

  // Achica la foto antes de mandarla a leer -- una foto de celular sin achicar
  // puede pesar varios MB, mucho más lento y más cerca del límite de tamaño
  // de la API de lectura.
  async function resizeImageToBase64(file: File, maxDim = 1600, quality = 0.7): Promise<{ base64: string; mimeType: string }> {
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
  }

  // Lee la foto del remito con IA y precarga las líneas -- la misma foto queda
  // además como evidencia adjunta (remito_image_url), un solo click sirve para
  // las dos cosas. Los productos que no matchean claro quedan con la línea en
  // blanco + el texto original como pista (ocrHints), para elegir a mano.
  async function handleLeerConIA(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setRemitoImage(file);
    setPreviewUrl(URL.createObjectURL(file));

    setLeyendoIA(true);
    setError(null);
    try {
      const { base64, mimeType } = await resizeImageToBase64(file);
      const res = await leerRemito(base64, mimeType);
      if (res.error) { setError(res.error); return; }
      const lineas = res.lineas ?? [];
      if (lineas.length === 0) { setError("No se encontraron líneas en la foto"); return; }

      const proveedorActual = proveedores.find((p) => p.nombre === proveedor);
      const factor = proveedorActual?.modo_facturacion === "precio_sugerido" && proveedorActual.porcentaje_descuento != null
        ? 1 - proveedorActual.porcentaje_descuento / 100
        : 1;

      const nuevosItems: LineItem[] = lineas.map((l) => ({
        product_id:      l.productIdMatch ?? "",
        cantidad:        String(l.cantidad),
        precio_unitario: String(Math.round(l.precio * factor * 100) / 100),
      }));
      const nuevosHints: Record<number, string> = {};
      lineas.forEach((l, i) => { if (!l.productIdMatch) nuevosHints[i] = l.producto; });

      setItems(nuevosItems);
      setOcrHints(nuevosHints);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLeyendoIA(false);
    }
  }

  function handleClose() { resetForm(); onClose(); }

  function addLine()           { setItems((p) => [...p, emptyLine()]); }
  function removeLine(i: number) { setItems((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, field: keyof LineItem, value: string) {
    setItems((p) => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  // Costo de un producto en la sucursal actualmente elegida en el form (no
  // en el producto en general -- costo es por sucursal, ver migración 059).
  function costoDe(productId: string): number | null {
    return costosPorSucursal[sucursalId]?.[productId] ?? null;
  }

  function autoPrecio(i: number, productId: string) {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    // En entregas el precio es el COSTO real pagado al proveedor, no el precio de
    // venta -- se sugiere el costo ya cargado en el producto (si hay), pero queda
    // en blanco (pendiente) si todavía no se cargó, en vez de asumir cualquier valor.
    const precio = tipo === "entrega" ? costoDe(productId) : null;
    setItems((p) => p.map((item, idx) =>
      idx === i ? { ...item, product_id: productId, precio_unitario: precio != null ? String(precio) : "" } : item
    ));
    // Al cambiar de producto, la línea vuelve a modo unidades (el peso/gramo era del producto anterior)
    setPesoMode((p) => ({ ...p, [i]: false }));
    setPesoTexto((p) => ({ ...p, [i]: "" }));
    setGramosTexto((p) => ({ ...p, [i]: "" }));
    updateLine(i, "cantidad", "");
  }

  // Productos que se venden por unidad pero se reciben por peso (ej. pan: remito en kg,
  // se vende por bolsa) — necesitan "Peso por unidad (gramos)" cargado en la ficha.
  function puedeConvertirPeso(prod: Product | undefined) {
    return !!prod && prod.unit_label === "unidad" && !!prod.weight_grams && prod.weight_grams > 0;
  }

  // Productos que se trackean directo en kg (ej. chipa a granel) -- se pide en
  // gramos, no en kg, mismo criterio que la venta rápida: si el cajero tipea
  // "100" pensando en 100g, no puede terminar cargado como 100 kg por error.
  function handleGramosChange(i: number, raw: string) {
    setGramosTexto((p) => ({ ...p, [i]: raw }));
    const g = parseFloat(raw);
    if (!raw || isNaN(g) || g <= 0) { updateLine(i, "cantidad", ""); return; }
    updateLine(i, "cantidad", String(g / 1000));
  }

  function togglePesoMode(i: number) {
    setPesoMode((p) => ({ ...p, [i]: !p[i] }));
    setPesoTexto((p) => ({ ...p, [i]: "" }));
    updateLine(i, "cantidad", "");
  }

  function handlePesoChange(i: number, raw: string, prod: Product) {
    setPesoTexto((p) => ({ ...p, [i]: raw }));
    const kg = parseFloat(raw);
    if (!raw || isNaN(kg) || kg <= 0 || !prod.weight_grams) {
      updateLine(i, "cantidad", "");
      return;
    }
    const unidades = Math.round((kg * 1000) / prod.weight_grams);
    updateLine(i, "cantidad", String(unidades));
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
    if (tipo === "merma" && !notas.trim()) { setError("Contá el motivo de la pérdida"); return; }

    const signo = tipo === "ajuste" && ajusteDireccion === "restar" ? -1 : 1;
    const parsed: ItemInput[] = validItems.map((i) => ({
      product_id:      i.product_id,
      cantidad:        parseFloat(i.cantidad) * signo,
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
    merma:      "Registrar merma",
  };
  const TIPO_BTN: Record<TipoMov, string> = {
    entrega:    "Registrar entrega",
    devolucion: "Registrar devolución",
    venta:      "Registrar venta",
    ajuste:     "Guardar ajuste",
    merma:      "Guardar merma",
  };
  const TIPO_PLACEHOLDER: Record<TipoMov, string> = {
    entrega:    "Observaciones sobre la entrega…",
    devolucion: "Motivo de la devolución…",
    venta:      "Observaciones sobre las ventas…",
    ajuste:     "Motivo del ajuste…",
    merma:      "Motivo de la pérdida (ej: se venció, se puso duro, se rompió)… *",
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

          {/* Sentido del ajuste */}
          {tipo === "ajuste" && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Sentido del ajuste</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAjusteDireccion("sumar")}
                  className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                    ajusteDireccion === "sumar"
                      ? "border-selva-600 bg-selva-50 text-selva-700"
                      : "border-neutral-300 text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  + Sumar stock
                </button>
                <button
                  type="button"
                  onClick={() => setAjusteDireccion("restar")}
                  className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                    ajusteDireccion === "restar"
                      ? "border-danger bg-danger/5 text-danger"
                      : "border-neutral-300 text-neutral-500 hover:bg-neutral-50"
                  }`}
                >
                  − Restar stock
                </button>
              </div>
            </div>
          )}

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
                const importe = (parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0);
                return (
                  <div
                    key={i}
                    className={`grid gap-2 items-end ${
                      tipo === "merma" ? "grid-cols-[1fr_140px_auto]" : "grid-cols-[1fr_110px_100px_100px_auto]"
                    }`}
                  >
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Producto</p>}
                      <Combobox
                        options={products.map((p) => ({ value: p.id, label: p.name }))}
                        value={item.product_id}
                        onChange={(v) => autoPrecio(i, v)}
                      />
                      {(tipo === "ajuste" || tipo === "merma") && prod && stockMap && (
                        <p className="text-[11px] text-neutral-400 mt-1">
                          Stock actual: <span className="font-semibold text-neutral-600">
                            {stockMap[prod.id] ?? 0} {prod.unit_label === "unidad" ? "u." : prod.unit_label}
                          </span>
                        </p>
                      )}
                      {tipo === "entrega" && !item.product_id && ocrHints[i] && (
                        <p className="text-[11px] text-amber-600 mt-1">
                          Remito decía: "{ocrHints[i]}" — elegí el producto
                        </p>
                      )}
                    </div>
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Cant.</p>}
                      {puedeConvertirPeso(prod) && tipo === "entrega" ? (() => {
                        const kgIngresado    = parseFloat(pesoTexto[i] || "0") || 0;
                        const unidadesExactas = prod!.weight_grams ? (kgIngresado * 1000) / prod!.weight_grams : 0;
                        const desajuste = !!pesoMode[i] && kgIngresado > 0 && Math.abs(unidadesExactas - Math.round(unidadesExactas)) > 0.05;
                        return (
                          <>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step={pesoMode[i] ? "0.01" : "1"}
                                placeholder={pesoMode[i] ? "kg" : "0"}
                                value={pesoMode[i] ? (pesoTexto[i] ?? "") : item.cantidad}
                                onChange={(e) => pesoMode[i] ? handlePesoChange(i, e.target.value, prod!) : updateLine(i, "cantidad", e.target.value)}
                                className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                              />
                              <button
                                type="button"
                                onClick={() => togglePesoMode(i)}
                                title={pesoMode[i] ? "Cargar por unidades" : "Cargar por peso total del remito (kg)"}
                                className={`shrink-0 h-10 w-9 rounded-lg border text-[11px] font-bold transition-colors ${
                                  pesoMode[i] ? "border-tierra-700 bg-tierra-50 text-tierra-700" : "border-neutral-300 text-neutral-500"
                                }`}
                              >
                                {pesoMode[i] ? "u" : "kg"}
                              </button>
                            </div>
                            {pesoMode[i] && item.cantidad && (
                              <p className={`text-[11px] mt-1 ${desajuste ? "text-amber-600" : "text-neutral-400"}`}>
                                {desajuste
                                  ? `≈${unidadesExactas.toFixed(2)} unid. exactas → redondeado a ${item.cantidad}`
                                  : `= ${item.cantidad} unidades`}
                              </p>
                            )}
                          </>
                        );
                      })() : prod?.unit_label === "kg" ? (
                        <>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              value={gramosTexto[i] ?? (parseFloat(item.cantidad) > 0 ? String(Math.round(parseFloat(item.cantidad) * 1000)) : "")}
                              onChange={(e) => handleGramosChange(i, e.target.value)}
                              onFocus={(e) => e.target.select()}
                              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                            />
                            <span className="shrink-0 text-xs font-semibold text-neutral-400">g</span>
                          </div>
                          {item.cantidad && (
                            <p className="text-[11px] text-neutral-400 mt-1">= {formatKg(parseFloat(item.cantidad))} kg</p>
                          )}
                        </>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={item.cantidad}
                          onChange={(e) => updateLine(i, "cantidad", e.target.value)}
                          className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                        />
                      )}
                    </div>
                    {tipo !== "merma" && (
                      <>
                        <div>
                          {i === 0 && (
                            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">
                              {tipo === "entrega" ? "Costo $" : "Precio $"}
                            </p>
                          )}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={item.precio_unitario}
                            onChange={(e) => updateLine(i, "precio_unitario", e.target.value)}
                            className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                          />
                          {tipo === "entrega" && !item.precio_unitario && item.product_id && (
                            <p className="text-[11px] text-amber-600 mt-1">Sin costo — queda pendiente</p>
                          )}
                          {tipo === "entrega" && item.precio_unitario && costoDe(item.product_id) != null && (() => {
                            const costoActual = costoDe(item.product_id)!;
                            const precioNuevo = parseFloat(item.precio_unitario);
                            if (isNaN(precioNuevo) || precioNuevo === costoActual) return null;
                            const variacion = ((precioNuevo - costoActual) / costoActual) * 100;
                            return (
                              <p className="text-[11px] text-amber-600 mt-1 font-medium">
                                ⚠ Antes {AR.format(costoActual)} · Ahora {AR.format(precioNuevo)} ({variacion > 0 ? "+" : ""}{variacion.toFixed(0)}%)
                              </p>
                            );
                          })()}
                        </div>
                        <div>
                          {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Importe</p>}
                          <div className="h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-sm tabular-nums flex items-center text-neutral-600">
                            {importe > 0 ? AR.format(importe) : "—"}
                          </div>
                        </div>
                      </>
                    )}
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
            </div>
          )}

          {/* Leer remito con IA -- precarga las líneas de abajo a partir de la foto */}
          {tipo === "entrega" && !previewUrl && (
            <div>
              <label className={`flex items-center justify-center gap-2 h-10 px-3 w-full rounded-lg border text-sm font-medium transition-colors ${
                leyendoIA
                  ? "border-tierra-200 bg-tierra-50 text-tierra-400 cursor-wait"
                  : "border-tierra-300 bg-tierra-50 text-tierra-700 hover:bg-tierra-100 cursor-pointer"
              }`}>
                {leyendoIA ? (
                  <>
                    <svg className="size-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Leyendo remito…
                  </>
                ) : (
                  <>📷 Leer remito con IA</>
                )}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  disabled={leyendoIA}
                  onChange={handleLeerConIA}
                />
              </label>
              <p className="text-[11px] text-neutral-400 mt-1">
                Precarga los productos, cantidades y precios abajo — revisá antes de guardar. Para remitos escritos a mano, cargá manual.
              </p>
            </div>
          )}

          {/* Foto — remito en entregas, evidencia opcional en mermas */}
          {(tipo === "entrega" || tipo === "merma") && (
            <div className={tipo === "merma" ? "rounded-xl border border-neutral-200 bg-neutral-50 p-4" : ""}>
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">
                {tipo === "merma" ? "Foto de la merma (opcional)" : "Foto de remito / factura"}
              </label>
              {previewUrl ? (
                <div className="flex items-start gap-3">
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                    <img
                      src={previewUrl}
                      alt="Preview"
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
