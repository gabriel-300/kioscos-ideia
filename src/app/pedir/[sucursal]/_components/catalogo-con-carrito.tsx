"use client";

import { useState, useTransition } from "react";
import { iniciarPedido, consultarEstadoPedidoPublico, sugerirUpsellPublico } from "@/lib/pedidos/actions";

type Upsell = { id: string; esPromo: boolean; name: string; price: number; mensaje: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type ItemCatalogo = {
  id: string;            // product_id o promo_id
  esPromo: boolean;
  name: string;
  price: number;
  image: string | null;
  badge?: string;
  unit?: string;
  category_id: string | null;
};
export type CategoriaConItems = { id: string; name: string; items: ItemCatalogo[] };

export function CatalogoConCarrito({
  sucursalId,
  categorias,
  itemsSinCategoria,
}: {
  sucursalId:        string;
  categorias:        CategoriaConItems[];
  itemsSinCategoria: ItemCatalogo[];
}) {
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [notas, setNotas] = useState("");
  const [tipoEntrega, setTipoEntrega] = useState<"retiro_local" | "delivery">("retiro_local");
  const [direccion, setDireccion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pedido, setPedido] = useState<{ pedido_id: string; total: number } | null>(null);
  const [estadoPedido, setEstadoPedido] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<Upsell | null>(null);

  const todosLosItems = [...itemsSinCategoria, ...categorias.flatMap((c) => c.items)];
  const itemsMap = new Map(todosLosItems.map((i) => [i.id, i]));

  const carrito = Object.entries(cantidades).filter(([, qty]) => qty > 0);
  const totalCarrito = carrito.reduce((s, [id, qty]) => s + qty * (itemsMap.get(id)?.price ?? 0), 0);
  const unidadesCarrito = carrito.reduce((s, [, qty]) => s + qty, 0);

  function cambiarCantidad(id: string, delta: number) {
    setCantidades((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
  }

  function abrirCheckout() {
    if (carrito.length === 0) return;
    setError(null);
    setUpsell(null);
    setCheckoutOpen(true);
    // Fase 4: sugerencia de IA para subir el ticket, mejor esfuerzo -- si
    // falla o tarda, el checkout sigue andando igual, no bloquea nada.
    sugerirUpsellPublico(sucursalId, carrito.map(([id]) => id))
      .then((res) => setUpsell(res))
      .catch(() => setUpsell(null));
  }

  function agregarUpsell() {
    if (!upsell) return;
    cambiarCantidad(upsell.id, 1);
    setUpsell(null);
  }

  function confirmarPedido() {
    if (!nombre.trim() || !telefono.trim()) {
      setError("Completá tu nombre y teléfono");
      return;
    }
    if (tipoEntrega === "delivery" && !direccion.trim()) {
      setError("Completá la dirección de entrega");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await iniciarPedido({
        sucursal_id: sucursalId,
        cliente_nombre: nombre,
        cliente_telefono: telefono,
        notas: notas || null,
        tipo_entrega: tipoEntrega,
        direccion_entrega: tipoEntrega === "delivery" ? direccion : null,
        items: carrito.map(([id, cantidad]) => {
          const item = itemsMap.get(id)!;
          return item.esPromo ? { promo_id: id, cantidad } : { product_id: id, cantidad };
        }),
      });
      if (res.error && !res.pedido_id) {
        setError(res.error);
        return;
      }
      if (res.pedido_id) {
        setPedido({ pedido_id: res.pedido_id, total: res.total ?? totalCarrito });
        setEstadoPedido("pendiente_pago");
        if (res.error) setError(res.error); // el pedido se creó pero el pago todavía no está conectado
        else {
          // Polling cada 3s, mismo intervalo que venta-rapida-form.tsx con consultarQrMercadoPago.
          const interval = setInterval(async () => {
            const estado = await consultarEstadoPedidoPublico(res.pedido_id!);
            if (estado.estado) {
              setEstadoPedido(estado.estado);
              if (estado.estado !== "pendiente_pago") clearInterval(interval);
            }
          }, 3000);
        }
      }
    });
  }

  function ItemCard({ item }: { item: ItemCatalogo }) {
    const qty = cantidades[item.id] ?? 0;
    return (
      <div
        className={`group rounded-2xl overflow-hidden bg-white transition-shadow ${
          qty > 0 ? "ring-2 ring-tierra-700 shadow-md shadow-tierra-700/10" : "ring-1 ring-neutral-200 shadow-sm hover:shadow-md"
        }`}
      >
        <div className="aspect-square bg-gradient-to-br from-crema-100 to-crema-50 relative flex items-center justify-center">
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <span className="flex items-center justify-center size-14 rounded-full bg-white text-tierra-700 font-display text-xl font-semibold shadow-sm">
              {item.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </span>
          )}
          {item.badge && (
            <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide bg-tierra-700 text-white px-2 py-0.5 rounded-full shadow-sm">
              {item.badge}
            </span>
          )}
          {qty > 0 && (
            <span className="absolute top-2 right-2 flex items-center justify-center size-6 rounded-full bg-tierra-700 text-white text-xs font-bold shadow-sm">
              {qty}
            </span>
          )}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium text-neutral-900 leading-tight line-clamp-2 min-h-[2.5em]">{item.name}</p>
          <p className="text-[15px] font-bold text-tierra-700 mt-1">
            {item.price > 0 ? AR.format(item.price) : "Consultar"}{item.unit && <span className="text-xs font-normal text-neutral-400"> {item.unit}</span>}
          </p>
          {item.price > 0 && (
            <div className="flex items-center justify-between mt-2.5 bg-crema-50 rounded-full p-1">
              <button
                type="button"
                onClick={() => cambiarCantidad(item.id, -1)}
                disabled={qty === 0}
                className="flex items-center justify-center size-7 rounded-full bg-white text-neutral-600 font-bold shadow-sm disabled:opacity-30 disabled:shadow-none active:scale-95 transition-transform"
              >−</button>
              <span className="text-sm font-bold tabular-nums text-neutral-800">{qty}</span>
              <button
                type="button"
                onClick={() => cambiarCantidad(item.id, 1)}
                className="flex items-center justify-center size-7 rounded-full bg-tierra-700 text-white font-bold shadow-sm active:scale-95 transition-transform"
              >+</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-9 pb-28">
        {itemsSinCategoria.length > 0 && (
          <section id="promos" className="scroll-mt-16">
            <h2 className="text-xl font-display font-semibold text-neutral-900 mb-3.5">Promos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
              {itemsSinCategoria.map((item) => <ItemCard key={item.id} item={item} />)}
            </div>
          </section>
        )}
        {categorias.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-16">
            <h2 className="text-xl font-display font-semibold text-neutral-900 mb-3.5">{c.name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
              {c.items.map((item) => <ItemCard key={item.id} item={item} />)}
            </div>
          </section>
        ))}
      </div>

      {/* Barra de carrito flotante */}
      {unidadesCarrito > 0 && !checkoutOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pb-4 pt-8 bg-gradient-to-t from-crema-50 via-crema-50/95 to-transparent pointer-events-none">
          <button
            type="button"
            onClick={abrirCheckout}
            className="pointer-events-auto w-full max-w-3xl mx-auto flex items-center justify-between gap-3 bg-tierra-700 text-white px-5 py-4 rounded-2xl shadow-xl shadow-tierra-800/25 active:scale-[0.98] transition-transform"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex items-center justify-center size-6 rounded-full bg-white/20 text-xs tabular-nums">{unidadesCarrito}</span>
              Ver pedido
            </span>
            <span className="text-base font-bold tabular-nums">{AR.format(totalCarrito)}</span>
          </button>
        </div>
      )}

      {/* Modal de checkout */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-neutral-900/50 backdrop-blur-[2px]" onClick={() => { if (!pedido) { setCheckoutOpen(false); setUpsell(null); } }}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[88vh] overflow-y-auto p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {!pedido ? (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-xl font-display font-semibold text-neutral-900">Tu pedido</h3>
                  <button
                    type="button"
                    onClick={() => { setCheckoutOpen(false); setUpsell(null); }}
                    className="flex items-center justify-center size-8 rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 transition-colors"
                  >✕</button>
                </div>
                <div className="space-y-2 mb-5 bg-crema-50 rounded-2xl p-4">
                  {carrito.map(([id, qty]) => {
                    const item = itemsMap.get(id)!;
                    return (
                      <div key={id} className="flex justify-between text-sm">
                        <span className="text-neutral-700">{qty}× {item.name}</span>
                        <span className="font-semibold tabular-nums text-neutral-900">{AR.format(qty * item.price)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-base font-bold pt-2.5 mt-1 border-t border-neutral-200/80">
                    <span>Total</span><span className="text-tierra-700">{AR.format(totalCarrito)}</span>
                  </div>
                </div>
                {upsell && (
                  <div className="flex items-center gap-2.5 mb-5 p-3 rounded-2xl bg-tierra-50 border border-tierra-100">
                    <span className="text-base shrink-0">💡</span>
                    <p className="flex-1 text-xs text-neutral-700 leading-snug">{upsell.mensaje}</p>
                    <button
                      type="button"
                      onClick={agregarUpsell}
                      className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-tierra-700 text-white whitespace-nowrap"
                    >
                      Agregar
                    </button>
                    <button type="button" onClick={() => setUpsell(null)} className="shrink-0 text-neutral-400 text-xs px-0.5">✕</button>
                  </div>
                )}

                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-2">Entrega</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setTipoEntrega("retiro_local")}
                    className={`flex flex-col items-center gap-1 py-3 rounded-2xl border-2 text-sm font-semibold transition-colors ${
                      tipoEntrega === "retiro_local" ? "border-tierra-700 bg-tierra-50 text-tierra-700" : "border-neutral-200 text-neutral-500"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
                    </svg>
                    Retiro en local
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoEntrega("delivery")}
                    className={`flex flex-col items-center gap-1 py-3 rounded-2xl border-2 text-sm font-semibold transition-colors ${
                      tipoEntrega === "delivery" ? "border-tierra-700 bg-tierra-50 text-tierra-700" : "border-neutral-200 text-neutral-500"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                    </svg>
                    Delivery
                  </button>
                </div>

                <div className="space-y-2.5 mb-3">
                  <input
                    type="text" placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                    className="w-full h-11 rounded-xl border border-neutral-200 bg-crema-50/60 px-3.5 text-sm focus:outline-none focus:border-tierra-700 focus:bg-white focus:ring-2 focus:ring-tierra-700/15 transition-colors"
                  />
                  <input
                    type="tel" placeholder="Tu teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)}
                    className="w-full h-11 rounded-xl border border-neutral-200 bg-crema-50/60 px-3.5 text-sm focus:outline-none focus:border-tierra-700 focus:bg-white focus:ring-2 focus:ring-tierra-700/15 transition-colors"
                  />
                  {tipoEntrega === "delivery" && (
                    <textarea
                      placeholder="Dirección de entrega" value={direccion} onChange={(e) => setDireccion(e.target.value)} rows={2}
                      className="w-full rounded-xl border border-neutral-200 bg-crema-50/60 px-3.5 py-2.5 text-sm focus:outline-none focus:border-tierra-700 focus:bg-white focus:ring-2 focus:ring-tierra-700/15 transition-colors"
                    />
                  )}
                  <textarea
                    placeholder="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                    className="w-full rounded-xl border border-neutral-200 bg-crema-50/60 px-3.5 py-2.5 text-sm focus:outline-none focus:border-tierra-700 focus:bg-white focus:ring-2 focus:ring-tierra-700/15 transition-colors"
                  />
                </div>
                {error && <p className="text-xs text-danger font-medium mb-3">{error}</p>}
                <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                  {tipoEntrega === "delivery" ? "Te lo llevamos a la dirección que dejaste." : "Retirás el pedido en el local."} Pagás con QR de Mercado Pago al confirmar.
                </p>
                <button
                  type="button"
                  onClick={confirmarPedido}
                  disabled={pending}
                  className="w-full h-12 rounded-2xl bg-tierra-700 text-white font-bold shadow-md shadow-tierra-700/25 disabled:opacity-50 active:scale-[0.98] transition-transform"
                >
                  {pending ? "Confirmando…" : `Confirmar pedido — ${AR.format(totalCarrito)}`}
                </button>
              </>
            ) : (
              <div className="text-center py-5">
                {estadoPedido === "pendiente_pago" && !error && (
                  <span className="relative flex size-3 mx-auto mb-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tierra-400 opacity-75" />
                    <span className="relative inline-flex rounded-full size-3 bg-tierra-600" />
                  </span>
                )}
                <h3 className="text-lg font-display font-semibold mb-2 text-neutral-900">
                  {estadoPedido === "pagado" ? "¡Pedido confirmado!" : estadoPedido === "expirado" || estadoPedido === "cancelado" ? "El pedido venció" : "Esperando el pago…"}
                </h3>
                <p className="text-3xl font-bold text-tierra-700 mb-3">{AR.format(pedido.total)}</p>
                {error && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-left leading-relaxed">{error}</p>}
                {estadoPedido === "pendiente_pago" && !error && (
                  <p className="text-sm text-neutral-500">Escaneá el QR para pagar (se muestra acá apenas esté listo).</p>
                )}
                <button
                  type="button"
                  onClick={() => { setCheckoutOpen(false); setPedido(null); setCantidades({}); setEstadoPedido(null); setUpsell(null); setTipoEntrega("retiro_local"); setDireccion(""); }}
                  className="mt-5 text-sm text-neutral-500 underline underline-offset-2"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
