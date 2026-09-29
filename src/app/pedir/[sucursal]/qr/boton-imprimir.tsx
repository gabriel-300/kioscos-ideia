"use client";

export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="pd-display h-12 rounded-2xl bg-pd-ember px-8 text-[15px] font-bold text-white print:hidden"
    >
      Imprimir
    </button>
  );
}
