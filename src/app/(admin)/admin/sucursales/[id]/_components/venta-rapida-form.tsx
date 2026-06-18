"use client";

import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui";
import { crearMovimiento } from "@/app/(admin)/admin/movimientos/actions";
import type { Database } from "@/types/database";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = { id: string; name: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type PayMethod = "efectivo" | "mp" | "tarjeta" | "transferencia";

const PAY_METHODS: { id: PayMethod; label: string; icon: React.ReactNode }[] = [
  {
    id: "efectivo", label: "Efectivo",
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
      </svg>
    ),
  },
  {
    id: "mp", label: "Mercado Pago",
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3" />
      </svg>
    ),
  },
  {
    id: "tarjeta", label: "Tarjeta",
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  },
  {
    id: "transferencia", label: "Transferencia",
    icon: (
      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
];

type Receipt = {
  fecha: string;
  hora: string;
  items: { name: string; qty: number; precioUnit: number; sub: number }[];
  totalPrecio: number;
  totalUnidades: number;
  pagos: { label: string; monto: number }[];
  vuelto: number | null;
  notas: string | null;
};

interface Props {
  open:            boolean;
  onClose:         () => void;
  sucursalId:      string;
  sucursalNombre?: string;
  products:        Product[];
  stockMap?:       Record<string, number>;
  categories?:     Category[];
}

export function VentaRapidaForm({ open, onClose, sucursalId, sucursalNombre, products, stockMap, categories }: Props) {
  // POS state
  const [cantidades,  setCantidades] = useState<Record<string, number>>({});
  const [fecha,       setFecha]      = useState(() => new Date().toISOString().slice(0, 10));
  const [catFilter,   setCatFilter]  = useState("all");
  const [search,      setSearch]     = useState("");

  // Modal de cobro
  const [showPay,      setShowPay]      = useState(false);
  const [payMethod,    setPayMethod]    = useState<PayMethod>("efectivo");
  const [montoRecibido, setMontoRecibido] = useState("");
  const [notas,        setNotas]        = useState("");
  const [error,        setError]        = useState<string | null>(null);

  // Comprobante
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const [pending, startTransition] = useTransition();

  /* ── derivados ── */
  const catsConProductos = useMemo(() => {
    if (!categories?.length) return [];
    const ids = new Set(products.map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [categories, products]);

  const filtered = useMemo(() => {
    let list = catFilter === "all" ? products : products.filter((p) => p.category_id === catFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, catFilter, search]);

  const seleccionados = useMemo(
    () => Object.entries(cantidades).filter(([, qty]) => qty > 0),
    [cantidades]
  );

  const totalPrecio   = seleccionados.reduce((s, [id, qty]) => {
    const p = products.find((p) => p.id === id);
    return s + qty * (p?.precio_dist ?? 0);
  }, 0);
  const totalUnidades = seleccionados.reduce((s, [, qty]) => s + qty, 0);

  const monto  = parseFloat(montoRecibido) || 0;
  const vuelto = payMethod === "efectivo" && monto > 0 ? monto - totalPrecio : null;

  /* ── handlers ── */
  function set(id: string, value: number) {
    setCantidades((prev) => ({ ...prev, [id]: Math.max(0, value) }));
  }

  function resetForm() {
    setCantidades({});
    setFecha(new Date().toISOString().slice(0, 10));
    setSearch(""); setCatFilter("all");
    setShowPay(false); setPayMethod("efectivo");
    setMontoRecibido(""); setNotas(""); setError(null);
    setReceipt(null);
  }

  function handleClose() { resetForm(); onClose(); }

  function openPay() {
    setMontoRecibido("");
    setError(null);
    setShowPay(true);
  }

  function handleConfirm() {
    setError(null);
    const now  = new Date();
    const hora = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

    const receiptItems = seleccionados.map(([id, qty]) => {
      const p = products.find((p) => p.id === id)!;
      return { name: p?.name ?? "—", qty, precioUnit: p?.precio_dist ?? 0, sub: qty * (p?.precio_dist ?? 0) };
    });

    const metodo = PAY_METHODS.find((m) => m.id === payMethod)!;
    const pagos  = [{ label: metodo.label, monto: monto > 0 ? monto : totalPrecio }];

    const notasFinal = [
      `[${metodo.label}]`,
      notas || null,
    ].filter(Boolean).join(" — ") || null;

    startTransition(async () => {
      try {
        await crearMovimiento({
          sucursal_id: sucursalId,
          fecha,
          tipo:  "venta",
          notas: notasFinal,
          items: seleccionados.map(([product_id, cantidad]) => ({
            product_id,
            cantidad,
            precio_unitario: products.find((p) => p.id === product_id)?.precio_dist ?? null,
          })),
        });
        setShowPay(false);
        setReceipt({
          fecha: new Date(fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
          hora,
          items: receiptItems,
          totalPrecio,
          totalUnidades,
          pagos,
          vuelto: vuelto !== null && vuelto >= 0 ? vuelto : null,
          notas: notas || null,
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function handlePrint(r: Receipt) {
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comprobante</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; font-size:13px; padding:24px 20px; color:#111; }
  h1 { font-size:16px; font-weight:bold; text-align:center; margin-bottom:2px; }
  .sub { text-align:center; font-size:11px; color:#555; margin-bottom:12px; }
  .divider { border-top:1px dashed #bbb; margin:10px 0; }
  .row { display:flex; justify-content:space-between; margin-bottom:4px; }
  .name { flex:1; padding-right:8px; }
  .total-row { display:flex; justify-content:space-between; font-weight:bold; font-size:15px; margin-top:4px; }
  .pago-row { display:flex; justify-content:space-between; margin-bottom:3px; }
  .vuelto-row { display:flex; justify-content:space-between; font-weight:bold; margin-top:4px; }
  .footer { text-align:center; font-size:10px; color:#888; margin-top:16px; }
</style></head><body>
<h1>Kioscos IDEIA</h1>
<div class="sub">${sucursalNombre ?? ""}</div>
<div class="sub">${r.fecha} · ${r.hora}</div>
<div class="divider"></div>
${r.items.map((i) => `<div class="row"><span class="name">${i.name}</span><span>${i.qty} × ${AR.format(i.precioUnit)}</span><span style="margin-left:12px;min-width:80px;text-align:right">${AR.format(i.sub)}</span></div>`).join("")}
<div class="divider"></div>
<div class="total-row"><span>TOTAL (${r.totalUnidades} u.)</span><span>${AR.format(r.totalPrecio)}</span></div>
<div class="divider"></div>
${r.pagos.map((p) => `<div class="pago-row"><span>${p.label}</span><span>${AR.format(p.monto)}</span></div>`).join("")}
${r.vuelto !== null ? `<div class="vuelto-row"><span>VUELTO</span><span>${AR.format(r.vuelto)}</span></div>` : ""}
${r.notas ? `<div class="divider"></div><div style="font-size:11px;color:#555">${r.notas}</div>` : ""}
<div class="footer">Gracias por su compra</div>
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 200);
  }

  if (!open) return null;

  /* ── COMPROBANTE ── */
  if (receipt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="bg-selva-600 px-6 py-6 text-center">
            <div className="size-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
              <svg className="size-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-white font-bold text-lg font-display">Venta registrada</p>
            <p className="text-white/70 text-sm mt-0.5 capitalize">{receipt.fecha} · {receipt.hora}</p>
          </div>

          <div className="px-5 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
            <div className="space-y-1.5">
              {receipt.items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-neutral-400 tabular-nums shrink-0 w-5 text-right">{item.qty}×</span>
                  <span className="flex-1 text-neutral-800 leading-tight">{item.name}</span>
                  {item.sub > 0 && <span className="tabular-nums text-neutral-600 shrink-0">{AR.format(item.sub)}</span>}
                </div>
              ))}
            </div>

            <div className="border-t border-neutral-100 pt-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{receipt.totalUnidades} unidades</span>
              <span className="text-2xl font-bold tabular-nums font-display text-neutral-900">{AR.format(receipt.totalPrecio)}</span>
            </div>

            {receipt.pagos.length > 0 && (
              <div className="space-y-1 border-t border-neutral-100 pt-3">
                {receipt.pagos.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-neutral-500">{p.label}</span>
                    <span className="tabular-nums text-neutral-700 font-medium">{AR.format(p.monto)}</span>
                  </div>
                ))}
                {receipt.vuelto !== null && (
                  <div className="flex justify-between text-sm font-semibold mt-1 pt-1 border-t border-dashed border-neutral-200">
                    <span className="text-selva-700">Vuelto</span>
                    <span className="tabular-nums text-selva-700">{AR.format(receipt.vuelto)}</span>
                  </div>
                )}
              </div>
            )}

            {receipt.notas && (
              <p className="text-xs text-neutral-400 border-t border-neutral-100 pt-2">{receipt.notas}</p>
            )}
          </div>

          <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
            <button
              onClick={() => handlePrint(receipt)}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <svg className="size-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
              </svg>
              Imprimir comprobante
            </button>
            <div className="flex gap-2">
              <button onClick={resetForm} className="flex-1 h-10 rounded-xl bg-tierra-700 text-white text-sm font-semibold hover:bg-tierra-800 transition-colors">
                Nueva venta
              </button>
              <button onClick={handleClose} className="flex-1 h-10 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── POS ── */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 shrink-0">
          <h2 className="text-sm font-semibold font-display text-neutral-900 shrink-0">Registrar venta</h2>
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar producto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-lg border border-neutral-300 text-xs focus:outline-none focus:border-tierra-700"
            />
          </div>
          <div className="flex-1" />
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-8 rounded-lg border border-neutral-300 px-2 text-xs focus:outline-none focus:border-tierra-700 w-32"
          />
          <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* BODY */}
        <div className="flex flex-1 min-h-0">

          {/* IZQUIERDO: productos */}
          <div className="flex flex-col flex-1 min-w-0 border-r border-neutral-200">
            {catsConProductos.length > 0 && (
              <div className="flex gap-1.5 px-4 pt-3 pb-2 overflow-x-auto shrink-0" style={{ scrollbarWidth: "none" }}>
                <button
                  onClick={() => setCatFilter("all")}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === "all" ? "bg-tierra-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                >Todos</button>
                {catsConProductos.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCatFilter(cat.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === cat.id ? "bg-tierra-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                  >{cat.name}</button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {filtered.length === 0 ? (
                <p className="text-sm text-center text-neutral-400 py-10">
                  {search ? `Sin resultados para "${search}"` : "Sin productos en esta categoría"}
                </p>
              ) : (
                <div className="grid grid-cols-3 xl:grid-cols-4 gap-2.5 pt-1">
                  {filtered.map((prod) => {
                    const qty      = cantidades[prod.id] ?? 0;
                    const stock    = stockMap?.[prod.id] ?? null;
                    const sinStock = stock !== null && stock <= 0;
                    const initials = prod.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
                    return (
                      <div
                        key={prod.id}
                        className={`rounded-xl border overflow-hidden select-none transition-all ${
                          qty > 0 ? "border-tierra-600 ring-1 ring-tierra-600 shadow-sm"
                          : sinStock ? "border-neutral-100 opacity-40"
                          : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
                        }`}
                      >
                        <div onClick={() => set(prod.id, qty + 1)} className={`relative aspect-square overflow-hidden ${sinStock ? "" : "cursor-pointer"}`}>
                          {prod.cover_image_url ? (
                            <img src={prod.cover_image_url} alt={prod.name} loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-neutral-100">
                              <span className="text-xl font-bold text-neutral-300">{initials}</span>
                            </div>
                          )}
                          {qty > 0 && (
                            <div className="absolute top-1 right-1 min-w-[1.25rem] h-5 px-1 bg-tierra-700 text-white rounded-full flex items-center justify-center text-[11px] font-bold leading-none">{qty}</div>
                          )}
                          {sinStock && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                              <span className="text-[10px] font-semibold text-neutral-400 bg-white px-2 py-0.5 rounded-full border border-neutral-200">sin stock</span>
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <p onClick={() => set(prod.id, qty + 1)} className={`text-[11px] font-medium text-neutral-800 leading-tight line-clamp-2 min-h-[1.625rem] ${sinStock ? "" : "cursor-pointer"}`}>
                            {prod.name}
                          </p>
                          <div className="flex items-center justify-between mt-0.5">
                            {prod.precio_dist ? <p className="text-[11px] text-neutral-400 tabular-nums">{AR.format(prod.precio_dist)}</p> : <span />}
                            {stock !== null && stock > 0 && <span className="text-[10px] text-neutral-300">{stock}u</span>}
                          </div>
                          {qty > 0 && (
                            <div className="mt-1.5 flex items-center justify-between">
                              <button onClick={() => set(prod.id, qty - 1)} className="size-6 rounded-full border border-neutral-300 bg-white flex items-center justify-center text-sm text-neutral-600 hover:bg-neutral-100 transition-colors">−</button>
                              <span className="text-sm font-bold text-neutral-900 w-6 text-center tabular-nums">{qty}</span>
                              <button onClick={() => set(prod.id, qty + 1)} className="size-6 rounded-full bg-tierra-700 text-white flex items-center justify-center text-sm hover:bg-tierra-800 transition-colors">+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* DERECHO: ticket */}
          <div className="w-64 shrink-0 flex flex-col bg-neutral-50/50">
            <div className="px-4 py-3 border-b border-neutral-100 shrink-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Ticket en curso</p>
              {sucursalNombre && <p className="text-[11px] text-neutral-400 mt-0.5">{sucursalNombre}</p>}
            </div>

            {/* Lista items */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
              {seleccionados.length === 0 ? (
                <p className="text-xs text-center text-neutral-300 pt-10">Tocá un producto para agregar</p>
              ) : (
                seleccionados.map(([id, qty]) => {
                  const p   = products.find((p) => p.id === id);
                  const sub = qty * (p?.precio_dist ?? 0);
                  return (
                    <div key={id} className="group flex items-center gap-2 py-2 border-b border-neutral-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-neutral-800 truncate leading-tight">{p?.name ?? "—"}</p>
                        {sub > 0 && <p className="text-[11px] text-neutral-400 tabular-nums mt-0.5">{AR.format(sub)}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => set(id, qty - 1)} className="size-5 rounded-full border border-neutral-200 flex items-center justify-center text-xs text-neutral-500 hover:bg-neutral-100 transition-colors">−</button>
                        <span className="text-xs font-bold w-5 text-center tabular-nums">{qty}</span>
                        <button onClick={() => set(id, qty + 1)} className="size-5 rounded-full border border-neutral-200 flex items-center justify-center text-xs text-neutral-500 hover:bg-neutral-100 transition-colors">+</button>
                      </div>
                      <button onClick={() => set(id, 0)} className="text-neutral-200 hover:text-danger transition-colors opacity-0 group-hover:opacity-100" aria-label="Quitar">
                        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Total + botón cobrar */}
            <div className="border-t border-neutral-200 p-4 shrink-0 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">
                  {totalUnidades > 0 ? `${totalUnidades} producto${totalUnidades !== 1 ? "s" : ""}` : "Total"}
                </span>
                <span className="text-2xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalPrecio)}</span>
              </div>
              <button
                onClick={openPay}
                disabled={seleccionados.length === 0}
                className="w-full h-12 rounded-xl bg-tierra-700 hover:bg-tierra-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base transition-colors shadow-sm"
              >
                {seleccionados.length === 0 ? "Seleccioná productos" : `Cobrar ${AR.format(totalPrecio)}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL CONFIRMAR COBRO ── */}
      {showPay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowPay(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-neutral-100">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold font-display text-neutral-900">Confirmar cobro</h3>
                <button onClick={() => setShowPay(false)} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 transition-colors">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Resumen */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-neutral-400">Total</p>
                  <p className="text-3xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalPrecio)}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{totalUnidades} producto{totalUnidades !== 1 ? "s" : ""}</p>
                </div>
              </div>

              {/* Medio de pago */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Medio de pago</p>
                <div className="grid grid-cols-2 gap-2">
                  {PAY_METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { setPayMethod(m.id); setMontoRecibido(""); }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        payMethod === m.id
                          ? "bg-neutral-900 border-neutral-900 text-white shadow-sm"
                          : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                      }`}
                    >
                      {m.icon}
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monto recibido (solo efectivo) */}
              {payMethod === "efectivo" && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Monto recibido</p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 font-medium">$</span>
                      <input
                        type="number"
                        value={montoRecibido}
                        onChange={(e) => setMontoRecibido(e.target.value)}
                        placeholder="0"
                        min={0}
                        autoFocus
                        className="w-full h-11 pl-7 pr-3 rounded-xl border border-neutral-300 text-base font-semibold tabular-nums focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/15 transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => setMontoRecibido(String(totalPrecio))}
                      className="h-11 px-3 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-500 hover:bg-neutral-50 transition-colors whitespace-nowrap"
                    >
                      Justo
                    </button>
                  </div>

                  {/* Vuelto */}
                  {vuelto !== null && (
                    <div className={`mt-3 rounded-xl px-4 py-3 flex items-center justify-between ${
                      vuelto >= 0 ? "bg-selva-50 border border-selva-200" : "bg-danger/5 border border-danger/20"
                    }`}>
                      <span className={`text-sm font-semibold ${vuelto >= 0 ? "text-selva-700" : "text-danger"}`}>
                        {vuelto >= 0 ? "Vuelto" : "Falta"}
                      </span>
                      <span className={`text-xl font-bold tabular-nums font-display ${vuelto >= 0 ? "text-selva-700" : "text-danger"}`}>
                        {AR.format(Math.abs(vuelto))}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Notas */}
              <div>
                <textarea
                  placeholder="Notas opcionales…"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={1}
                  className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-tierra-700 resize-none"
                />
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}
            </div>

            {/* Acciones */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowPay(false)}
                className="flex-1 h-11 rounded-xl border border-neutral-200 bg-white text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancelar
              </button>
              <Button
                variant="primary"
                size="sm"
                loading={pending}
                onClick={handleConfirm}
                className="flex-1 h-11 rounded-xl text-sm font-bold"
              >
                Confirmar venta
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
