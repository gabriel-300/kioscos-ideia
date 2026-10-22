import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { armarSeguimiento, estadoDelPago, type PasoSeguimiento } from "@/lib/pedidos/seguimiento";
import { cargarLineasDePedidos } from "@/lib/pedidos/lineas-servidor";
import { enlaceDePagoDelPedido } from "@/lib/pedidos/checkout-mercadopago";
import { fmt, LOGO_MARCA } from "../../_lib/tema";
import { AutoRefrescar } from "./auto-refrescar";

// Seguimiento del pedido para el cliente, sin cuenta: el enlace lleva el id del
// pedido (uuid aleatorio), que solo conoce quien hizo el pedido. Se muestra lo
// mínimo -- nada del teléfono ni de la dirección -- por si el enlace se
// reenvía. Se refresca solo mientras el pedido siga en curso.
//
// Diseño: en computadora dos tarjetas (estado a la izquierda, resumen a la derecha); en celular, una
// debajo de la otra. Los pasos van en una línea horizontal con un ícono cada uno.

export const revalidate = 0;
export const metadata: Metadata = { title: "Seguí tu pedido", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIO: Record<string, string> = { efectivo: "Efectivo", mercadopago_link: "Mercado Pago", mercadopago_qr: "Mercado Pago" };

// Íconos de cada paso (trazo simple, 24x24).
const ICONOS: Record<string, React.ReactNode> = {
  pago:       <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /></>,
  recibido:   <path d="m5 12.5 4.5 4.5L19 7.5" />,
  preparando: <><path d="M7 3v7.5M4.5 3v5a2.5 2.5 0 0 0 5 0V3" /><path d="M7 11v10" /><path d="M17 3c-2.2 1.4-3.2 3.8-3.2 6.5 0 1.9 1 3 3.2 3V3Z" /><path d="M17 12.5V21" /></>,
  salida:     <><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  entregado:  <><circle cx="12" cy="12" r="9" /><path d="m8 12.2 2.8 2.8L16 9.5" /></>,
};

function Icono({ clave, className = "size-5" }: { clave: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONOS[clave] ?? ICONOS.recibido}
    </svg>
  );
}

function Pasos({ pasos }: { pasos: PasoSeguimiento[] }) {
  return (
    <ol className="mt-6 grid" style={{ gridTemplateColumns: `repeat(${pasos.length}, minmax(0, 1fr))` }}>
      {pasos.map((paso, i) => {
        const hecho = paso.estado === "hecho";
        const actual = paso.estado === "actual";
        return (
          <li key={paso.clave} className="relative flex flex-col items-center text-center" aria-current={actual ? "step" : undefined}>
            {/* tramo de línea a cada lado del círculo: verde hasta donde se llegó */}
            {i > 0 && <span aria-hidden className={`absolute left-0 top-5 h-[3px] w-1/2 ${paso.estado !== "pendiente" ? "bg-pd-success" : "bg-pd-line-strong"}`} />}
            {i < pasos.length - 1 && <span aria-hidden className={`absolute right-0 top-5 h-[3px] w-1/2 ${hecho ? "bg-pd-success" : "bg-pd-line-strong"}`} />}
            <span
              className={`relative z-10 flex size-10 items-center justify-center rounded-full ${
                hecho ? "bg-pd-success text-white" : actual ? "bg-pd-ember text-white ring-4 ring-pd-tint-line" : "border border-pd-line-strong bg-white text-pd-ink-300"
              }`}
            >
              <Icono clave={paso.clave} />
            </span>
            <span className={`mt-2 px-0.5 text-[11.5px] leading-tight ${actual ? "font-bold text-pd-ink-900" : hecho ? "text-pd-ink-600" : "text-pd-ink-300"}`}>
              {paso.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

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
  const pago = estadoDelPago(pedido);
  // Si el pago todavía no entró, el botón para pagar (el enlace se generó al hacer el pedido).
  const enlacePago = pedido.estado === "pendiente_pago" ? await enlaceDePagoDelPedido(admin, pedidoId) : null;
  const delivery = pedido.tipo_entrega === "delivery";
  const primerNombre = (pedido.cliente_nombre as string | null)?.trim().split(/\s+/)[0];
  const telefonoLocal = (pedido.sucursales?.whatsapp_pedidos as string | null)?.replace(/\D/g, "");
  const eta = pedido.eta_min != null && !seg.final ? `${pedido.eta_min}–${pedido.eta_max} min` : null;
  const consulta = telefonoLocal ? `https://wa.me/${telefonoLocal}?text=${encodeURIComponent(`Hola, te consulto por mi pedido #${pedido.numero}`)}` : null;
  const nombreLocal = (pedido.sucursales?.nombre as string | undefined)?.trim() ?? "el local";
  const cantidadProductos = lineas.length;

  const tonoPago = { ok: "bg-pd-success/15 text-pd-success", aviso: "bg-pd-warn text-pd-warn-ink", neutro: "bg-pd-warm text-pd-ink-600" };

  return (
    <div className="min-h-screen bg-pd-paper">
      {!seg.final && <AutoRefrescar />}

      {/* Barra de arriba: volver al menú, la marca y la consulta directa */}
      <header className="border-b border-pd-line bg-white">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3 px-4 py-3">
          <Link href={`/pedir/${sucursalId}`} aria-label="Volver al menú" className="flex min-w-0 items-center gap-3" style={{ color: "var(--color-pd-ink)" }}>
            <span aria-hidden className="text-[22px] leading-none">←</span>
            {LOGO_MARCA && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={LOGO_MARCA.srcOscuro} alt={LOGO_MARCA.alt} width={LOGO_MARCA.ancho} height={LOGO_MARCA.alto} className="h-[30px] w-auto" />
            )}
            <span className="pd-display hidden truncate text-[15px] font-bold sm:inline">{nombreLocal.replace(/^angiru food\s+/i, "")}</span>
          </Link>
          {consulta && (
            <a
              href={consulta}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-pd-ink)" }}
              className="pd-display inline-flex h-10 shrink-0 items-center rounded-full border border-pd-line-strong bg-white px-4 text-[13.5px] font-bold"
            >
              Consultar sobre tu pedido
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1000px] gap-4 px-4 pb-12 pt-5 md:grid-cols-[1.05fr_1fr] md:items-start md:pt-8">
        {/* Estado del pedido */}
        <section className="rounded-3xl border border-pd-line bg-white p-5 md:p-7">
          <h1 className="text-[28px] leading-tight md:text-[32px]">{seg.titulo}</h1>
          <p className="mt-1.5 text-[14px] text-pd-ink-600">
            Pedido #{pedido.numero} · {delivery ? "Envío a domicilio" : "Retiro en el local"}
          </p>
          <p className="mt-3 text-[14.5px] leading-snug text-pd-ink-600">
            {primerNombre ? `${primerNombre}, ` : ""}{seg.detalle.charAt(0).toLowerCase() + seg.detalle.slice(1)}
          </p>
          {eta && <p className="mt-2 text-[14px] font-semibold text-pd-ink-900">{delivery ? "Llega en" : "Listo en"} unos {eta}</p>}

          {seg.pasos.length > 0 && <Pasos pasos={seg.pasos} />}

          {enlacePago && (
            <a
              href={enlacePago}
              // Color en línea: la regla global `a { color: inherit }` le gana a las clases text-*.
              style={{ color: "#fff" }}
              className="pd-display mt-7 flex h-14 w-full items-center justify-center rounded-2xl bg-pd-ember text-[16px] font-bold active:bg-pd-ember-dark"
            >
              Pagar {fmt(pedido.total)}
            </a>
          )}

          <dl className="mt-7 space-y-4 border-t border-pd-line pt-5 text-[14px]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <dt className="text-[12.5px] text-pd-ink-400">Método de pago</dt>
                <dd className="text-[15px] font-bold">{MEDIO[pedido.medio_pago] ?? "A confirmar"} · {fmt(pedido.total)}</dd>
              </div>
              {pago && <span className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] font-bold ${tonoPago[pago.tono]}`}>{pago.texto}</span>}
            </div>
          </dl>
        </section>

        {/* Resumen del pedido */}
        <section className="rounded-3xl border border-pd-line bg-white p-5 md:p-7">
          <p className="text-[12.5px] text-pd-ink-400">Resumen del pedido</p>
          <p className="text-[16px] font-bold">{cantidadProductos} {cantidadProductos === 1 ? "producto" : "productos"} · {fmt(pedido.total)}</p>

          <ul className="mt-4 space-y-3 border-t border-pd-line pt-4 text-[14px] text-pd-ink-900">
            {lineas.map((l, i) => (
              <li key={i}>
                <span className="font-semibold">{l.titulo}</span>
                {l.componentes.length > 0 && (
                  <span className="block text-[12.5px] text-pd-ink-400">{l.componentes.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-pd-line pt-4 text-[14px]">
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
            <div className="flex justify-between text-[17px] font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{fmt(pedido.total)}</dd>
            </div>
          </dl>
        </section>

        <div className="md:col-span-2">
          <Link
            href={`/pedir/${sucursalId}`}
            style={{ color: "#fff" }}
            className="pd-display flex h-12 w-full items-center justify-center rounded-2xl bg-pd-ember text-[15px] font-bold md:mx-auto md:max-w-[360px]"
          >
            Volver al menú
          </Link>
        </div>
      </main>
    </div>
  );
}
