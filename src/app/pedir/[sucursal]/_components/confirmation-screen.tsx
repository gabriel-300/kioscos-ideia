"use client";

import Link from "next/link";
import type { ConfigTienda, PedidoConfirmado } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import type { EstadoHorario } from "@/lib/pedidos/horario";
import { IconCheck } from "./iconos";
import { Panel } from "./panel";

export function ConfirmationScreen({ config, pedido, horario, onVolver }: {
  config: ConfigTienda; pedido: PedidoConfirmado; horario: EstadoHorario; onVolver: () => void;
}) {
  const eta = pedido.etaMin != null ? `${pedido.etaMin}–${pedido.etaMax} min` : null;

  return (
    <Panel fondo="bg-pd-ink text-pd-paper" z="z-50" animacion="pd-fadein"><div className="flex flex-1 flex-col overflow-y-auto px-5 pb-8 pt-16 md:pt-14">
      <div className="pd-popin flex size-[66px] items-center justify-center rounded-full bg-pd-success-lt text-white">
        <IconCheck className="size-8" />
      </div>
      <h2 className="mt-5 text-[29px]">{pedido.medioPago === "mercadopago_link" ? "Falta pagar" : "Pedido confirmado"}</h2>
      <p className="mt-2 text-[14.5px] leading-snug text-pd-cream/80">
        {pedido.medioPago !== "mercadopago_link"
          ? "Ya recibimos tu pedido. Seguilo desde acá y te mostramos cada paso."
          : pedido.checkoutUrl
            ? "Pagalo ahora con tarjeta o Mercado Pago y empezamos a prepararlo."
            : "El local te manda el link de pago por WhatsApp para confirmar."}{" "}
        Pedido <strong className="text-pd-paper">#{pedido.numero}</strong>
      </p>

      <div className="mt-6 rounded-[22px] border border-white/15 p-5" style={{ background: "rgba(251,247,241,.07)" }}>
        {horario.abierto ? (
          eta && (
            <>
              <p className="text-[12.5px] font-bold tracking-[0.06em] text-pd-cream/70">{pedido.tipoEntrega === "delivery" ? "LLEGA EN" : "LISTO EN"}</p>
              <p className="pd-display mt-1 text-[27px] font-extrabold">{eta}</p>
            </>
          )
        ) : (
          <>
            <p className="text-[12.5px] font-bold tracking-[0.06em] text-pd-cream/70">LO PREPARAMOS AL ABRIR</p>
            <p className="pd-display mt-1 text-[24px] font-extrabold">{horario.proximaApertura ?? "apenas abramos"}</p>
          </>
        )}
        <p className="mt-2 text-[13.5px] text-pd-cream/75">
          {pedido.tipoEntrega === "delivery"
            ? `Envío a domicilio${pedido.zonaNombre ? ` · ${pedido.zonaNombre}` : ""}`
            : `Retiro en ${config.nombre}`}
        </p>
        {pedido.descuento > 0 && (
          <p className="mt-3 text-[13.5px] text-pd-cream/75">Descuento cliente registrado: −{fmt(pedido.descuento)}</p>
        )}
        <div className="mt-4 flex items-baseline justify-between border-t border-white/15 pt-4">
          <span className="text-[13.5px] text-pd-cream/75">Total · {pedido.medioPago === "efectivo" ? "Efectivo" : "Mercado Pago"}</span>
          <span className="pd-display text-[24px] font-extrabold tabular-nums">{fmt(pedido.total)}</span>
        </div>
      </div>

      <div className="mt-auto space-y-3 pt-8">
        {pedido.medioPago === "mercadopago_link" && pedido.checkoutUrl && (
          <a
            href={pedido.checkoutUrl}
            // Color en línea: la regla global `a { color: inherit }` le gana a las clases text-*.
            style={{ color: "#fff" }}
            className="pd-display flex h-14 w-full items-center justify-center rounded-2xl bg-pd-ember text-[16px] font-bold active:bg-pd-ember-dark"
          >
            Pagar {fmt(pedido.total)}
          </a>
        )}
        <Link
          href={`/pedir/${config.sucursalId}/pedido/${pedido.pedidoId}`}
          // El color va en línea: en un enlace, la regla global `a { color: inherit }` le gana a la
          // clase text-pd-ink y el texto quedaba crema sobre crema (botón en blanco).
          style={{ color: "var(--color-pd-ink)" }}
          className="pd-display flex h-14 w-full items-center justify-center rounded-2xl bg-pd-paper text-[16px] font-bold"
        >
          Seguir mi pedido
        </Link>
        <button
          type="button"
          onClick={onVolver}
          className="pd-display h-14 w-full rounded-2xl border-[1.5px] border-white/25 text-[16px] font-bold text-pd-paper"
        >
          Volver al menú
        </button>
      </div>
    </div></Panel>
  );
}
