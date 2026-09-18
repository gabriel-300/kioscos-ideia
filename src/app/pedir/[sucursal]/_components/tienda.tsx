"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CategoriaCatalogo, ConfigTienda, FormCheckout, ItemCatalogo, Pantalla, PedidoConfirmado } from "../_lib/tipos";
import { fmt, sinTildes } from "../_lib/tema";
import { estadoHorario } from "@/lib/pedidos/horario";
import { iniciarPedido } from "@/lib/pedidos/actions";
import { StoreHeader, ClosedBanner } from "./store-header";
import { SearchBar, CategoryNav } from "./barra-busqueda-nav";
import { ProductCard, Foto } from "./producto-ui";
import { ProductSheet, CartBar, ClosedSheet } from "./overlays";
import { CartScreen } from "./cart-screen";
import { CheckoutScreen } from "./checkout-screen";
import { ConfirmationScreen } from "./confirmation-screen";
import { IconMas } from "./iconos";

const VIGENCIA_CARRITO_MS = 24 * 60 * 60 * 1000;
const MAX_POR_ITEM = 50;

type Guardado = { at: number; cantidades: Record<string, number>; form: FormCheckout };
type Contacto = { nombre: string; whatsapp: string; calle: string; referencia: string };

function leerJSON<T>(storage: Storage, clave: string): T | null {
  try {
    const raw = storage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function guardarJSON(storage: Storage, clave: string, valor: unknown) {
  try { storage.setItem(clave, JSON.stringify(valor)); } catch { /* modo privado / cuota: el carrito igual funciona en memoria */ }
}

export function Tienda({ config, catalogo }: { config: ConfigTienda; catalogo: CategoriaCatalogo[] }) {
  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0;
  const puedePedir = config.habilitado && (config.retiroHabilitado || enviosDisponibles);

  const formInicial: FormCheckout = useMemo(() => ({
    modo:       enviosDisponibles ? "envio" : "retiro",
    zonaId:     enviosDisponibles ? config.zonas[0].id : null,
    calle:      "",
    referencia: "",
    nombre:     "",
    whatsapp:   "",
    pago:       "efectivo",
    pagoCon:    "",
    notas:      "",
  }), [enviosDisponibles, config.zonas]);

  const [pantalla, setPantalla] = useState<Pantalla>("catalogo");
  const [productoAbierto, setProductoAbierto] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaDeb, setBusquedaDeb] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [form, setFormEstado] = useState<FormCheckout>(formInicial);
  const [hidratado, setHidratado] = useState(false);
  const [confirmado, setConfirmado] = useState<PedidoConfirmado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => new Date());
  const [avisoCerrado, setAvisoCerrado] = useState(false);
  const [activaId, setActivaId] = useState(catalogo[0]?.id ?? "");

  const itemsPorId = useMemo(() => {
    const m = new Map<string, ItemCatalogo>();
    for (const c of catalogo) for (const i of c.items) m.set(i.id, i);
    return m;
  }, [catalogo]);

  const claveStorage = `pedir:${config.sucursalId}`;
  const horario = estadoHorario(config.horario, ahora);

  // ── Carrito persistente: solo ids + cantidades (los precios salen siempre del catálogo) ──
  useEffect(() => {
    const guardado = leerJSON<Guardado>(localStorage, claveStorage);
    const contacto = leerJSON<Contacto>(localStorage, "pedir:contacto");
    let formRestaurado = formInicial;
    if (contacto) formRestaurado = { ...formRestaurado, ...contacto };
    if (guardado && Date.now() - guardado.at < VIGENCIA_CARRITO_MS) {
      const restauradas: Record<string, number> = {};
      for (const [id, qty] of Object.entries(guardado.cantidades ?? {})) {
        if (itemsPorId.has(id) && qty > 0) restauradas[id] = Math.min(qty, MAX_POR_ITEM);
      }
      setCantidades(restauradas);
      const zonaValida = config.zonas.some((z) => z.id === guardado.form?.zonaId);
      formRestaurado = {
        ...formRestaurado,
        ...guardado.form,
        modo: guardado.form?.modo === "envio" && !enviosDisponibles ? "retiro" : (guardado.form?.modo ?? formRestaurado.modo),
        zonaId: zonaValida ? guardado.form.zonaId : formRestaurado.zonaId,
      };
    }
    setFormEstado(formRestaurado);
    setHidratado(true);
    if (!estadoHorario(config.horario).abierto && !sessionStorage.getItem(`pedir:cerrado:${config.sucursalId}`)) setAvisoCerrado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hidratado) return;
    guardarJSON(localStorage, claveStorage, { at: Date.now(), cantidades, form } satisfies Guardado);
  }, [hidratado, cantidades, form, claveStorage]);

  // El estado abierto/cerrado se refresca solo mientras la página está abierta.
  useEffect(() => {
    const t = window.setInterval(() => setAhora(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setBusquedaDeb(busqueda), 150);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  const setForm = useCallback((parcial: Partial<FormCheckout>) => setFormEstado((f) => ({ ...f, ...parcial })), []);

  // ── Derivados ──────────────────────────────────────────────────────────
  const lineas = useMemo(
    () => Object.entries(cantidades)
      .filter(([id, qty]) => qty > 0 && itemsPorId.has(id))
      .map(([id, qty]) => ({ item: itemsPorId.get(id)!, qty })),
    [cantidades, itemsPorId]
  );
  const subtotal = lineas.reduce((s, l) => s + l.item.price * l.qty, 0);
  const cantidadTotal = lineas.reduce((s, l) => s + l.qty, 0);

  function cambiar(id: string, delta: number) {
    setCantidades((prev) => {
      const nueva = Math.max(0, Math.min(MAX_POR_ITEM, (prev[id] ?? 0) + delta));
      const copia = { ...prev };
      if (nueva === 0) delete copia[id]; else copia[id] = nueva;
      return copia;
    });
  }

  // Si se vacía el carrito estando en carrito/checkout, se vuelve al catálogo.
  useEffect(() => {
    if ((pantalla === "carrito" || pantalla === "checkout") && lineas.length === 0) setPantalla("catalogo");
  }, [pantalla, lineas.length]);

  // Con una pantalla o detalle encima, el catálogo de atrás no debe scrollear
  // (conserva su posición para cuando se vuelve).
  const overlayAbierto = pantalla !== "catalogo" || productoAbierto !== null || avisoCerrado;
  useEffect(() => {
    document.body.style.overflow = overlayAbierto ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [overlayAbierto]);

  // ── Categoría activa (scroll-spy) ──────────────────────────────────────
  const bloqueoSpy = useRef(0);
  useEffect(() => {
    if (busquedaDeb.trim()) return;
    const visibles = new Set<string>();
    const orden = catalogo.map((c) => c.id);
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          const id = (e.target as HTMLElement).dataset.seccion!;
          if (e.isIntersecting) visibles.add(id); else visibles.delete(id);
        }
        if (Date.now() < bloqueoSpy.current) return;
        const activa = [...orden].reverse().find((id) => visibles.has(id));
        if (activa) setActivaId(activa);
      },
      { rootMargin: "-150px 0px -70% 0px", threshold: 0 }
    );
    document.querySelectorAll<HTMLElement>("[data-seccion]").forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [busquedaDeb, catalogo]);

  function irACategoria(id: string) {
    const seccion = document.getElementById(`cat-${id}`);
    if (!seccion) return;
    bloqueoSpy.current = Date.now() + 800;
    setActivaId(id);
    window.scrollTo({ top: seccion.getBoundingClientRect().top + window.scrollY - 136, behavior: "smooth" });
  }

  // ── Búsqueda ───────────────────────────────────────────────────────────
  const consulta = sinTildes(busquedaDeb.trim());
  const resultados = useMemo(() => {
    if (!consulta) return [];
    const vistos = new Set<string>();
    const out: ItemCatalogo[] = [];
    for (const c of catalogo) for (const i of c.items) {
      if (vistos.has(i.id)) continue;
      if (sinTildes(i.name).includes(consulta) || sinTildes(i.categoriaNombre).includes(consulta)) { vistos.add(i.id); out.push(i); }
    }
    return out;
  }, [consulta, catalogo]);

  const placeholderBusqueda = useMemo(() => {
    const ejemplos: string[] = [];
    for (const c of catalogo) {
      if (c.id === "promos") continue;
      const palabra = c.items[0]?.name.trim().split(/\s+/)[0]?.toLowerCase();
      if (palabra && palabra.length > 3 && !palabra.startsWith("promo") && !ejemplos.includes(palabra)) ejemplos.push(palabra);
      if (ejemplos.length === 3) break;
    }
    return ejemplos.length ? `Buscar ${ejemplos.join(", ")}…` : "Buscar en el menú…";
  }, [catalogo]);

  // ── Confirmar pedido ───────────────────────────────────────────────────
  async function confirmar() {
    setEnviando(true);
    setErrorServidor(null);
    const pagoCon = form.pago === "efectivo" && form.pagoCon ? parseInt(form.pagoCon, 10) : null;
    let res;
    try {
      res = await iniciarPedido({
        sucursal_id:          config.sucursalId,
        cliente_nombre:       form.nombre,
        cliente_telefono:     form.whatsapp,
        notas:                form.notas || null,
        tipo_entrega:         form.modo === "envio" ? "delivery" : "retiro_local",
        zona_entrega_id:      form.modo === "envio" ? form.zonaId : null,
        direccion_entrega:    form.modo === "envio" ? form.calle : null,
        direccion_referencia: form.modo === "envio" ? form.referencia : null,
        medio_pago:           form.pago,
        pago_con:             pagoCon,
        items: lineas.map((l) => (l.item.esPromo ? { promo_id: l.item.id, cantidad: l.qty } : { product_id: l.item.id, cantidad: l.qty })),
      });
    } catch {
      res = { error: "No pudimos enviar el pedido. Revisá tu conexión e intentá de nuevo." };
    }
    setEnviando(false);

    if (res.error || !res.pedido_id) {
      setErrorServidor(res.error ?? "No pudimos enviar el pedido. Intentá de nuevo.");
      return;
    }

    setConfirmado({
      numero:      res.numero ?? 0,
      total:       res.total ?? subtotal,
      subtotal:    res.subtotal ?? subtotal,
      costoEnvio:  res.costo_envio ?? 0,
      tipoEntrega: form.modo === "envio" ? "delivery" : "retiro_local",
      zonaNombre:  res.zona_nombre ?? null,
      etaMin:      res.eta_min ?? null,
      etaMax:      res.eta_max ?? null,
      medioPago:   form.pago,
      pagoCon,
      lineas:      lineas.map((l) => ({ nombre: l.item.name, cantidad: l.qty, subtotal: l.item.price * l.qty })),
      cliente:     { nombre: form.nombre.trim(), whatsapp: form.whatsapp.trim() },
      direccion:   form.modo === "envio" ? form.calle.trim() : null,
      referencia:  form.modo === "envio" ? form.referencia.trim() : null,
      notas:       form.notas.trim() || null,
    });
    guardarJSON(localStorage, "pedir:contacto", { nombre: form.nombre, whatsapp: form.whatsapp, calle: form.calle, referencia: form.referencia } satisfies Contacto);
    setCantidades({});
    setPantalla("confirmacion");
  }

  const productoDetalle = productoAbierto ? itemsPorId.get(productoAbierto) ?? null : null;
  const buscando = consulta.length > 0;

  function tarjeta(item: ItemCatalogo, indice: number) {
    return (
      <ProductCard
        key={item.id}
        item={item}
        qty={cantidades[item.id] ?? 0}
        puedePedir={puedePedir}
        eager={indice < 4}
        onAdd={() => cambiar(item.id, 1)}
        onDec={() => cambiar(item.id, -1)}
        onOpen={() => setProductoAbierto(item.id)}
      />
    );
  }

  return (
    <>
      <StoreHeader config={config} horario={horario} />
      {!horario.abierto && puedePedir && <ClosedBanner proxima={horario.proximaApertura} />}
      {!puedePedir && (
        <div className="bg-pd-tint px-4 py-3 text-[13.5px] font-medium text-pd-ink-900">
          <div className="mx-auto max-w-[1100px]">Los pedidos online de esta sucursal llegan pronto. Mientras tanto podés mirar el menú.</div>
        </div>
      )}

      {/* Bloque fijo: buscador + categorías */}
      <div className="sticky top-0 z-40 bg-pd-paper px-4 pt-3" style={{ boxShadow: "0 8px 16px -14px rgba(34,25,15,.6)" }}>
        <div className="mx-auto max-w-[1100px]">
          <SearchBar value={busqueda} onChange={setBusqueda} placeholder={placeholderBusqueda} />
          {!buscando && <CategoryNav categorias={catalogo} activaId={activaId} onElegir={irACategoria} />}
          {buscando && <div className="h-2.5" />}
        </div>
      </div>

      <main className="mx-auto max-w-[1100px] px-4 pb-32 pt-4">
        {catalogo.length === 0 ? (
          <p className="py-20 text-center text-[14px] text-pd-ink-400">Todavía no hay productos cargados para pedir acá.</p>
        ) : buscando ? (
          <section aria-live="polite">
            <p className="mb-3 text-[13px] text-pd-ink-600">
              {resultados.length} {resultados.length === 1 ? "resultado" : "resultados"} para “{busquedaDeb.trim()}”
            </p>
            {resultados.length === 0 ? (
              <div className="py-14 text-center">
                <h2 className="text-[19px]">Sin resultados</h2>
                <p className="mt-1.5 text-[13.5px] text-pd-ink-600">Probá con otra palabra, o mirá las categorías.</p>
              </div>
            ) : (
              <div className="space-y-2.5 md:max-w-[760px]">
                {resultados.map((item) => {
                  const qty = cantidades[item.id] ?? 0;
                  return (
                    <div key={item.id} className="flex items-center gap-3 rounded-[18px] border border-pd-line bg-white p-2.5">
                      <button type="button" onClick={() => setProductoAbierto(item.id)} className="relative size-[66px] shrink-0 overflow-hidden rounded-[14px]" aria-label={`Ver ${item.name}`}>
                        <Foto item={item} className="size-full" textoClase="text-[9px]" />
                        {qty > 0 && <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-pd-ember text-[11px] font-bold text-white">{qty}</span>}
                      </button>
                      <button type="button" onClick={() => setProductoAbierto(item.id)} className="min-w-0 flex-1 text-left">
                        <p className="text-[14.5px] font-semibold leading-tight">{item.name}</p>
                        <p className="mt-0.5 text-[12px] text-pd-ink-400">{item.categoriaNombre}</p>
                        <p className="pd-display mt-1 text-[17px] font-extrabold">{fmt(item.price)}</p>
                      </button>
                      {puedePedir && (
                        <button
                          type="button"
                          onClick={() => cambiar(item.id, 1)}
                          aria-label={`Agregar ${item.name}`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-pd-ember text-white active:bg-pd-ember-dark"
                        >
                          <IconMas className="size-6" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <div className="space-y-9">
            {catalogo.map((c, ci) => (
              <section key={c.id} id={`cat-${c.id}`} data-seccion={c.id} aria-labelledby={`cat-t-${c.id}`} className="scroll-mt-[140px]">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 id={`cat-t-${c.id}`} className="text-[23px]">{c.name}</h2>
                  <span className="text-[12px] text-pd-ink-300">{c.items.length} {c.items.length === 1 ? "producto" : "productos"}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
                  {c.items.map((item, i) => tarjeta(item, ci === 0 ? i : 99))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {puedePedir && cantidadTotal > 0 && pantalla === "catalogo" && !productoAbierto && (
        <CartBar cantidad={cantidadTotal} total={subtotal} onAbrir={() => setPantalla("carrito")} />
      )}

      {productoDetalle && (
        <ProductSheet
          key={productoDetalle.id}
          item={productoDetalle}
          puedePedir={puedePedir}
          onCerrar={() => setProductoAbierto(null)}
          onAgregar={(n) => { cambiar(productoDetalle.id, n); setProductoAbierto(null); }}
        />
      )}

      {pantalla === "carrito" && (
        <CartScreen
          config={config}
          lineas={lineas}
          subtotal={subtotal}
          itemsPorId={itemsPorId}
          onVolver={() => setPantalla("catalogo")}
          onAgregarMas={() => setPantalla("catalogo")}
          onContinuar={() => setPantalla("checkout")}
          onInc={(id) => cambiar(id, 1)}
          onDec={(id) => cambiar(id, -1)}
          onAgregarItem={(id) => cambiar(id, 1)}
        />
      )}

      {pantalla === "checkout" && (
        <CheckoutScreen
          config={config}
          form={form}
          setForm={setForm}
          subtotal={subtotal}
          cantidadProductos={cantidadTotal}
          horario={horario}
          enviando={enviando}
          errorServidor={errorServidor}
          onVolver={() => { setErrorServidor(null); setPantalla("carrito"); }}
          onAgregarMas={() => setPantalla("catalogo")}
          onConfirmar={confirmar}
        />
      )}

      {pantalla === "confirmacion" && confirmado && (
        <ConfirmationScreen
          config={config}
          pedido={confirmado}
          horario={horario}
          onVolver={() => { setConfirmado(null); setPantalla("catalogo"); }}
        />
      )}

      {avisoCerrado && (
        <ClosedSheet
          proxima={horario.proximaApertura}
          onCerrar={() => { sessionStorage.setItem(`pedir:cerrado:${config.sucursalId}`, "1"); setAvisoCerrado(false); }}
        />
      )}

      <footer className="px-4 pb-28 pt-2 text-center text-[12px] text-pd-ink-300">Kioscos IDEIA</footer>
    </>
  );
}
