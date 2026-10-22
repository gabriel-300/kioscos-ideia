"use client";

import { useState } from "react";
import { calcularBeneficio, describirBeneficio } from "@/lib/pedidos/beneficio-cliente";
import { ingresarConGoogle } from "@/lib/pedidos/acceso-cliente";
import type { ConfigTienda } from "../_lib/tipos";

// La oferta de bienvenida, a la vista desde la entrada: "10% de descuento en tu primera compra" con el
// ingreso con Google al lado. Para el cliente que ya ingresó y todavía tiene beneficio, le recuerda que
// se le aplica solo. Sin beneficio configurado, o con una cuenta del personal, no aparece.
export function FranjaBeneficio({ config, className = "" }: { config: ConfigTienda; className?: string }) {
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const texto = describirBeneficio(config.beneficio);
  const cliente = config.cliente;
  if (!texto) return null;
  if (config.sesionActiva && !cliente) return null; // cuenta del personal

  if (cliente) {
    const aplica = calcularBeneficio({ subtotal: 100, esCliente: true, esPrimeraCompra: cliente.primeraCompra, esDelivery: true, config: config.beneficio });
    if (!(aplica.descuentoProductos > 0 || aplica.envioBonificado)) return null;
    return (
      <div className={`rounded-2xl bg-pd-success px-4 py-3 text-white ${className}`} data-testid="franja-beneficio">
        <p className="pd-display text-[15px] font-bold leading-tight">{texto}</p>
        <p className="mt-0.5 text-[12.5px] text-white/85">Ya está aplicado: lo ves al confirmar tu pedido.</p>
      </div>
    );
  }

  async function ingresar() {
    setTrabajando(true);
    setError(null);
    const r = await ingresarConGoogle();
    if (r.error) { setError(r.error); setTrabajando(false); }
  }

  return (
    <div className={`rounded-2xl bg-pd-ember px-4 py-3 text-white ${className}`} data-testid="franja-beneficio">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="pd-display text-[15px] font-bold leading-tight">{texto}</p>
          <p className="mt-0.5 text-[12.5px] text-white/85">Ingresá con Google y se aplica solo.</p>
        </div>
        <button
          type="button"
          onClick={ingresar}
          disabled={trabajando}
          // Color en línea: la regla global `a { color: inherit }` no pisa botones, pero así queda igual en todos lados.
          style={{ color: "var(--color-pd-ember-dark)" }}
          className="pd-display h-10 shrink-0 rounded-full bg-white px-4 text-[13.5px] font-bold active:bg-pd-cream disabled:opacity-60"
        >
          {trabajando ? "Abriendo…" : "Ingresar"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] font-medium text-white">{error}</p>}
    </div>
  );
}
