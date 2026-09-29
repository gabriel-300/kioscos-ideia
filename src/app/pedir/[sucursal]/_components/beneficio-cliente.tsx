"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { calcularBeneficio, describirBeneficio } from "@/lib/pedidos/beneficio-cliente";
import type { ConfigTienda } from "../_lib/tipos";

// Invitación a ingresar con Google (cuando la sucursal tiene algún beneficio
// configurado) o, si ya ingresó, el estado de su cuenta. Pedir sin cuenta sigue
// siendo posible: esto nunca bloquea el checkout.

export function BeneficioCliente({ config }: { config: ConfigTienda }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const texto = describirBeneficio(config.beneficio);
  const cliente = config.cliente;

  async function ingresar() {
    setTrabajando(true);
    setError(null);
    // El carrito vive en el navegador (localStorage): sobrevive al ida y vuelta con Google.
    const volver = `${window.location.origin}/auth/cliente/callback?next=${encodeURIComponent(window.location.pathname)}`;
    const { error: e } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: volver } });
    if (e) { setError("No pudimos abrir el ingreso con Google. Probá de nuevo en un rato."); setTrabajando(false); }
  }

  async function salir() {
    setTrabajando(true);
    await createClient().auth.signOut();
    router.refresh();
    setTrabajando(false);
  }

  if (cliente) {
    // ¿Todavía le corresponde algo? (ej. el descuento era solo para la primera compra)
    const aplica = calcularBeneficio({ subtotal: 100, esCliente: true, esPrimeraCompra: cliente.primeraCompra, esDelivery: true, config: config.beneficio });
    const vigente = aplica.descuentoProductos > 0 || aplica.envioBonificado;
    const primerNombre = cliente.nombre?.trim().split(/\s+/)[0];
    return (
      <section className="rounded-2xl border border-pd-line bg-pd-tint px-4 py-3.5">
        <p className="text-[14px] font-bold">Ingresaste{primerNombre ? ` como ${primerNombre}` : ""}</p>
        {texto && vigente && <p className="mt-0.5 text-[13px] text-pd-success">Tenés: {texto.charAt(0).toLowerCase() + texto.slice(1)}</p>}
        <button type="button" onClick={salir} disabled={trabajando} className="mt-1.5 text-[12.5px] font-semibold text-pd-ink-600 underline disabled:opacity-50">
          Salir
        </button>
      </section>
    );
  }

  if (!texto) return null;

  return (
    <section className="rounded-2xl border border-pd-tint-line bg-pd-tint px-4 py-3.5">
      <p className="text-[14px] font-bold">{texto} si ingresás</p>
      <p className="mt-0.5 text-[13px] text-pd-ink-600">Es opcional: también podés pedir sin cuenta.</p>
      <button
        type="button"
        onClick={ingresar}
        disabled={trabajando}
        className="pd-display mt-3 h-11 w-full rounded-xl border-[1.5px] border-pd-line-strong bg-white text-[14.5px] font-bold text-pd-ink-900 disabled:opacity-60"
      >
        {trabajando ? "Abriendo Google…" : "Ingresar con Google"}
      </button>
      {error && <p className="mt-2 text-[12.5px] font-medium text-pd-ember">{error}</p>}
    </section>
  );
}
