"use client";

import type { ConfigTienda, PedidoConfirmado } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import type { EstadoHorario } from "@/lib/pedidos/horario";
import { IconCheck } from "./iconos";
import { Panel } from "./panel";

// Mensaje pre-armado para avisarle al local por WhatsApp. El pedido ya está
// guardado en el servidor -- esto es un aviso extra, no la fuente de verdad.
function mensajeWhatsApp(config: ConfigTienda, p: PedidoConfirmado): string {
  const l: string[] = [];
  l.push(`*Pedido #${p.numero}* — ${config.nombre}`);
  l.push("");
  for (const x of p.lineas) l.push(`${x.cantidad}× ${x.nombre} — ${fmt(x.subtotal)}`);
  l.push("");
  l.push(`Subtotal: ${fmt(p.subtotal)}`);
  if (p.tipoEntrega === "delivery") l.push(`Envío${p.zonaNombre ? ` (${p.zonaNombre})` : ""}: ${fmt(p.costoEnvio)}`);
  l.push(`*Total: ${fmt(p.total)}*`);
  l.push("");
  l.push(`Pago: ${p.medioPago === "efectivo" ? `Efectivo${p.pagoCon ? ` (paga con ${fmt(p.pagoCon)})` : ""}` : "Mercado Pago (mandame el link)"}`);
  l.push(p.tipoEntrega === "delivery" ? "Entrega: envío a domicilio" : "Entrega: retiro en el local");
  if (p.direccion) l.push(`Dirección: ${p.direccion}${p.referencia ? ` (${p.referencia})` : ""}`);
  l.push(`Nombre: ${p.cliente.nombre}`);
  l.push(`WhatsApp: ${p.cliente.whatsapp}`);
  if (p.notas) l.push(`Aclaraciones: ${p.notas}`);
  return l.join("\n");
}

export function ConfirmationScreen({ config, pedido, horario, onVolver }: {
  config: ConfigTienda; pedido: PedidoConfirmado; horario: EstadoHorario; onVolver: () => void;
}) {
  const telefono = config.whatsapp?.replace(/\D/g, "");
  const enlace = telefono ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensajeWhatsApp(config, pedido))}` : null;
  const eta = pedido.etaMin != null ? `${pedido.etaMin}–${pedido.etaMax} min` : null;

  return (
    <Panel fondo="bg-pd-ink text-pd-paper" z="z-50" animacion="pd-fadein"><div className="flex flex-1 flex-col overflow-y-auto px-5 pb-8 pt-16 md:pt-14">
      <div className="pd-popin flex size-[66px] items-center justify-center rounded-full bg-pd-success-lt text-white">
        <IconCheck className="size-8" />
      </div>
      <h2 className="mt-5 text-[29px]">Pedido confirmado</h2>
      <p className="mt-2 text-[14.5px] leading-snug text-pd-cream/80">
        {pedido.medioPago === "mercadopago_link"
          ? "Te mandamos el link de pago por WhatsApp para confirmar."
          : "Te escribimos al WhatsApp para confirmar."}{" "}
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
        <div className="mt-4 flex items-baseline justify-between border-t border-white/15 pt-4">
          <span className="text-[13.5px] text-pd-cream/75">Total · {pedido.medioPago === "efectivo" ? "Efectivo" : "Mercado Pago"}</span>
          <span className="pd-display text-[24px] font-extrabold tabular-nums">{fmt(pedido.total)}</span>
        </div>
      </div>

      <div className="mt-auto space-y-3 pt-8">
        {enlace && (
          <a
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
            className="pd-display flex h-14 w-full items-center justify-center rounded-2xl bg-pd-ember text-[16px] font-bold text-white"
          >
            Enviar pedido por WhatsApp
          </a>
        )}
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
