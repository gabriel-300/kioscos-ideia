"use client";

import { useState, useTransition, useMemo } from "react";
import { crearMovimiento } from "@/app/(admin)/admin/movimientos/actions";
import { fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";
import type { Database } from "@/types/database";
import type { CSSProperties } from "react";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = { id: string; name: string };
type Promo    = { id: string; name: string; price: number; tipo: "promo" | "receta"; promo_items: { product_id: string; cantidad: number }[] };

const PROMO_PREFIX = "promo:";
const PROMO_COLOR  = "#B45309";
function isPromoId(id: string)  { return id.startsWith(PROMO_PREFIX); }
function promoIdOf(id: string)  { return id.slice(PROMO_PREFIX.length); }

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

/* ── Colores del prototipo ── */
const NAVY     = "#15375E";
const NAVY_D   = "#0F2742";
const NAVY_L   = "#EEF4FB";
const NAVY_M   = "#D4E3F4";
const GREEN_L  = "#DCFCE9";
const GREEN    = "#0B6B4F";
const RED_L    = "#FDE4E2";
const RED      = "#9B2222";

/* ── Iconos de categoría por nombre (fallback genérico) ── */
function getCatIcon(name: string, size = 18) {
  const n = name.toLowerCase();
  const s = `width:${size}px;height:${size}px`;
  if (n.includes("bebida") || n.includes("gaseosa") || n.includes("agua"))
    return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M8 2h8l2 6H6L8 2z"/><path d="M6 8v12a2 2 0 002 2h8a2 2 0 002-2V8"/><line x1="10" y1="13" x2="14" y2="13"/></svg>;
  if (n.includes("empanad"))
    return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2a10 10 0 0110 10H2A10 10 0 0112 2z"/><path d="M2 12c0 5.52 4.48 10 10 10s10-4.48 10-10"/></svg>;
  if (n.includes("pizza") || n.includes("pizza"))
    return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2L2 19h20z"/><line x1="12" y1="2" x2="12" y2="19"/><line x1="7" y1="12" x2="17" y2="12"/></svg>;
  if (n.includes("chipa") || n.includes("snack") || n.includes("galletita"))
    return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>;
  if (n.includes("tabla") || n.includes("picada") || n.includes("sandwich"))
    return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>;
  if (n.includes("helado") || n.includes("postre"))
    return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="9" y1="20" x2="15" y2="20"/></svg>;
  // genérico
  return <svg style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg>;
}

/* ── Colores de categoría por índice ── */
const CAT_COLORS = [NAVY, "#065F46", "#92400E", "#475569", "#0C447C", "#7C3AED", "#B45309"];

const CANALES = [
  { id: "consumidor_final", label: "Consumidor Final", color: NAVY,      bg: NAVY_L },
  { id: "pedido_ya",        label: "Pedido Ya",        color: "#C05621",  bg: "#FFF7ED" },
  { id: "cuenta_corriente", label: "Cta. Corriente",   color: "#5B21B6",  bg: "#F5F3FF" },
  { id: "ambulante",        label: "Ambulante",        color: "#065F46",  bg: "#ECFDF5" },
] as const;

type PayMethod = "efectivo" | "mp" | "tarjeta" | "transferencia";

const PAY_METHODS: { id: PayMethod; label: string; icon: React.ReactNode }[] = [
  {
    id: "efectivo", label: "Efectivo",
    icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>,
  },
  {
    id: "mp", label: "Billetera virtual",
    icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>,
  },
  {
    id: "tarjeta", label: "Tarjeta",
    icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  },
  {
    id: "transferencia", label: "Transferencia",
    icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  },
];

type Personal = { id: string; nombre: string };

type Receipt = {
  fecha: string; hora: string;
  items: { name: string; qty: number; precioUnit: number; sub: number }[];
  totalPrecio: number; totalUnidades: number;
  pagos: { label: string; monto: number }[];
  vuelto: number | null; notas: string | null;
  canal: string;
  personalNombre?: string | null;
};

interface Props {
  open:            boolean;
  onClose:         () => void;
  sucursalId:      string;
  sucursalNombre?: string;
  products:        Product[];
  stockMap?:       Record<string, number>;
  categories?:     Category[];
  personal?:       Personal[];
  cajaAbierta?:    boolean;
  promos?:         Promo[];
}

export function VentaRapidaForm({ open, onClose, sucursalId, sucursalNombre, products, stockMap, categories, personal = [], cajaAbierta, promos = [] }: Props) {
  const [cantidades,    setCantidades]    = useState<Record<string, number>>({});
  const [gramosTexto,   setGramosTexto]   = useState<Record<string, string>>({});
  const [montoTexto,    setMontoTexto]    = useState<Record<string, string>>({});
  const [fecha,         setFecha]         = useState(() => fechaHoyAR());
  const [catFilter,     setCatFilter]     = useState("all");
  const [search,        setSearch]        = useState("");
  const [showPay, setShowPay] = useState(false);
  const [pagos,   setPagos]   = useState<Record<PayMethod, string>>({ efectivo: "", mp: "", tarjeta: "", transferencia: "" });
  const [canal,      setCanal]      = useState("consumidor_final");
  const [precioOverride, setPrecioOverride] = useState<Record<string, string>>({});
  const [personalId, setPersonalId] = useState("");
  const [notas,      setNotas]      = useState("");
  const [error,         setError]         = useState<string | null>(null);
  const [receipt,       setReceipt]       = useState<Receipt | null>(null);
  const [pending, startTransition] = useTransition();

  /* ── derivados ── */
  const catsConProductos = useMemo(() => {
    if (!categories?.length) return [];
    const ids = new Set(products.map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [categories, products]);

  const filtered = useMemo(() => {
    let list = catFilter === "all" || catFilter === "promos" ? products : products.filter((p) => p.category_id === catFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, catFilter, search]);

  const promoMap = useMemo(() => new Map(promos.map((p) => [p.id, p])), [promos]);

  const filteredPromos = useMemo(() => {
    let list = promos;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [promos, search]);

  function promoDisponible(promo: Promo): number | null {
    if (!stockMap || promo.promo_items.length === 0) return null;
    return Math.min(...promo.promo_items.map((pi) => Math.floor((stockMap[pi.product_id] ?? 0) / pi.cantidad)));
  }

  function nameOf(id: string) {
    if (isPromoId(id)) return promoMap.get(promoIdOf(id))?.name ?? "—";
    return products.find((p) => p.id === id)?.name ?? "—";
  }
  function basePriceOf(id: string) {
    if (isPromoId(id)) return promoMap.get(promoIdOf(id))?.price ?? 0;
    return products.find((p) => p.id === id)?.precio_dist ?? 0;
  }
  // En el canal "Pedido Ya" el encargado puede sobreescribir el precio a mano
  // (la comisión de la app suele hacer que el precio real cobrado sea otro).
  function priceOf(id: string) {
    if (canal === "pedido_ya") {
      const ov = precioOverride[id];
      if (ov !== undefined && ov !== "") {
        const v = parseFloat(ov);
        if (!isNaN(v) && v >= 0) return v;
      }
    }
    return basePriceOf(id);
  }

  const seleccionados = useMemo(
    () => Object.entries(cantidades).filter(([, qty]) => qty > 0),
    [cantidades]
  );

  // Stock requerido por producto real, contemplando tanto líneas sueltas como componentes de promos
  const requeridoPorProducto = useMemo(() => {
    const req: Record<string, number> = {};
    for (const [id, qty] of seleccionados) {
      if (isPromoId(id)) {
        const promo = promoMap.get(promoIdOf(id));
        promo?.promo_items.forEach((pi) => { req[pi.product_id] = (req[pi.product_id] ?? 0) + qty * pi.cantidad; });
      } else {
        req[id] = (req[id] ?? 0) + qty;
      }
    }
    return req;
  }, [seleccionados, promoMap]);

  const totalPrecio    = seleccionados.reduce((s, [id, qty]) => s + qty * priceOf(id), 0);
  const totalUnidades  = seleccionados.reduce((s, [, qty]) => s + qty, 0);
  const totalIngresado = (Object.values(pagos) as string[]).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const efectivoNum    = parseFloat(pagos.efectivo) || 0;
  const otrosMedios    = totalIngresado - efectivoNum;
  const vuelto         = efectivoNum > 0 ? efectivoNum - Math.max(0, totalPrecio - otrosMedios) : null;

  /* ── helpers ── */
  function isKg(id: string) { if (isPromoId(id)) return false; return products.find((p) => p.id === id)?.unit_label === "kg"; }
  function step(id: string) { return isKg(id) ? 0.1 : 1; }
  function fmtCant(id: string, qty: number) {
    return isKg(id) ? `${formatKg(qty)} kg` : `${qty}`;
  }

  /* ── handlers ── */
  function set(id: string, value: number) {
    const s = step(id);
    const rounded = Math.round(Math.max(0, value) / s) * s;
    setCantidades((prev) => ({ ...prev, [id]: parseFloat(rounded.toFixed(3)) }));
    // Los botones -/+ cambian la cantidad de verdad; los inputs de gramos/$ vuelven
    // a mostrar el valor derivado en vez del texto que se haya tipeado antes.
    setGramosTexto((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setMontoTexto((prev)  => { const n = { ...prev }; delete n[id]; return n; });
  }

  // Setter para productos por peso: el input pide GRAMOS (no kg), para evitar
  // que "100" (pensado como 100g) se cargue como 100 kg por error.
  function setGrams(id: string, raw: string) {
    setGramosTexto((prev) => ({ ...prev, [id]: raw }));
    setMontoTexto((prev) => { const n = { ...prev }; delete n[id]; return n; }); // el otro campo pasa a mostrar el valor derivado
    const v = parseFloat(raw);
    // Mientras el campo está vacío o a medio escribir (ej. borraste todo para tipear
    // un número nuevo) NO se toca la cantidad — si no, el producto desaparecía del
    // carrito ni bien quedaba vacío un instante, y con él el input para seguir escribiendo.
    if (!raw || isNaN(v) || v <= 0) return;
    setCantidades((prev) => ({ ...prev, [id]: Math.round(Math.max(0, v)) / 1000 }));
  }

  // El cajero tipea $ y se calcula el peso solo, según el precio/kg (ej. "piden $2000 de chipas")
  function setMonto(id: string, raw: string) {
    setMontoTexto((prev) => ({ ...prev, [id]: raw }));
    setGramosTexto((prev) => { const n = { ...prev }; delete n[id]; return n; }); // el otro campo pasa a mostrar el valor derivado
    const monto = parseFloat(raw);
    const precioKg = priceOf(id);
    // Mismo criterio que setGrams: no borrar la cantidad solo porque el campo
    // está vacío o a medio escribir.
    if (!raw || isNaN(monto) || monto <= 0 || !precioKg) return;
    // Sin redondear a gramos enteros: si se redondea, el total (peso × precio)
    // ya no da exactamente el monto tipeado (ej. escribir $3500 terminaba
    // cobrando $3497). El peso que se ve en pantalla sigue mostrándose
    // redondeado (fmtCant/fmtQty), pero el monto cobrado queda exacto.
    const kg = monto / precioKg;
    if (kg <= 0) return;
    setCantidades((prev) => ({ ...prev, [id]: kg }));
  }

  // Input compartido para productos por kg: gramos y $ editables al mismo tiempo —
  // escribís en cualquiera de los dos y el otro se autocompleta solo (ej. si piden
  // "$2000 de chipas" se carga en el campo $ y acá se ve cuántos gramos son, y viceversa).
  // Apilados verticalmente (en vez de uno al lado del otro) para que cada campo tenga
  // ancho suficiente y no se corte el número al escribir.
  function renderKgInput(id: string, qty: number) {
    const precioKg = priceOf(id);
    const gramosVal = gramosTexto[id] ?? (qty > 0 ? String(Math.round(qty * 1000)) : "");
    const montoVal  = montoTexto[id]  ?? (qty > 0 && precioKg ? String(Math.round(qty * precioKg)) : "");
    return (
      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={gramosVal}
            min={0}
            step={1}
            placeholder="0"
            title="Gramos"
            onChange={(e) => setGrams(id, e.target.value)}
            onFocus={(e) => e.target.select()}
            style={{
              fontSize: 12, fontWeight: 800, width: 58, textAlign: "center",
              border: "1.5px solid #CBD5E1", borderRadius: 5, outline: "none",
              color: "#0F172A", background: "white", padding: "4px 2px",
            }}
          />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8" }}>g</span>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={montoVal}
            min={0}
            step={1}
            placeholder="0"
            title="Monto ($)"
            onChange={(e) => setMonto(id, e.target.value)}
            onFocus={(e) => e.target.select()}
            style={{
              fontSize: 12, fontWeight: 800, width: 58, textAlign: "center",
              border: `1.5px solid ${GREEN}`, borderRadius: 5, outline: "none",
              color: "#0F172A", background: "white", padding: "4px 2px",
            }}
          />
          <span style={{ fontSize: 10, fontWeight: 700, color: GREEN }}>$</span>
        </div>
      </div>
    );
  }

  function resetForm() {
    setCantidades({}); setGramosTexto({}); setMontoTexto({}); setFecha(fechaHoyAR());
    setSearch(""); setCatFilter("all"); setShowPay(false);
    setPagos({ efectivo: "", mp: "", tarjeta: "", transferencia: "" });
    setCanal("consumidor_final"); setPrecioOverride({}); setPersonalId(""); setNotas(""); setError(null); setReceipt(null);
  }

  function handleClose() { resetForm(); onClose(); }

  function handleConfirm() {
    if (cajaAbierta === false) {
      setError("No hay caja abierta. Registrá una apertura antes de vender.");
      return;
    }
    const sinPrecio = seleccionados.filter(([id]) => {
      if (isPromoId(id)) return false;
      const p = products.find((prod) => prod.id === id);
      return !p || p.precio_dist == null;
    });
    if (sinPrecio.length > 0) {
      const nombres = sinPrecio.map(([id]) => products.find((p) => p.id === id)?.name ?? "?").join(", ");
      setError(`Sin precio configurado: ${nombres}`);
      return;
    }
    // TEMPORALMENTE DESACTIVADO (2026-07-03, a pedido del usuario): todavía no
    // se terminó de cargar el stock real (entregas) de todos los productos,
    // así que esta validación bloqueaba ventas legítimas. Reactivar cuando el
    // catálogo tenga el stock inicial cargado — ver memoria del proyecto.
    // if (stockMap) {
    //   const insuficiente = Object.entries(requeridoPorProducto).filter(([pid, qty]) => (stockMap[pid] ?? 0) < qty);
    //   if (insuficiente.length > 0) {
    //     const detalles = insuficiente.map(([pid, qty]) => {
    //       const p = products.find((prod) => prod.id === pid);
    //       return `${p?.name ?? "?"} (disponible: ${stockMap[pid] ?? 0}, necesario: ${qty})`;
    //     }).join(", ");
    //     setError(`Stock insuficiente: ${detalles}`);
    //     return;
    //   }
    // }
    if (canal === "cuenta_corriente" && !personalId) { setError("Seleccioná un beneficiario para Cta. Corriente"); return; }
    // Cta. Corriente no cobra en el momento -- no tiene sentido pedir monto/medio de pago.
    if (canal !== "cuenta_corriente" && Math.round(totalIngresado * 100) < Math.round(totalPrecio * 100)) {
      setError("El monto ingresado no cubre el total");
      return;
    }
    // Billetera/tarjeta/transferencia no dan vuelto (el vuelto solo existe en efectivo) --
    // si esos medios solos ya superan el total, es casi seguro un error de tipeo.
    if (canal !== "cuenta_corriente" && Math.round(otrosMedios * 100) > Math.round(totalPrecio * 100)) {
      setError("El monto en billetera/tarjeta/transferencia no puede superar el total (ahí no se da vuelto)");
      return;
    }
    setError(null);
    const now  = new Date();
    const hora = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    const receiptItems = seleccionados.map(([id, qty]) => {
      const precioUnit = priceOf(id);
      return { name: nameOf(id), qty, precioUnit, sub: qty * precioUnit };
    });
    const pagosList = PAY_METHODS
      .map((m) => ({ label: m.label, monto: parseFloat(pagos[m.id]) || 0 }))
      .filter((p) => p.monto > 0);
    const notasMedios = pagosList.map((p) => `${p.label}: ${AR.format(p.monto)}`).join(" | ");
    const notasFinal  = [notasMedios, notas || null].filter(Boolean).join(" — ") || null;

    const personalNombre = personal.find((p) => p.id === personalId)?.nombre ?? null;

    startTransition(async () => {
      try {
        await crearMovimiento({
          sucursal_id:        sucursalId,
          fecha,
          tipo:               "venta",
          notas:              notasFinal,
          canal,
          personal_id:        canal === "cuenta_corriente" && personalId ? personalId : null,
          // Redondeado a centavos -- restar el vuelto (float) puede dejar arrastres
          // tipo 1200.0000000000002 que no se ven en el formateo pero quedan guardados así.
          pago_efectivo:      efectivoNum > 0 ? Math.round(Math.max(0, efectivoNum - (vuelto ?? 0)) * 100) / 100 || null : null,
          pago_billetera:     parseFloat(pagos.mp)            || null,
          pago_tarjeta:       parseFloat(pagos.tarjeta)       || null,
          pago_transferencia: parseFloat(pagos.transferencia) || null,
          items: seleccionados.map(([id, cantidad]) =>
            isPromoId(id)
              ? { promo_id: promoIdOf(id), cantidad, precio_unitario: priceOf(id) }
              : { product_id: id, cantidad, precio_unitario: priceOf(id) }
          ),
        });
        setShowPay(false);
        setReceipt({
          fecha: new Date(fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
          hora, items: receiptItems, totalPrecio, totalUnidades, pagos: pagosList,
          vuelto: vuelto !== null && vuelto > 0 ? vuelto : null, notas: notas || null, canal,
          personalNombre: canal === "cuenta_corriente" ? personalNombre : null,
        });
      } catch (e) { setError((e as Error).message); }
    });
  }

  function handlePrint(r: Receipt) {
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) return;
    const canalLabel = CANALES.find((x) => x.id === r.canal)?.label ?? r.canal;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comprobante</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:13px;padding:24px 20px;color:#111;}h1{font-size:16px;font-weight:bold;text-align:center;margin-bottom:2px;}.sub{text-align:center;font-size:11px;color:#555;margin-bottom:12px;}.divider{border-top:1px dashed #bbb;margin:10px 0;}.row{display:flex;justify-content:space-between;margin-bottom:4px;}.name{flex:1;padding-right:8px;}.total-row{display:flex;justify-content:space-between;font-weight:bold;font-size:15px;margin-top:4px;}.pago-row{display:flex;justify-content:space-between;margin-bottom:3px;}.vuelto-row{display:flex;justify-content:space-between;font-weight:bold;margin-top:4px;}.footer{text-align:center;font-size:10px;color:#888;margin-top:16px;}</style>
</head><body>
<h1>Kioscos IDEIA</h1><div class="sub">${sucursalNombre ?? ""}</div><div class="sub">${r.fecha} · ${r.hora}</div><div class="sub">${canalLabel}</div><div class="divider"></div>
${r.items.map((i) => `<div class="row"><span class="name">${i.name}</span><span>${i.qty} × ${AR.format(i.precioUnit)}</span><span style="margin-left:12px;min-width:80px;text-align:right">${AR.format(i.sub)}</span></div>`).join("")}
<div class="divider"></div><div class="total-row"><span>TOTAL (${r.totalUnidades} u.)</span><span>${AR.format(r.totalPrecio)}</span></div><div class="divider"></div>
${r.pagos.map((p) => `<div class="pago-row"><span>${p.label}</span><span>${AR.format(p.monto)}</span></div>`).join("")}
${r.vuelto !== null ? `<div class="vuelto-row"><span>VUELTO</span><span>${AR.format(r.vuelto)}</span></div>` : ""}
${r.notas ? `<div class="divider"></div><div style="font-size:11px;color:#555">${r.notas}</div>` : ""}
<div class="footer">Gracias por su compra</div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 200);
  }

  if (!open) return null;

  /* ── COMPROBANTE ── */
  if (receipt) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
        <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
          <div style={{ background: GREEN_L, borderBottom: `1px solid #A7F3D0` }} className="px-6 py-6 text-center">
            <div className="size-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "#6EE7B7" }}>
              <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke={GREEN} strokeWidth={2.5}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="font-bold text-lg" style={{ color: GREEN }}>Venta registrada</p>
            <p className="text-sm mt-0.5 capitalize" style={{ color: "#047857" }}>{receipt.fecha} · {receipt.hora}</p>
            {(() => { const c = CANALES.find((x) => x.id === receipt.canal); return c ? <span style={{ display: "inline-block", marginTop: 6, fontSize: 11, fontWeight: 700, background: c.bg, color: c.color, borderRadius: 20, padding: "2px 10px" }}>{c.label}</span> : null; })()}
            {receipt.personalNombre && (
              <div style={{ marginTop: 4, fontSize: 12, color: "#5B21B6", fontWeight: 600 }}>
                {receipt.personalNombre}
              </div>
            )}
          </div>

          <div className="px-5 py-4 space-y-3 max-h-[55vh] overflow-y-auto">
            <div className="space-y-1.5">
              {receipt.items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="tabular-nums shrink-0 w-5 text-right font-semibold" style={{ color: "#94A3B8" }}>{item.qty}×</span>
                  <span className="flex-1 leading-tight" style={{ color: "#0F172A" }}>{item.name}</span>
                  {item.sub > 0 && <span className="tabular-nums shrink-0 font-bold" style={{ color: NAVY }}>{AR.format(item.sub)}</span>}
                </div>
              ))}
            </div>

            <div className="border-t pt-3 flex items-center justify-between" style={{ borderColor: "#E2E8F0" }}>
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#94A3B8" }}>{receipt.totalUnidades} unidades</span>
              <span className="text-2xl font-black tabular-nums" style={{ color: "#0F172A", letterSpacing: "-1px" }}>{AR.format(receipt.totalPrecio)}</span>
            </div>

            {receipt.pagos.length > 0 && (
              <div className="space-y-1 border-t pt-3" style={{ borderColor: "#E2E8F0" }}>
                {receipt.pagos.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span style={{ color: "#64748B" }}>{p.label}</span>
                    <span className="tabular-nums font-semibold" style={{ color: "#1E293B" }}>{AR.format(p.monto)}</span>
                  </div>
                ))}
                {receipt.vuelto !== null && (
                  <div className="flex justify-between text-sm font-bold mt-1 pt-1 border-t border-dashed" style={{ borderColor: "#CBD5E1" }}>
                    <span style={{ color: GREEN }}>Vuelto</span>
                    <span className="tabular-nums" style={{ color: GREEN }}>{AR.format(receipt.vuelto)}</span>
                  </div>
                )}
              </div>
            )}

            {receipt.notas && <p className="text-xs border-t pt-2" style={{ color: "#94A3B8", borderColor: "#E2E8F0" }}>{receipt.notas}</p>}
          </div>

          <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
            <button
              onClick={() => handlePrint(receipt)}
              className="w-full flex items-center justify-center gap-2 h-10 rounded-lg border text-sm font-semibold transition-all hover:opacity-80"
              style={{ borderColor: "#CBD5E1", background: "white", color: "#475569" }}
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
              </svg>
              Imprimir comprobante
            </button>
            <button onClick={resetForm} className="w-full h-10 rounded-lg text-white text-sm font-bold transition-all" style={{ background: NAVY }}>
              Nueva venta
            </button>
          </div>
        </div>
      </div>
    );
  }

  const catColorMap: Record<string, string> = {};
  catsConProductos.forEach((c, i) => { catColorMap[c.id] = CAT_COLORS[i % CAT_COLORS.length]; });

  type Tile = { id: string; name: string; price: number | null; agotado: boolean; color: string; coverImageUrl: string | null; isPromo: boolean; tipoPromo?: "promo" | "receta"; stock: number | null };

  const tiles: Tile[] = catFilter === "promos"
    ? filteredPromos.map((promo) => {
        const disp = promoDisponible(promo);
        return {
          id: `${PROMO_PREFIX}${promo.id}`,
          name: promo.name,
          price: promo.price,
          agotado: disp !== null && disp <= 0,
          color: PROMO_COLOR,
          coverImageUrl: null,
          isPromo: true,
          tipoPromo: promo.tipo,
          stock: disp,
        };
      })
    : filtered.map((prod) => {
        const stock = stockMap?.[prod.id] ?? null;
        return {
          id: prod.id,
          name: prod.name,
          price: prod.precio_dist,
          agotado: stock !== null && stock <= 0,
          color: prod.category_id ? (catColorMap[prod.category_id] ?? NAVY) : NAVY,
          coverImageUrl: prod.cover_image_url,
          isPromo: false,
          stock,
        };
      });

  /* ── POS ── */
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 14 }}>
      {/* TOPBAR */}
      <div className="flex items-center h-[60px] shrink-0" style={{ background: NAVY }}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-full border-r" style={{ borderColor: "rgba(255,255,255,.12)" }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
            <path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
          </svg>
          <span className="font-bold text-white text-[15px]" style={{ letterSpacing: "-0.3px" }}>
            Kioscos IDEIA <small className="font-normal text-[11px]" style={{ opacity: .55 }}>· POS</small>
          </span>
        </div>

        {/* Fecha */}
        <div className="flex items-center h-full px-4 border-r" style={{ borderColor: "rgba(255,255,255,.12)" }}>
          <input
            type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="text-[12px] font-medium rounded-full px-3 py-1 border-0 outline-none bg-transparent text-white/80 cursor-pointer"
            style={{ background: "rgba(255,255,255,.10)" }}
          />
        </div>

        {/* Search */}
        <div className="flex-1 flex items-center px-4">
          <div className="relative max-w-xs w-full">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text" placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-full text-xs text-white placeholder-white/40 border-0 outline-none focus:ring-1 focus:ring-white/30"
              style={{ background: "rgba(255,255,255,.12)" }}
            />
          </div>
        </div>

        {/* Sucursal + cerrar */}
        <div className="flex items-center gap-3 px-4 h-full">
          {sucursalNombre && (
            <div className="flex items-center gap-1.5 text-[12px] rounded-full px-3 py-1" style={{ background: "rgba(255,255,255,.12)", color: "rgba(255,255,255,.85)" }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {sucursalNombre}
            </div>
          )}
          <button
            onClick={handleClose}
            className="size-8 rounded-lg flex items-center justify-center transition-all"
            style={{ color: "rgba(255,255,255,.6)" }}
            onMouseOver={(e) => (e.currentTarget.style.background = "rgba(255,255,255,.12)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* BODY */}
      <div className="flex flex-1 min-h-0">

        {/* IZQUIERDO */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{ background: "#F8FAFC" }}>

          {/* Category tabs */}
          <div className="flex overflow-x-auto shrink-0" style={{ background: "white", borderBottom: "1px solid #E2E8F0" }}>
            <button
              onClick={() => setCatFilter("all")}
              className="flex items-center gap-2 px-5 h-[60px] text-[13px] font-semibold shrink-0 transition-all border-b-[3px]"
              style={{
                color: catFilter === "all" ? NAVY : "#64748B",
                borderBottomColor: catFilter === "all" ? NAVY : "transparent",
                background: catFilter === "all" ? NAVY_L : "transparent",
              }}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={catFilter === "all" ? NAVY : "#94A3B8"} strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
              Todos
            </button>
            {promos.length > 0 && (
              <button
                onClick={() => setCatFilter("promos")}
                className="flex items-center gap-2 px-5 h-[60px] text-[13px] font-semibold shrink-0 transition-all border-b-[3px]"
                style={{
                  color: catFilter === "promos" ? PROMO_COLOR : "#64748B",
                  borderBottomColor: catFilter === "promos" ? PROMO_COLOR : "transparent",
                  background: catFilter === "promos" ? "#FFFBEB" : "transparent",
                }}
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={catFilter === "promos" ? PROMO_COLOR : "#94A3B8"} strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" />
                </svg>
                Promos
              </button>
            )}
            {catsConProductos.map((cat) => {
              const color = catColorMap[cat.id] ?? NAVY;
              const active = catFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setCatFilter(cat.id)}
                  className="flex items-center gap-2 px-5 h-[50px] text-[13px] font-semibold shrink-0 transition-all border-b-[3px] whitespace-nowrap"
                  style={{
                    color: active ? NAVY : "#64748B",
                    borderBottomColor: active ? NAVY : "transparent",
                    background: active ? NAVY_L : "transparent",
                  }}
                >
                  <span style={{ color: active ? color : "#94A3B8", width: 18, height: 18, display: "flex" }}>
                    {getCatIcon(cat.name, 18)}
                  </span>
                  {cat.name}
                </button>
              );
            })}
          </div>

          {/* Product / Promo grid */}
          <div className="flex-1 overflow-y-auto" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 14, padding: 18, alignContent: "start" } as CSSProperties}>
            {tiles.length === 0 ? (
              <div className="col-span-full text-center py-16 text-sm" style={{ color: "#94A3B8" }}>
                {search ? `Sin resultados para "${search}"` : catFilter === "promos" ? "Sin promociones activas" : "Sin productos"}
              </div>
            ) : tiles.map((tile) => {
              const qty      = cantidades[tile.id] ?? 0;
              const agotado  = tile.agotado;
              const catColor = tile.color;
              const initials = tile.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

              return (
                <div
                  key={tile.id}
                  // "Agotado" es solo informativo (stock calculado incompleto mientras se
                  // termina de cargar el catálogo real) — no bloquea la venta, igual que
                  // el chequeo de stock server-side, desactivado temporalmente (ver memoria).
                  onClick={() => set(tile.id, qty + step(tile.id))}
                  style={{
                    background: "white",
                    border: `1.5px solid ${qty > 0 ? NAVY : "#E6ECF3"}`,
                    borderRadius: 12,
                    padding: "18px 12px",
                    minHeight: 158,
                    cursor: "pointer",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    position: "relative",
                    transition: "all .15s",
                    boxShadow: qty > 0 ? `0 0 0 1px ${NAVY}` : "none",
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = NAVY; e.currentTarget.style.boxShadow = "0 3px 12px rgba(30,58,138,.1)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = qty > 0 ? NAVY : "#E2E8F0"; e.currentTarget.style.boxShadow = qty > 0 ? `0 0 0 1px ${NAVY}` : "none"; e.currentTarget.style.transform = "none"; }}
                >
                  {agotado ? (
                    <span style={{ position: "absolute", top: 6, right: 6, fontSize: 10, fontWeight: 700, background: RED_L, color: RED, borderRadius: 5, padding: "2px 6px" }}>
                      Agotado
                    </span>
                  ) : (
                    <span style={{ position: "absolute", top: 6, right: 6, fontSize: 10, fontWeight: 700, background: "#F1F5F9", color: "#64748B", borderRadius: 5, padding: "2px 6px" }}>
                      {isKg(tile.id) ? fmtCant(tile.id, tile.stock ?? 0) : `${tile.stock ?? 0} un.`}
                    </span>
                  )}
                  {qty > 0 ? (
                    <span style={{ position: "absolute", top: 6, left: 6, minWidth: 20, height: 20, padding: "0 6px", background: NAVY, color: "white", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>
                      {fmtCant(tile.id, qty)}
                    </span>
                  ) : tile.isPromo && (
                    <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontWeight: 700, background: "#FEF3C7", color: PROMO_COLOR, borderRadius: 5, padding: "2px 6px" }}>
                      {tile.tipoPromo === "receta" ? "Receta" : "Promo"}
                    </span>
                  )}

                  {/* Icon */}
                  <div style={{ width: 48, height: 48, borderRadius: 10, background: catColor + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: catColor }}>
                    {tile.coverImageUrl ? (
                      <img src={tile.coverImageUrl} alt={tile.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                    ) : (
                      <span style={{ fontSize: 16, fontWeight: 800, color: catColor }}>{initials}</span>
                    )}
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", lineHeight: 1.3, minHeight: "2.4em" }}>{tile.name}</div>

                  {agotado ? (
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>No disponible</div>
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>
                      {tile.price ? AR.format(tile.price) : "—"}
                    </div>
                  )}

                  {qty > 0 && (
                    <div className="flex items-center gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => set(tile.id, qty - step(tile.id))}
                        style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid #CBD5E1`, background: "#F8FAFC", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#1E293B" }}
                      >−</button>
                      {isKg(tile.id) ? (
                        renderKgInput(tile.id, qty)
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 800, minWidth: 24, textAlign: "center", color: "#0F172A" }}>{fmtCant(tile.id, qty)}</span>
                      )}
                      <button
                        onClick={() => set(tile.id, qty + step(tile.id))}
                        style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid ${NAVY}`, background: NAVY_L, fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY }}
                      >+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* DERECHO: ticket */}
        <div className="flex flex-col shrink-0" style={{ width: 340, background: "white", borderLeft: "1px solid #E6ECF3" }}>

          {/* Header */}
          <div className="shrink-0 px-3.5 py-3.5" style={{ borderBottom: "1px solid #E2E8F0" }}>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Ticket en curso</span>
              {totalUnidades > 0 && (
                <span style={{ fontSize: 11, background: NAVY, color: "white", borderRadius: 20, padding: "2px 9px", fontWeight: 600 }}>
                  {totalUnidades}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
              {sucursalNombre ? `${sucursalNombre}` : "—"}
            </div>

            {/* Canal de venta */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 10 }}>
              {CANALES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCanal(c.id);
                    if (c.id !== "cuenta_corriente") setPersonalId("");
                    // Evita que montos tipeados para otro canal (ej. efectivo cargado
                    // y cancelado) queden pegados si el cajero cambia de canal y
                    // confirma sin darse cuenta -- especialmente grave hacia/desde
                    // Cta. Corriente, que no debería llevar ningún medio de pago.
                    setPagos({ efectivo: "", mp: "", tarjeta: "", transferencia: "" });
                  }}
                  style={{
                    padding: "6px 4px",
                    borderRadius: 7,
                    fontSize: 11,
                    fontWeight: canal === c.id ? 700 : 500,
                    border: `1.5px solid ${canal === c.id ? c.color : "#E2E8F0"}`,
                    background: canal === c.id ? c.bg : "white",
                    color: canal === c.id ? c.color : "#94A3B8",
                    cursor: "pointer",
                    transition: "all .12s",
                    textAlign: "center",
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Beneficiario — solo para cuenta corriente */}
            {canal === "cuenta_corriente" && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E2E8F0" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  Beneficiario
                </p>
                {personal.length === 0 ? (
                  <p style={{ fontSize: 12, color: "#F59E0B", fontWeight: 600 }}>No hay personal registrado en esta sucursal</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {personal.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPersonalId(prev => prev === p.id ? "" : p.id)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 10px", borderRadius: 7,
                          border: `1.5px solid ${personalId === p.id ? "#5B21B6" : "#E2E8F0"}`,
                          background: personalId === p.id ? "#F5F3FF" : "white",
                          color: personalId === p.id ? "#5B21B6" : "#475569",
                          fontSize: 13, fontWeight: personalId === p.id ? 700 : 500,
                          cursor: "pointer", transition: "all .12s", textAlign: "left",
                        }}
                      >
                        <span>{p.nombre}</span>
                        {personalId === p.id && (
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {seleccionados.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "#94A3B8" }}>
                <svg width={38} height={38} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ opacity: .2 }}>
                  <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                  <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
                </svg>
                <span style={{ fontSize: 13 }}>Tocá un producto para agregar</span>
              </div>
            ) : (
              seleccionados.map(([id, qty]) => {
                const name = nameOf(id);
                const sub  = qty * priceOf(id);
                const catColor = isPromoId(id) ? PROMO_COLOR : (() => {
                  const p = products.find((prod) => prod.id === id);
                  return p?.category_id ? (catColorMap[p.category_id] ?? NAVY) : NAVY;
                })();
                return (
                  <div key={id} className="flex items-center gap-1.5 group" style={{ padding: "9px 12px", borderBottom: "1px solid #E2E8F0" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 5, background: NAVY_L, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: NAVY, fontSize: 10, fontWeight: 700 }}>
                      {name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      {canal === "pedido_ya" && (
                        <div className="flex items-center gap-1 mt-0.5" onClick={(e) => e.stopPropagation()}>
                          <span style={{ fontSize: 10, color: "#C05621", fontWeight: 700 }}>$</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={precioOverride[id] ?? String(basePriceOf(id))}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setPrecioOverride((p) => ({ ...p, [id]: e.target.value }))}
                            title="Precio para Pedido Ya"
                            style={{ width: 60, fontSize: 10, fontWeight: 700, color: "#C05621", border: "1px solid #FED7AA", borderRadius: 4, padding: "1px 3px", background: "#FFF7ED" }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => set(id, qty - step(id))} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #CBD5E1", background: "#F8FAFC", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontWeight: 600, color: "#1E293B" }}>−</button>
                      {isKg(id) ? (
                        renderKgInput(id, qty)
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 800, minWidth: 28, textAlign: "center", color: "#0F172A" }}>{fmtCant(id, qty)}</span>
                      )}
                      <button onClick={() => set(id, qty + step(id))} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid #CBD5E1", background: "#F8FAFC", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontWeight: 600, color: "#1E293B" }}>+</button>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, minWidth: 64, textAlign: "right" }}>
                      {sub > 0 ? AR.format(sub) : "—"}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0" style={{ padding: 12, borderTop: "1px solid #E2E8F0" }}>
            {/* Total */}
            <div className="flex items-baseline justify-between mb-2.5">
              <span style={{ fontSize: 13, color: "#64748B" }}>Total</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: "#0F172A", letterSpacing: -1 }}>{AR.format(totalPrecio)}</span>
            </div>

            {/* Warnings */}
            {cajaAbierta === false && (
              <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 7, background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                <p style={{ fontSize: 12, color: "#DC2626", fontWeight: 600, margin: 0 }}>Abrí la caja antes de registrar ventas</p>
              </div>
            )}
            {cajaAbierta !== false && canal === "cuenta_corriente" && !personalId && seleccionados.length > 0 && (
              <div style={{ marginBottom: 8, padding: "8px 10px", borderRadius: 7, background: "#FFF7ED", border: "1px solid #FED7AA" }}>
                <p style={{ fontSize: 12, color: "#C2410C", fontWeight: 600, margin: 0 }}>Seleccioná un beneficiario</p>
              </div>
            )}

            {/* Cobrar button */}
            {(() => {
              const disabled = seleccionados.length === 0 || cajaAbierta === false || (canal === "cuenta_corriente" && !personalId);
              return (
                <button
                  onClick={() => { setError(null); setShowPay(true); }}
                  disabled={disabled}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 8,
                    background: disabled ? "#E2E8F0" : NAVY,
                    color: disabled ? "#94A3B8" : "white",
                    fontSize: 15, fontWeight: 800, border: "none",
                    cursor: disabled ? "not-allowed" : "pointer",
                    letterSpacing: "-0.2px", transition: "all .15s",
                  }}
                >
                  {seleccionados.length === 0 ? "Cobrar" : `Cobrar ${AR.format(totalPrecio)}`}
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── MODAL CONFIRMAR COBRO ── */}
      {showPay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(15,23,42,.55)" }} onClick={() => setShowPay(false)}>
          <div
            style={{ background: "white", borderRadius: 12, padding: 24, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-baseline justify-between mb-4">
              <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0F172A" }}>Confirmar cobro</h3>
              <span style={{ fontSize: 22, fontWeight: 900, color: NAVY, letterSpacing: -1 }}>{AR.format(totalPrecio)}</span>
            </div>

            {/* Cta. Corriente: no cobra en el momento, no tiene sentido pedir medio de pago */}
            {canal === "cuenta_corriente" ? (
              <div style={{ background: "#F5F3FF", border: "1.5px solid #DDD6FE", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#5B21B6", margin: 0 }}>
                  Se carga a la cuenta corriente de {personal.find((p) => p.id === personalId)?.nombre ?? "el beneficiario"}.
                </p>
                <p style={{ fontSize: 12, color: "#7C6BAE", marginTop: 2 }}>No requiere cobro ahora.</p>
              </div>
            ) : (
            <>
            {/* Medios de pago — uno por fila con input de monto */}
            <div style={{ border: "1.5px solid #E2E8F0", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
              {PAY_METHODS.map((m, i) => {
                const val  = pagos[m.id];
                const num  = parseFloat(val) || 0;
                const isFirst = i === 0;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px",
                      borderTop: isFirst ? "none" : "1px solid #E2E8F0",
                      background: num > 0 ? NAVY_L : "white",
                    }}
                  >
                    <span style={{ color: num > 0 ? NAVY : "#94A3B8", display: "flex", flexShrink: 0 }}>{m.icon}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: num > 0 ? NAVY : "#475569" }}>{m.label}</span>
                    <div style={{ position: "relative", width: 120 }}>
                      <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 13, fontWeight: 600, color: "#94A3B8", pointerEvents: "none" }}>$</span>
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => setPagos((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        placeholder="0"
                        min={0}
                        autoFocus={isFirst}
                        style={{ width: "100%", padding: "7px 8px 7px 22px", border: `1.5px solid ${num > 0 ? NAVY : "#E2E8F0"}`, borderRadius: 6, fontSize: 13, fontWeight: 700, color: "#0F172A", outline: "none", fontFamily: "inherit", background: "white", textAlign: "right" }}
                        onFocus={(e) => (e.target.style.borderColor = NAVY)}
                        onBlur={(e) => (e.target.style.borderColor = num > 0 ? NAVY : "#E2E8F0")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total ingresado + vuelto/falta */}
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#64748B" }}>Ingresado</span>
                <span style={{ fontWeight: 700, color: totalIngresado >= totalPrecio ? "#0F172A" : "#94A3B8" }}>{AR.format(totalIngresado)}</span>
              </div>
              {Math.round(otrosMedios * 100) > Math.round(totalPrecio * 100) ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: RED_L, borderRadius: 6, padding: "9px 13px" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: RED }}>
                    Billetera/tarjeta/transferencia no puede superar el total — ahí no se da vuelto
                  </span>
                </div>
              ) : totalIngresado > 0 && totalIngresado !== totalPrecio && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: totalIngresado >= totalPrecio ? GREEN_L : RED_L, borderRadius: 6, padding: "9px 13px" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: totalIngresado >= totalPrecio ? GREEN : RED }}>
                    {totalIngresado >= totalPrecio
                      ? (vuelto !== null && vuelto > 0 ? "Vuelto efectivo" : totalIngresado > totalPrecio ? "Excedente" : "Exacto ✓")
                      : "Falta"}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 900, color: totalIngresado >= totalPrecio ? GREEN : RED, letterSpacing: "-.5px" }}>
                    {totalIngresado >= totalPrecio
                      ? (vuelto !== null && vuelto > 0 ? AR.format(vuelto) : totalIngresado > totalPrecio ? AR.format(totalIngresado - totalPrecio) : "—")
                      : AR.format(totalPrecio - totalIngresado)}
                  </span>
                </div>
              )}
            </div>
            </>
            )}

            {/* Notas */}
            <textarea
              placeholder="Observaciones opcionales…" value={notas} onChange={(e) => setNotas(e.target.value)} rows={1}
              style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #E2E8F0", borderRadius: 6, fontSize: 13, outline: "none", fontFamily: "inherit", resize: "none", marginBottom: 4 }}
              onFocus={(e) => (e.target.style.borderColor = NAVY)}
              onBlur={(e) => (e.target.style.borderColor = "#E2E8F0")}
            />

            {error && <p style={{ fontSize: 12, color: RED, marginBottom: 8 }}>{error}</p>}

            {/* Buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowPay(false)}
                style={{ flex: 1, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 700, background: "white", color: "#64748B", border: "1.5px solid #E2E8F0", cursor: "pointer" }}
              >Cancelar</button>
              {(() => {
                const montoInsuficiente = canal !== "cuenta_corriente" && Math.round(totalIngresado * 100) < Math.round(totalPrecio * 100);
                const otrosMediosDeMas  = canal !== "cuenta_corriente" && Math.round(otrosMedios * 100) > Math.round(totalPrecio * 100);
                const disabled = pending || montoInsuficiente || otrosMediosDeMas;
                return (
                  <button
                    onClick={handleConfirm}
                    disabled={disabled}
                    style={{ flex: 1, padding: 12, borderRadius: 8, fontSize: 14, fontWeight: 700, background: disabled ? "#E2E8F0" : NAVY, color: disabled ? "#94A3B8" : "white", border: "none", cursor: disabled ? "not-allowed" : "pointer" }}
                  >{pending ? "Guardando…" : "Confirmar venta"}</button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
