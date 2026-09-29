"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Vuelve a pedir la página al servidor cada pocos segundos mientras el pedido
// esté en curso, para que el cliente vea el avance sin recargar.
const INTERVALO_MS = 15_000;

export function AutoRefrescar() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), INTERVALO_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
