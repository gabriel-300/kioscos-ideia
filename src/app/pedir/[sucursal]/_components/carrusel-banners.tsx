"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Los banners grandes como los de Rappi: varios a la vista a la vez (dos en computadora; en el celular uno
// y el siguiente asomando), con flechas en computadora y deslizables con el dedo. Avanzan solos despacio y
// se frenan un rato cuando el cliente los toca. Con un solo banner ocupa todo el ancho y no se mueve.
// Respeta a quien tiene "reducir movimiento" en su celular.
const CADA_MS = 6500;
const PAUSA_MS = 12000;
const HUECO_PX = 12; // gap-3

export function CarruselBanners({ slides }: { slides: React.ReactNode[] }) {
  const pista = useRef<HTMLDivElement>(null);
  const pausaHasta = useRef(0);
  const [hayAtras, setHayAtras] = useState(false);
  const [hayAdelante, setHayAdelante] = useState(false);
  const cantidad = slides.length;

  const medir = useCallback(() => {
    const el = pista.current;
    if (!el) return;
    setHayAtras(el.scrollLeft > 4);
    setHayAdelante(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  const paso = () => {
    const el = pista.current;
    const primero = el?.firstElementChild as HTMLElement | null;
    return (primero?.offsetWidth ?? 0) + HUECO_PX;
  };

  const mover = useCallback((direccion: 1 | -1) => {
    const el = pista.current;
    if (!el) return;
    pausaHasta.current = Date.now() + PAUSA_MS;
    el.scrollBy({ left: direccion * paso(), behavior: "smooth" });
  }, []);

  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir, cantidad]);

  useEffect(() => {
    if (cantidad < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      const el = pista.current;
      if (!el || document.hidden || Date.now() < pausaHasta.current) return;
      const alFinal = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      if (alFinal && el.scrollLeft < 4) return; // todo entra en pantalla: no hay nada que mover
      if (alFinal) el.scrollTo({ left: 0, behavior: "smooth" });
      else el.scrollBy({ left: paso(), behavior: "smooth" });
    }, CADA_MS);
    return () => clearInterval(timer);
  }, [cantidad]);

  if (cantidad === 1) return <>{slides[0]}</>;

  const flecha = "absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white text-pd-ink-900 shadow-lg md:flex";

  return (
    <div
      role="region"
      aria-roledescription="carrusel"
      aria-label="Ofertas destacadas"
      className="relative"
      onPointerDown={() => { pausaHasta.current = Date.now() + PAUSA_MS; }}
      onMouseEnter={() => { pausaHasta.current = Date.now() + PAUSA_MS; }}
    >
      <div
        ref={pista}
        onScroll={medir}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => (
          <div key={i} className="w-[88%] shrink-0 snap-start md:w-[calc((100%-0.75rem)/2)]">
            {s}
          </div>
        ))}
      </div>

      {hayAtras && (
        <button type="button" onClick={() => mover(-1)} aria-label="Banner anterior" className={`${flecha} -left-3`}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 6-6 6 6 6" /></svg>
        </button>
      )}
      {hayAdelante && (
        <button type="button" onClick={() => mover(1)} aria-label="Banner siguiente" className={`${flecha} -right-3`}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        </button>
      )}
    </div>
  );
}
