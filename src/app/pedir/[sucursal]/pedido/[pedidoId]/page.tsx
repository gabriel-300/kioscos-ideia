import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { armarSeguimiento } from "@/lib/pedidos/seguimiento";
import { cargarLineasDePedidos } from "@/lib/pedidos/lineas-servidor";
import { enlaceDePagoDelPedido } from "@/lib/pedidos/checkout-mercadopago";
import { fmt } from "../../_lib/tema";
import { AutoRefrescar } from "./auto-refrescar";

// Seguimiento del pedido para el cliente, sin cuenta: el enlace lleva el id del
// pedido (uuid aleatorio), que solo conoce quien hizo el pedido. Se muestra lo
// mínimo -- nada del teléfono ni de la dirección -- por si el enlace se
// reenvía. Se refresca solo mientras el pedido siga en curso.

export const revalidate = 0;
export const metadata: Metadata = { title: "Seguí tu pedido", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIO: Record<string, string> = { efectivo: "Efectivo", mercadopago_link: "Mercado Pago", mercadopago_qr: "Mercado Pago" };

export default async function SeguimientoPage({ params }: { params: Promise<{ sucursal: string; pedidoId: string }> }) {
  const { sucursal: sucursalId, pedidoId } = await params;
  if (!UUID.test(pedidoId) || !UUID.test(sucursalId)) notFound();

  const admin = createAdminClient();
  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("id, numero, estado, tipo_entrega, medio_pago, subtotal, costo_envio, descuento_total, total, zona_nombre, eta_min, eta_max, cliente_nombre, sucursal_id, sucursales(nombre, whatsapp_pedidos)")
    .eq("id", pedidoId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle();
  // Un pedido que todavía es un "carrito" del bot no es un pedido para el cliente.
  if (!pedido || pedido.estado === "carrito") notFound();

  // Lo que pidió, igual que lo ve el personal (lib/pedidos/lineas).
  const lineas = (await cargarLineasDePedidos(admin, [pedidoId])).get(pedidoId) ?? [];

  const seg = armarSeguimiento(pedido);
  // Si el pago todavía no entró, el botón para pagar (el enlace se generó al hacer el pedido).
  const enlacePago = pedido.estado === "pendiente_pago" ? await enlaceDePagoDelPedido(admin, pedidoId) : null;
  const delivery = pedido.tipo_entrega === "delivery";
  const primerNombre = (pedido.cliente_nombre as string | null)?.trim().split(/\s+/)[0];
  const telefonoLocal = (pedido.sucursales?.whatsapp_pedidos as string | null)?.replace(/\D/g, "");
  const eta = pedido.eta_min != null && !seg.final ? `${pedido.eta_min}–${pedido.eta_max} min` : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-10 pt-8">
      {!seg.final && <AutoRefrescar />}

      <p className="text-[13px] font-bold tracking-[0.06em] text-pd-ink-400">
        {(pedido.sucursales?.nombre as string | undefined)?.toUpperCase()} · PEDIDO #{pedido.numero}
      </p>
      <h1 className="mt-2 text-[28px] leading-tight">{seg.titulo}</h1>
      <p className="mt-2 text-[14.5px] leading-snug text-pd-ink-600">
        {primerNombre ? `${primerNombre}, ` : ""}{seg.detalle.charAt(0).toLowerCase() + seg.detalle.slice(1)}
      </p>
      {eta && <p className="mt-3 text-[14px] font-semibold text-pd-ink-900">{delivery ? "Llega en" : "Listo en"} unos {eta}</p>}

      {seg.pasos.length > 0 && (
        <ol className="mt-7 space-y-0">
          {seg.pasos.map((paso, i) => (
            <li key={paso.clave} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-[12px] font-bold ${
                    paso.estado === "hecho" ? "bg-pd-success text-white"
                    : paso.estado === "actual" ? "bg-pd-ember text-white ring-4 ring-pd-tint-line"
                    : "bg-pd-warm text-pd-ink-300"
                  }`}
                >
                  {paso.estado === "hecho" ? "✓" : i + 1}
                </span>
                {i < seg.pasos.length - 1 && (
                  <span className={`h-7 w-0.5 ${paso.estado === "hecho" ? "bg-pd-success" : "bg-pd-line-strong"}`} />
                )}
              </div>
              <p className={`pt-0.5 text-[15px] ${paso.estado === "actual" ? "font-bold text-pd-ink-900" : paso.estado === "hecho" ? "text-pd-ink-600" : "text-pd-ink-300"}`}>
                {paso.label}
              </p>
            </li>
          ))}
        </ol>
      )}

      {enlacePago && (
        <a
          href={enlacePago}
          // Color en línea: la regla global `a { color: inherit }` le gana a las clases text-*.
          style={{ color: "#fff" }}
          className="pd-display mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-pd-ember text-[16px] font-bold active:bg-pd-ember-dark"
        >
          Pagar {fmt(pedido.total)}
        </a>
      )}

      <section className="mt-8 rounded-2xl border border-pd-line bg-white p-5">
        <h2 className="text-[15px] font-bold">Tu pedido</h2>
        <ul className="mt-3 space-y-2 text-[14px] text-pd-ink-900">
          {lineas.map((l, i) => (
            <li key={i}>
              {l.titulo}
              {l.componentes.length > 0 && (
                <span className="block text-[12.5px] text-pd-ink-400">{l.componentes.join(" · ")}</span>
              )}
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-pd-line pt-4 text-[14px]">
          <div className="flex justify-between text-pd-ink-600"><dt>Subtotal</dt><dd className="tabular-nums">{fmt(pedido.subtotal)}</dd></div>
          {Number(pedido.descuento_total) > 0 && (
            <div className="flex justify-between text-pd-success"><dt>Descuento cliente registrado</dt><dd className="tabular-nums">−{fmt(pedido.descuento_total)}</dd></div>
          )}
          {delivery && (
            <div className="flex justify-between text-pd-ink-600">
              <dt>Envío{pedido.zona_nombre ? ` · ${pedido.zona_nombre}` : ""}</dt>
              <dd className="tabular-nums">{Number(pedido.costo_envio) === 0 ? "Gratis" : fmt(pedido.costo_envio)}</dd>
            </div>
          )}
          <div className="flex justify-between text-[16px] font-bold">
            <dt>Total · {MEDIO[pedido.medio_pago] ?? ""}</dt>
            <dd className="tabular-nums">{fmt(pedido.total)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] text-pd-ink-400">{delivery ? "Envío a domicilio" : `Retiro en ${pedido.sucursales?.nombre ?? "el local"}`}</p>
      </section>

      <div className="mt-6 space-y-3">
        {telefonoLocal && (
          <a
            href={`https://wa.me/${telefonoLocal}?text=${encodeURIComponent(`Hola, te consulto por mi pedido #${pedido.numero}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="pd-display flex h-12 w-full items-center justify-center rounded-2xl border-[1.5px] border-pd-line-strong text-[15px] font-bold text-pd-ink-900"
          >
            Consultar al local por WhatsApp
          </a>
        )}
        <Link href={`/pedir/${sucursalId}`} className="pd-display flex h-12 w-full items-center justify-center rounded-2xl bg-pd-ember text-[15px] font-bold text-white">
          Volver al menú
        </Link>
      </div>
    </main>
  );
}
