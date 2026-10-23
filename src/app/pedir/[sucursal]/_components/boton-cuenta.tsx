"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cerrarSesionCliente, ingresarConGoogle } from "@/lib/pedidos/acceso-cliente";
import type { ConfigTienda } from "../_lib/tipos";

// Ingreso del cliente en la barra de arriba: "Ingresar" (con Google) o, ya adentro, su nombre y
// "Salir". Es opcional: se puede pedir sin cuenta (ver FranjaBeneficio y BeneficioCliente).
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

  const pastilla = "pd-display inline-flex h-10 items-center rounded-full border border-pd-line-strong bg-white px-3.5 text-[13px] font-bold text-pd-ink-900 active:bg-pd-warm disabled:opacity-60";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
      <Link href={`/pedir/${config.sucursalId}/mis-pedidos`} className={pastilla} style={{ color: "var(--color-pd-ink)" }}>Mis pedidos</Link>
      {cliente || config.sesionActiva ? (
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-pd-ink-900">
            {cliente ? `Hola, ${cliente.nombre?.trim().split(/\s+/)[0] || "bienvenido"}` : "Sesión iniciada"}
          </span>
          <button type="button" onClick={salir} disabled={trabajando} className={pastilla}>Salir</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={ingresar}
          disabled={trabajando}
          aria-label="Ingresar con Google"
          title="Ingresar con Google"
          className={`${pastilla} gap-2`}
        >
          <svg viewBox="0 0 24 24" className="size-[19px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
          </svg>
          <span>{trabajando ? "Abriendo…" : "Ingresar"}</span>
        </button>
      )}
      </div>
      {error && <p className="max-w-[220px] rounded-lg bg-pd-warm px-2.5 py-1.5 text-right text-[11.5px] leading-snug text-pd-ink-900">{error}</p>}
    </div>
  );
}
