import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const wa = vi.hoisted(() => ({
  enviarTexto:   vi.fn(async (..._a: any[]) => ({ ok: true })),
  enviarBotones: vi.fn(async (..._a: any[]) => ({ ok: true })),
  enviarLista:   vi.fn(async (..._a: any[]) => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/enviar-mensaje", () => wa);
vi.mock("@/lib/pedidos/interpretar-pedido-ia", () => ({ interpretarPedidoConIA: vi.fn(async () => []) }));

import { estadoInicial, leerEstado, serializarEstado } from "@/lib/pedidos/bot/estado";
import { agregarAlCarrito, fusionarCarritos, formatearCarrito, indexarCatalogo, aItemsPedido } from "@/lib/pedidos/bot/carrito";
import { siguientePaso, opcionesEntrega, textoConfirmacion, type ConfigCheckout } from "@/lib/pedidos/bot/checkout";
import { paginar } from "@/lib/pedidos/bot/mensajes";
import { procesarMensajeBot } from "@/lib/pedidos/bot/procesar";

const ZONA = { id: "z1", nombre: "Centro", costo: 800, etaMin: 30, etaMax: 45 };
const cfg = (over: Partial<ConfigCheckout> = {}): ConfigCheckout => ({ habilitado: true, retiro: true, delivery: true, zonas: [ZONA], ...over });

describe("estado del bot", () => {
  it("un bot_paso ausente, corrupto o de otra versión arranca de cero", () => {
    expect(leerEstado(null)).toEqual(estadoInicial());
    expect(leerEstado("{no es json")).toEqual(estadoInicial());
    expect(leerEstado(JSON.stringify({ modo: "menu", carrito: [] }))).toEqual(estadoInicial());
  });
  it("ida y vuelta conserva paso, carrito y checkout", () => {
    const e = { paso: "eligiendo_pago" as const, carrito: [{ id: "p1", esPromo: false, cantidad: 2 }], checkout: { tipo: "delivery" as const, zonaId: "z1" } };
    expect(leerEstado(serializarEstado(e))).toMatchObject(e);
  });
});

describe("carrito del bot", () => {
  it("sumar el mismo ítem acumula cantidad; producto y promo con el mismo id no se mezclan", () => {
    let c = agregarAlCarrito([], "a", false, 1);
    c = agregarAlCarrito(c, "a", false, 2);
    c = agregarAlCarrito(c, "a", true, 1);
    expect(c).toEqual([{ id: "a", esPromo: false, cantidad: 3 }, { id: "a", esPromo: true, cantidad: 1 }]);
  });
  it("fusionarCarritos suma la propuesta de la IA sobre el carrito", () => {
    expect(fusionarCarritos([{ id: "a", esPromo: false, cantidad: 1 }], [{ id: "a", esPromo: false, cantidad: 1 }, { id: "b", esPromo: true, cantidad: 2 }]))
      .toEqual([{ id: "a", esPromo: false, cantidad: 2 }, { id: "b", esPromo: true, cantidad: 2 }]);
  });
  it("formatearCarrito usa el precio del catálogo y omite lo que ya no existe", () => {
    const indice = indexarCatalogo([{ id: "a", esPromo: false, name: "Agua", price: 500, image: null, categoriaId: "c" }]);
    const r = formatearCarrito([{ id: "a", esPromo: false, cantidad: 2 }, { id: "zz", esPromo: false, cantidad: 1 }], indice);
    expect(r.total).toBe(1000);
    expect(r.texto).toContain("2x Agua");
    expect(r.texto.split("\n")).toHaveLength(1);
  });
  it("aItemsPedido nunca lleva precio", () => {
    expect(aItemsPedido([{ id: "a", esPromo: false, cantidad: 1 }, { id: "b", esPromo: true, cantidad: 2 }]))
      .toEqual([{ product_id: "a", cantidad: 1 }, { promo_id: "b", cantidad: 2 }]);
  });
});

describe("checkout del bot: siguientePaso", () => {
  it("sin nombre pide el nombre primero", () => {
    expect(siguientePaso(cfg(), null, {}).paso).toBe("pidiendo_nombre");
  });
  it("con retiro y envío disponibles pregunta cómo lo recibe", () => {
    expect(siguientePaso(cfg(), "Ana", {}).paso).toBe("eligiendo_entrega");
  });
  it("con una sola forma de entrega la elige sola y sigue al pago", () => {
    const r = siguientePaso(cfg({ delivery: false }), "Ana", {});
    expect(r).toMatchObject({ paso: "eligiendo_pago", checkout: { tipo: "retiro_local" } });
  });
  it("delivery sin zonas cargadas no se ofrece", () => {
    expect(opcionesEntrega(cfg({ zonas: [] }))).toEqual(["retiro_local"]);
    expect(opcionesEntrega(cfg({ retiro: false, zonas: [] }))).toEqual([]);
  });
  it("envío: zona → dirección → pago → listo", () => {
    expect(siguientePaso(cfg(), "Ana", { tipo: "delivery" }).paso).toBe("eligiendo_zona");
    expect(siguientePaso(cfg(), "Ana", { tipo: "delivery", zonaId: "z1" }).paso).toBe("pidiendo_direccion");
    expect(siguientePaso(cfg(), "Ana", { tipo: "delivery", zonaId: "z1", direccion: "Calle 1" }).paso).toBe("eligiendo_pago");
    expect(siguientePaso(cfg(), "Ana", { tipo: "delivery", zonaId: "z1", direccion: "Calle 1", pago: "efectivo" }).paso).toBe("listo");
  });
  it("una zona que ya no existe se descarta y se vuelve a preguntar", () => {
    const r = siguientePaso(cfg(), "Ana", { tipo: "delivery", zonaId: "borrada", direccion: "x", pago: "efectivo" });
    expect(r).toMatchObject({ paso: "eligiendo_zona", checkout: { zonaId: undefined } });
  });
  it("si la sucursal ya no acepta pedidos online no hay checkout", () => {
    expect(siguientePaso(cfg({ habilitado: false }), "Ana", {}).paso).toBe("no_disponible");
  });
  it("una elección de entrega que dejó de estar disponible se descarta", () => {
    expect(siguientePaso(cfg({ delivery: false }), "Ana", { tipo: "delivery", zonaId: "z1" }))
      .toMatchObject({ paso: "eligiendo_pago", checkout: { tipo: "retiro_local" } });
  });
});

describe("mensajes del bot", () => {
  it("paginar deja lugar para 'ver más' (9 + 1 = las 10 filas de una lista de WhatsApp)", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(paginar(items, 0)).toMatchObject({ siguiente: 9 });
    expect(paginar(items, 0).pagina).toHaveLength(9);
    expect(paginar(items, 18)).toMatchObject({ pagina: [18, 19], siguiente: null });
  });
  it("la confirmación dice número, total, envío y cómo se paga", () => {
    const t = textoConfirmacion({ numero: 7, subtotal: 1000, costo_envio: 800, total: 1800, zona_nombre: "Centro", eta_min: 30, eta_max: 45 }, "Ana", "delivery", "mercadopago_link", "https://x/seg/1");
    expect(t).toContain("#7");
    expect(t).toContain("Envío (Centro)");
    expect(t).toContain("30–45 min");
    expect(t).toContain("link de pago");
    expect(t).toContain("https://x/seg/1");
    expect(textoConfirmacion({ numero: 8, subtotal: 1000, total: 1000 }, "Ana", "retiro_local", "efectivo", "https://x")).toContain("Pagás en efectivo cuando lo retirás");
  });
});

// Recorrido completo de una conversación contra una base simulada: el estado se
// guarda en bot_paso entre mensaje y mensaje, igual que en producción.
describe("conversación del bot (de punta a punta)", () => {
  const WA = "5493764000000";
  let botPaso: string | null;
  let stockAgua = 50;
  let nombre: string | null;
  let pedidoFinal: any;

  function mundo() {
    stockAgua = 50;
    botPaso = null; nombre = "Ana"; pedidoFinal = null;
    const sucursal = { is_active: true, pedidos_online_habilitado: true, delivery_habilitado: true, retiro_habilitado: true, pedido_minimo_envio: 0, retiro_eta_min: 15, retiro_eta_max: 25, categorias_habilitadas: null, promos_habilitadas: true };
    return fakeAdmin((q: Q) => {
      switch (q.table) {
        case "categories":       return { data: [{ id: "c1", name: "Bebidas" }] };
        case "products":         return { data: [{ id: "p1", name: "Agua", category_id: "c1", cover_image_url: null, unit_label: null, vendible_pos: true, is_active: true }] };
        case "product_prices":   return { data: [{ product_id: "p1", precio_dist: 1000 }] };
        case "promos": case "promo_prices": return { data: [] };
        case "sucursales":       return { data: sucursal };
        case "zonas_entrega":    return { data: [{ id: "z1", nombre: "Centro", costo: 800, eta_min: 30, eta_max: 45 }] };
        case "stock_sucursal":   return { data: [{ product_id: "p1", product_name: "Agua", stock_actual: stockAgua }] };
        case "pedido_rate_limits": return { count: 0 };
        case "pedido_items":     return { data: null };
        case "pedidos": {
          if (q.op === "select") return { data: { id: "ped-1", bot_paso: botPaso, cliente_nombre: nombre } };
          if (q.op === "update" && q.payload.estado) { pedidoFinal = q; return { data: { id: "ped-1", numero: 7, estado: q.payload.estado } }; }
          if (q.op === "update" && q.payload.bot_paso !== undefined) botPaso = q.payload.bot_paso;
          if (q.op === "update" && q.payload.cliente_nombre) nombre = q.payload.cliente_nombre;
          return { data: null };
        }
      }
    });
  }

  const boton = (id: string) => ({ button_reply: { id } });
  const fila = (id: string) => ({ list_reply: { id } });
  const enviar = (admin: any, m: { texto?: string; interactive?: any }) =>
    procesarMensajeBot(admin, { sucursalId: "s1", phoneNumberId: "pn1", waId: WA, nombrePerfil: "Ana", texto: m.texto ?? null, interactive: m.interactive ?? null });
  const ultimoTexto = () => JSON.stringify([...wa.enviarTexto.mock.calls, ...wa.enviarBotones.mock.calls].map((c) => c[2]));

  beforeEach(() => { vi.clearAllMocks(); });

  it("categoría → producto → envío → zona → dirección → Mercado Pago: crea UN pedido completo con las reglas del storefront", async () => {
    const { admin } = mundo();
    await enviar(admin, { texto: "hola" });
    expect(wa.enviarLista).toHaveBeenCalledTimes(1);

    await enviar(admin, { interactive: fila("cat_c1") });
    await enviar(admin, { interactive: fila("prod_p1") });
    await enviar(admin, { interactive: boton("accion_finalizar") });
    expect(JSON.stringify(wa.enviarBotones.mock.calls.at(-1))).toContain("entrega_delivery");

    await enviar(admin, { interactive: boton("entrega_delivery") });
    expect(JSON.stringify(wa.enviarLista.mock.calls.at(-1))).toContain("zona_z1");

    await enviar(admin, { interactive: fila("zona_z1") });
    expect(ultimoTexto()).toContain("dirección de entrega");

    await enviar(admin, { texto: "  Calle   123 " });
    expect(JSON.stringify(wa.enviarBotones.mock.calls.at(-1))).toContain("pago_mp");

    await enviar(admin, { interactive: boton("pago_mp") });
    expect(pedidoFinal.payload).toMatchObject({
      origen: "whatsapp", cliente_wa_id: WA, estado: "pendiente_pago", tipo_entrega: "delivery",
      zona_entrega_id: "z1", direccion_entrega: "Calle 123", medio_pago: "mercadopago_link",
      subtotal: 1000, costo_envio: 800, total: 1800,
    });
    // Se completa la fila de la conversación (no se crea otra) y solo si sigue en 'carrito'.
    expect(pedidoFinal.filters.find((f: any) => f.col === "estado")).toMatchObject({ op: "eq", val: "carrito" });
    expect(ultimoTexto()).toContain("#7");
  });

  it("un botón viejo de otro paso no pisa lo elegido: repite la pregunta actual", async () => {
    const { admin } = mundo();
    await enviar(admin, { interactive: fila("cat_c1") });
    await enviar(admin, { interactive: fila("prod_p1") });
    await enviar(admin, { interactive: boton("accion_finalizar") });
    await enviar(admin, { interactive: boton("pago_efectivo") }); // todavía no toca elegir el pago
    expect(leerEstado(botPaso).paso).toBe("eligiendo_entrega");
    expect(leerEstado(botPaso).checkout.pago).toBeUndefined();
    expect(pedidoFinal).toBeNull();
  });

  it("finalizar con el carrito vacío no arranca el checkout", async () => {
    const { admin } = mundo();
    await enviar(admin, { interactive: boton("accion_finalizar") });
    expect(ultimoTexto()).toContain("Todavía no agregaste");
    expect(pedidoFinal).toBeNull();
  });

  it("si el stock se agota DESPUÉS de agregar al carrito, el pedido se rechaza con el motivo y sin perder los productos", async () => {
    const { admin } = mundo();
    await enviar(admin, { interactive: fila("prod_p1") });
    expect(leerEstado(botPaso).carrito).toHaveLength(1);
    stockAgua = 0; // alguien se llevó lo último
    await enviar(admin, { interactive: boton("accion_finalizar") });
    await enviar(admin, { interactive: boton("entrega_retiro") });
    await enviar(admin, { interactive: boton("pago_efectivo") });
    expect(pedidoFinal).toBeNull();
    expect(leerEstado(botPaso)).toMatchObject({ paso: "menu", carrito: [{ id: "p1", cantidad: 1 }] });
    expect(ultimoTexto()).toMatch(/stock/i);
  });

  it("un producto agotado ya no se ofrece: no aparece en la lista y no se puede agregar", async () => {
    const { admin } = mundo();
    stockAgua = 0;
    await enviar(admin, { interactive: fila("cat_c1") });
    expect(wa.enviarLista).not.toHaveBeenCalled(); // la categoría quedó vacía: no hay lista que mostrar
    expect(ultimoTexto()).toContain("no tiene productos disponibles");
    await enviar(admin, { interactive: fila("prod_p1") }); // un botón de una lista vieja
    expect(ultimoTexto()).toContain("ya no está disponible");
    expect(leerEstado(botPaso).carrito).toEqual([]);
  });
});
