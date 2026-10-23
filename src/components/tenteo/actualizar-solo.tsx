"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Vuelve a pedir los datos de la pantalla cada tanto, sin que la persona recargue: lo que llega mientras
// la tiene abierta aparece solo. No hace nada con la pestaña oculta, y al volver a ella actualiza enseguida.
export function ActualizarSolo({ cadaMs = 15_000 }: { cadaMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const actualizar = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(actualizar, cadaMs);
    document.addEventListener("visibilitychange", actualizar);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", actualizar); };
  }, [router, cadaMs]);

  return null;
}
