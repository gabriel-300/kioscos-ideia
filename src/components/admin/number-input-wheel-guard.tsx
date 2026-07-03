"use client";

import { useEffect } from "react";

/**
 * Los inputs type="number" cambian de valor con el scroll del mouse cuando
 * están enfocados (comportamiento nativo del navegador) — causó que un precio
 * tipeado como 2600 quedara guardado como 2599 por un scroll accidental.
 * Esto blurrea cualquier input numérico enfocado apenas detecta wheel.
 */
export function NumberInputWheelGuard() {
  useEffect(() => {
    function handleWheel() {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number") {
        el.blur();
      }
    }
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => document.removeEventListener("wheel", handleWheel);
  }, []);

  return null;
}
