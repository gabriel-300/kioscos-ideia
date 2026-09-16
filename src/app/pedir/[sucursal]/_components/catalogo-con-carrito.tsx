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
      <div className={`rounded-xl border overflow-hidden ${qty > 0 ? "border-tierra-700" : "border-neutral-200"} bg-white`}>
        <div className="aspect-square bg-neutral-100 relative flex items-center justify-center">
          {item.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-display font-semibold text-neutral-300">
              {item.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
            </span>
          )}
          {item.badge && (
            <span className="absolute top-1.5 left-1.5 text-[10px] font-bold uppercase tracking-wide bg-tierra-700 text-white px-2 py-0.5 rounded-full">
              {item.badge}
            </span>
          )}
        </div>
        <div className="p-2.5">
          <p className="text-sm font-medium text-neutral-900 leading-tight line-clamp-2">{item.name}</p>
          <p className="text-sm font-bold text-tierra-700 mt-1">
            {item.price > 0 ? AR.format(item.price) : "Consultar"}{item.unit && <span className="text-xs font-normal text-neutral-400"> {item.unit}</span>}
          </p>
          {item.price > 0 && (
            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={() => cambiarCantidad(item.id, -1)}
                disabled={qty === 0}
                className="size-7 rounded-lg border border-neutral-300 text-neutral-600 font-bold disabled:opacity-30"
              >−</button>
              <span className="text-sm font-bold tabular-nums">{qty}</span>
              <button
                type="button"
                onClick={() => cambiarCantidad(item.id, 1)}
                className="size-7 rounded-lg bg-tierra-700 text-white font-bold"
              >+</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8 pb-24">
        {itemsSinCategoria.length > 0 && (
          <section id="promos">
            <h2 className="text-lg font-display font-semibold text-neutral-900 mb-3">Promos</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {itemsSinCategoria.map((item) => <ItemCard key={item.id} item={item} />)}
            </div>
          </section>
        )}
        {categorias.map((c) => (
          <section key={c.id} id={`cat-${c.id}`}>
            <h2 className="text-lg font-display font-semibold text-neutral-900 mb-3">{c.name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {c.items.map((item) => <ItemCard key={item.id} item={item} />)}
            </div>
          </section>
        ))}
      </div>

      {/* Barra de carrito flotante */}
      {unidadesCarrito > 0 && !checkoutOpen && (
        <button
          type="button"
          onClick={abrirCheckout}
          className="fixed bottom-0 left-0 right-0 z-20 bg-tierra-700 text-white px-4 py-3.5 flex items-center justify-between shadow-lg"
        >
          <span className="text-sm font-semibold">{unidadesCarrito} {unidadesCarrito === 1 ? "producto" : "productos"}</span>
          <span className="text-base font-bold">Ver pedido — {AR.format(totalCarrito)}</span>
        </button>
      )}

      {/* Modal de checkout */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/40" onClick={() => { if (!pedido) { setCheckoutOpen(false); setUpsell(null); } }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            {!pedido ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-display font-semibold">Tu pedido</h3>
                  <button type="button" onClick={() => { setCheckoutOpen(false); setUpsell(null); }} className="text-neutral-400 text-xl">✕</button>
                </div>
                <div className="space-y-2 mb-4">
                  {carrito.map(([id, qty]) => {
                    const item = itemsMap.get(id)!;
                    return (
                      <div key={id} className="flex justify-between text-sm">
                        <span className="text-neutral-700">{qty}× {item.name}</span>
                        <span className="font-semibold tabular-nums">{AR.format(qty * item.price)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-base font-bold pt-2 border-t border-neutral-200">
                    <span>Total</span><span>{AR.format(totalCarrito)}</span>
                  </div>
                </div>
                {upsell && (
                  <div className="flex items-center gap-2 mb-4 p-2.5 rounded-lg bg-crema-50 border border-crema-100">
                    <p className="flex-1 text-xs text-neutral-700">{upsell.mensaje}</p>
                    <button
                      type="button"
                      onClick={agregarUpsell}
                      className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-tierra-700 text-white"
                    >
                      Agregar {AR.format(upsell.price)}
                    </button>
                    <button type="button" onClick={() => setUpsell(null)} className="shrink-0 text-neutral-400 text-sm px-1">✕</button>
                  </div>
                )}
                <div className="flex rounded-lg border border-neutral-300 overflow-hidden mb-2">
                  <button
                    type="button"
                    onClick={() => setTipoEntrega("retiro_local")}
                    className={`flex-1 h-10 text-sm font-semibold ${tipoEntrega === "retiro_local" ? "bg-tierra-700 text-white" : "bg-white text-neutral-600"}`}
                  >
                    Retiro en local
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoEntrega("delivery")}
                    className={`flex-1 h-10 text-sm font-semibold ${tipoEntrega === "delivery" ? "bg-tierra-700 text-white" : "bg-white text-neutral-600"}`}
                  >
                    Delivery
                  </button>
                </div>
                <input
                  type="text" placeholder="Tu nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                  className="w-full h-10 rounded-lg border border-neutral-300 px-3 text-sm mb-2"
                />
                <input
                  type="tel" placeholder="Tu teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)}
                  className="w-full h-10 rounded-lg border border-neutral-300 px-3 text-sm mb-2"
                />
                {tipoEntrega === "delivery" && (
                  <textarea
                    placeholder="Dirección de entrega" value={direccion} onChange={(e) => setDireccion(e.target.value)} rows={2}
                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-2"
                  />
                )}
                <textarea
                  placeholder="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm mb-3"
                />
                {error && <p className="text-xs text-danger mb-3">{error}</p>}
                <p className="text-xs text-neutral-400 mb-3">
                  {tipoEntrega === "delivery" ? "Te lo llevamos a la dirección que dejaste." : "Retirás el pedido en el local."} Pagás con QR de Mercado Pago al confirmar.
                </p>
                <button
                  type="button"
                  onClick={confirmarPedido}
                  disabled={pending}
                  className="w-full h-11 rounded-lg bg-tierra-700 text-white font-bold disabled:opacity-50"
                >
                  {pending ? "Confirmando…" : `Confirmar pedido — ${AR.format(totalCarrito)}`}
                </button>
              </>
            ) : (
              <div className="text-center py-4">
                <h3 className="text-lg font-display font-semibold mb-2">
                  {estadoPedido === "pagado" ? "¡Pedido confirmado!" : estadoPedido === "expirado" || estadoPedido === "cancelado" ? "El pedido venció" : "Esperando el pago…"}
                </h3>
                <p className="text-2xl font-bold text-tierra-700 mb-3">{AR.format(pedido.total)}</p>
                {error && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">{error}</p>}
                {estadoPedido === "pendiente_pago" && !error && (
                  <p className="text-sm text-neutral-500">Escaneá el QR para pagar (se muestra acá apenas esté listo).</p>
                )}
                <button
                  type="button"
                  onClick={() => { setCheckoutOpen(false); setPedido(null); setCantidades({}); setEstadoPedido(null); setUpsell(null); setTipoEntrega("retiro_local"); setDireccion(""); }}
                  className="mt-4 text-sm text-neutral-500 underline"
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
