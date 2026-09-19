"use client";

import { useEffect } from "react";
import { REQUISITOS_IMAGEN, formatearPeso } from "@/lib/imagen";

export type RechazoImagen = { nombre: string; motivos: string[] };

interface Props {
  abierto:  boolean;
  onClose:  () => void;
  /** Si viene, la ventana explica por qué se rechazó ese archivo; si no, es la guía general. */
  rechazo?: RechazoImagen | null;
}

// Ventana con el modelo de imagen que se acepta. Se abre sola cuando se rechaza un archivo y también
// desde el enlace "¿Cómo debe ser la imagen?" del cargador.
export function ImagenRequisitosDialog({ abierto, onClose, rechazo }: Props) {
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto, onClose]);

  if (!abierto) return null;

  const { ladoMinPx, ladoRecomendadoPx, pesoMaxBytes } = REQUISITOS_IMAGEN;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="imagen-req-titulo"
        className="relative z-10 w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl"
      >
        <div className="px-5 pt-5 pb-3 border-b border-neutral-100">
          <h2 id="imagen-req-titulo" className="text-base font-bold text-neutral-900">
            {rechazo ? "Esta imagen no se puede subir" : "Cómo debe ser la imagen del producto"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Las imágenes se descargan en cada pantalla de venta y en el catálogo público: si pesan mucho se agota el tráfico del servicio.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {rechazo && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-red-800 break-all">{rechazo.nombre}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-red-700 list-disc pl-4">
                {rechazo.motivos.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )}

          {/* Modelo: cuadrada, fondo liso, producto centrado */}
          <div className="grid grid-cols-2 gap-3">
            <figure className="text-center">
              <svg viewBox="0 0 120 120" className="w-full rounded-lg border-2 border-emerald-400 bg-white" role="img" aria-label="Ejemplo correcto: imagen cuadrada, fondo blanco y producto centrado">
                <rect x="0" y="0" width="120" height="120" fill="#ffffff" />
                <rect x="30" y="34" width="60" height="52" rx="8" fill="#e8c9a0" stroke="#b8894f" strokeWidth="2" />
                <circle cx="60" cy="60" r="12" fill="#d9a066" />
              </svg>
              <figcaption className="mt-1.5 text-[11px] font-semibold text-emerald-700">✓ Cuadrada, fondo liso, producto centrado</figcaption>
            </figure>
            <figure className="text-center">
              <svg viewBox="0 0 120 120" className="w-full rounded-lg border-2 border-red-300" role="img" aria-label="Ejemplo incorrecto: imagen apaisada, con mucho fondo y producto chico y corrido">
                <rect x="0" y="0" width="120" height="120" fill="#cfd8dc" />
                <rect x="0" y="80" width="120" height="40" fill="#90a4ae" />
                <rect x="78" y="70" width="22" height="18" rx="3" fill="#e8c9a0" stroke="#b8894f" strokeWidth="1.5" />
                <text x="8" y="16" fontSize="9" fill="#546e7a">www.tienda.com</text>
              </svg>
              <figcaption className="mt-1.5 text-[11px] font-semibold text-red-700">✗ Fondo cargado, producto chico, textos o marcas</figcaption>
            </figure>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">Lo que se pide</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-neutral-800">
              <li><span className="font-semibold">Formato:</span> JPG, PNG o WebP.</li>
              <li><span className="font-semibold">Peso:</span> hasta {formatearPeso(pesoMaxBytes)} (lo ideal: entre 100 y 300 KB).</li>
              <li><span className="font-semibold">Tamaño:</span> como mínimo {ladoMinPx} px de lado; lo ideal es {ladoRecomendadoPx} × {ladoRecomendadoPx} px.</li>
              <li><span className="font-semibold">Forma:</span> cuadrada (1:1). Si no lo es, se recorta al mostrarse en la grilla.</li>
              <li><span className="font-semibold">Fondo:</span> blanco o liso, sin escenas ni otros productos.</li>
              <li><span className="font-semibold">Producto:</span> entero, centrado y ocupando cerca del 80% de la imagen.</li>
              <li><span className="font-semibold">Sin</span> marcas de agua, logos de otras tiendas ni textos.</li>
            </ul>
          </div>

          <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500">Cómo achicarla</h3>
            <p className="mt-1 text-xs text-neutral-700 leading-relaxed">
              Abrila en Paint o en Fotos de Windows, usá <span className="font-semibold">Cambiar tamaño</span> a {ladoRecomendadoPx} px de ancho y
              guardala como JPG. Una foto de celular pesa 3 a 5 MB: siempre hay que achicarla antes de subirla.
              También podés usar la opción <span className="font-semibold">&ldquo;o pegar una URL&rdquo;</span> con una imagen que ya esté publicada.
            </p>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="w-full rounded-lg bg-tierra-700 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
