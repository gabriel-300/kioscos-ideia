"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cerrarSesionCliente, ingresarConGoogle } from "@/lib/pedidos/acceso-cliente";
import type { ConfigTienda } from "../_lib/tipos";

// Ingreso del cliente desde la cabecera de la tienda: "Ingresar con Google" o, ya adentro, su
// nombre y "Salir". Es opcional: se puede pedir sin cuenta (ver BeneficioCliente en el pago).
export function BotonCuenta({ config }: { config: ConfigTienda }) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cliente = config.cliente;

  async function ingresar() {
    setTrabajando(true);
    setError(null);
    const r = await ingresarConGoogle();
    if (r.error) { setError(r.error); setTrabajando(false); }
  }

  async function salir() {
    setTrabajando(true);
    await cerrarSesionCliente();
    router.refresh();
    setTrabajando(false);
  }

  const pastilla = "pd-display inline-flex h-9 items-center rounded-full border border-white/30 bg-black/55 px-3.5 text-[12.5px] font-bold text-pd-cream backdrop-blur-sm active:bg-black/70 disabled:opacity-60";

  return (
    <div className="absolute right-0 top-0 z-10 flex flex-col items-end gap-1.5">
      {cliente || config.sesionActiva ? (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-black/55 px-3 py-1.5 text-[12.5px] font-semibold text-pd-cream backdrop-blur-sm">
            {cliente ? `Hola, ${cliente.nombre?.trim().split(/\s+/)[0] || "bienvenido"}` : "Sesión iniciada"}
          </span>
          <button type="button" onClick={salir} disabled={trabajando} className={pastilla}>Salir</button>
        </div>
      ) : (
        <button type="button" onClick={ingresar} disabled={trabajando} className={pastilla}>
          {trabajando ? "Abriendo Google…" : "Ingresar con Google"}
        </button>
      )}
      {error && <p className="max-w-[220px] rounded-lg bg-black/60 px-2.5 py-1.5 text-right text-[11.5px] leading-snug text-pd-cream">{error}</p>}
    </div>
  );
}
