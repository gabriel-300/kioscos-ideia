"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { registrarRetiro } from "../retiro-actions";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

interface Props {
  sucursalId: string;
}

export function RetiroEfectivoButton({ sucursalId }: Props) {
  const [open, setOpen]     = useState(false);
  const [monto, setMonto]   = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [previewUrl,  setPreviewUrl]  = useState<string | null>(null);
  const [uploading,   setUploading]   = useState(false);
  const [pending, startTransition] = useTransition();
  const montoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => montoRef.current?.focus(), 80);
  }, [open]);

  function handleClose() {
    setMonto(""); setMotivo(""); setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setComprobante(null); setPreviewUrl(null);
    setOpen(false);
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setComprobante(file);
    setPreviewUrl(URL.createObjectURL(file));
    e.target.value = "";
  }

  function handleRemoveImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setComprobante(null);
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

  function handleSubmit() {
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { setError("El monto es obligatorio"); return; }
    if (!motivo.trim())             { setError("El motivo es obligatorio"); return; }
    setError(null);

    startTransition(async () => {
      try {
        let comprobanteUrl: string | null = null;
        if (comprobante) {
          setUploading(true);
          try { comprobanteUrl = await uploadImage(comprobante); }
          finally { setUploading(false); }
        }
        await registrarRetiro({
          sucursal_id: sucursalId,
          monto: montoNum,
          motivo: motivo.trim(),
          comprobante_image_url: comprobanteUrl,
        });
        handleClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-neutral-300 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
      >
        <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181" />
        </svg>
        Retiro
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-0.5">Caja</p>
                <h2 className="text-base font-semibold font-display text-neutral-900">Registrar egreso / retiro</h2>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
              >
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-neutral-500">
                Ingresá el monto y el motivo del retiro de efectivo.
              </p>

              {/* Monto */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2 block">
                  Monto a retirar
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
                  <input
                    ref={montoRef}
                    type="number"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full h-12 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-lg font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
                  />
                </div>
              </div>

              {/* Motivo */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2 block">
                  Observación / Motivo
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Pago a proveedor, Retiro parcial, etc."
                  rows={3}
                  className="w-full rounded-xl border-2 border-neutral-300 px-4 py-3 text-sm text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors resize-none"
                />
              </div>

              {/* Comprobante (opcional) */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2 block">
                  Foto de comprobante (opcional)
                </label>
                {previewUrl ? (
                  <div className="flex items-start gap-3">
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={previewUrl}
                        alt="Preview comprobante"
                        className="h-20 rounded-lg border border-neutral-200 object-contain bg-neutral-50"
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
                  <label className="flex items-center gap-2 h-10 px-3 w-full rounded-xl border border-dashed border-neutral-300 bg-white hover:bg-neutral-50 cursor-pointer transition-colors">
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

              {error && <p className="text-xs text-danger font-medium">{error}</p>}
            </div>

            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 h-10 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={pending || uploading}
                className="flex-1 h-10 rounded-xl bg-tierra-700 text-white text-sm font-semibold hover:bg-tierra-800 disabled:opacity-50 transition-colors"
              >
                {uploading ? "Subiendo imagen…" : pending ? "Guardando…" : "Confirmar retiro"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
