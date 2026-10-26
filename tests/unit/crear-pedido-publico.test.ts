import { describe, it, expect, vi } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));

// Los tests de siempre prueban el flujo con efectivo; la regla "solo Mercado Pago" tiene los suyos más abajo.
const medios = vi.hoisted(() => ({ efectivo: true }));
vi.mock("@/lib/pedidos/medios-pago", () => ({ aceptaEfectivoOnline: () => medios.efectivo, leerEfectivoOnline: async () => true }));

import { crearPedidoPublico, type DatosPedidoPublico } from "@/lib/pedidos/crear-pedido-publico";

const SUC = "suc-1";
const datos = (over: Partial<DatosPedidoPublico> = {}): DatosPedidoPublico => ({
  sucursal_id: SUC, cliente_nombre: "Ana", cliente_telefono: "3764123456", notas: null,
  tipo_entrega: "retiro_local", zona_entrega_id: null, direccion_entrega: null, direccion_referencia: null,
  medio_pago: "efectivo", pago_con: null, items: [{ product_id: "p1", cantidad: 2 }], ...over,
});

type Mundo = { sucursal?: any; zona?: any; rateCount?: number; stock?: number; itemsError?: boolean; pedidosPrevios?: number; unidad?: string };
function mundo(m: Mundo = {}) {
  const sucursal = { is_active: true, pedidos_online_habilitado: true, delivery_habilitado: true, retiro_habilitado: true, pedido_minimo_envio: 0, retiro_eta_min: 15, retiro_eta_max: 25, categorias_habilitadas: null, promos_habilitadas: true, ...m.sucursal };
  return fakeAdmin((q: Q) => {
    switch (q.table) {
      case "pedido_rate_limits": return { count: m.rateCount ?? 0 };
      case "sucursales": return { data: sucursal };
      case "products": return { data: [{ id: "p1", category_id: null, is_active: true, vendible_pos: true, unit_label: m.unidad ?? null }] };
      case "product_prices": return { data: [{ product_id: "p1", precio_dist: 1000 }] };
      case "stock_sucursal": return { data: [{ product_id: "p1", product_name: "Alfajor", stock_actual: m.stock ?? 100 }] };
      case "zonas_entrega": return { data: m.zona === undefined ? { id: "z1", nombre: "Centro", costo: 800, eta_min: 30, eta_max: 45 } : m.zona };
      case "pedidos": if (q.op === "select") return { count: m.pedidosPrevios ?? 0 };
        return (q.op === "insert" || (q.op === "update" && q.payload?.estado)) ? { data: { id: "ped-1", numero: 12, estado: q.payload.estado } } : { data: null };
      case "pedido_items": return m.itemsError ? { error: { message: "fk" } } : { data: null };
    }
  });
}

describe("crearPedidoPublico: pausas y horario de envíos", () => {
  const pausa = (motivo: string) => ({ motivo, desde: new Date(Date.now() - 60_000).toISOString(), hasta: null, por: "u1" });
  const envio = (over: Partial<DatosPedidoPublico> = {}) => datos({ tipo_entrega: "delivery", zona_entrega_id: "z1", direccion_entrega: "Calle 123", entrega_lat: -27.37, entrega_lng: -55.9, medio_pago: "mercadopago_link", ...over });

  it("con los pedidos en pausa no entra ninguno (ni retiro) y se ve el motivo", async () => {
    const { admin, calls } = mundo({ sucursal: { pausas_online: { pedidos: pausa("Mucha demanda") } } });
    const r = await crearPedidoPublico(admin, datos({ medio_pago: "mercadopago_link" }), "1.1.1.1");
    expect(r.error).toBe("Por ahora no estamos tomando pedidos online: Mucha demanda");
    expect(calls.some((c) => c.table === "pedidos" && c.op === "insert")).toBe(false);
  });
  it("con el envío suspendido se rechaza el envío pero el retiro sigue andando", async () => {
    const { admin } = mundo({ sucursal: { pausas_online: { envios: pausa("Sin repartidor") } } });
    expect((await crearPedidoPublico(admin, envio(), "1.1.1.1")).error).toBe("Los envíos están en pausa (Sin repartidor). Podés pedir para retirar en el local.");
    const retiro = await crearPedidoPublico(admin, datos({ medio_pago: "mercadopago_link" }), "1.1.1.1");
    expect(retiro.error).toBeUndefined();
  });
  it("una pausa que ya venció no frena nada", async () => {
    const vencida = { motivo: "x", desde: "2020-01-01T00:00:00Z", hasta: "2020-01-01T01:00:00Z", por: null };
    const { admin } = mundo({ sucursal: { pausas_online: { envios: vencida } } });
    expect((await crearPedidoPublico(admin, envio(), "1.1.1.1")).error).toBeUndefined();
  });
  it("con horario de envíos propio, fuera de la franja se rechaza el envío (el retiro no)", async () => {
    // una franja que nunca es ahora: todos los días de 03:00 a 03:01
    const franja = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: "03:00", cierra: "03:01" }));
    const { admin } = mundo({ sucursal: { horario_envios: franja } });
    expect((await crearPedidoPublico(admin, envio(), "1.1.1.1")).error).toMatch(/pedir para retirar en el local/);
    expect((await crearPedidoPublico(admin, datos({ medio_pago: "mercadopago_link" }), "1.1.1.1")).error).toBeUndefined();
  });
});

describe("crearPedidoPublico: entradas y topes (auditoría de seguridad 26/10)", () => {
  const rechaza = async (over: Partial<DatosPedidoPublico>, m: Mundo = {}) => {
    const { admin, calls } = mundo(m);
    const r = await crearPedidoPublico(admin, datos(over), "1.1.1.1");
    expect(calls.some((c) => c.table === "pedidos" && c.op === "insert")).toBe(false);
    return r.error;
  };

  it("un producto por unidad no admite fracciones (0,001 daba un subtotal de centavos)", async () => {
    expect(await rechaza({ items: [{ product_id: "p1", cantidad: 0.001 }] })).toBe("Cantidad inválida en el carrito");
    expect(await rechaza({ items: [{ product_id: "p1", cantidad: 1.5 }] })).toBe("Cantidad inválida en el carrito");
  });
  it("un producto por kilo admite de a 100 g, no menos ni medidas raras", async () => {
    const kg = { unidad: "kg" };
    const { admin } = mundo(kg);
    expect((await crearPedidoPublico(admin, datos({ items: [{ product_id: "p1", cantidad: 0.3 }] }), "1.1.1.1")).error).toBeUndefined();
    expect(await rechaza({ items: [{ product_id: "p1", cantidad: 0.01 }] }, kg)).toBe("Cantidad inválida en el carrito");
    expect(await rechaza({ items: [{ product_id: "p1", cantidad: 0.1234567 }] }, kg)).toBe("Cantidad inválida en el carrito");
  });
  it("las promos van de a unidades enteras", async () => {
    expect(await rechaza({ items: [{ promo_id: "pr1", cantidad: 0.5 }] })).toBe("Cantidad inválida en el carrito");
  });
  it("nombre, notas y direcciones tienen largo máximo, y los tipos raros se rechazan", async () => {
    expect(await rechaza({ cliente_nombre: "A".repeat(81) })).toMatch(/nombre es muy largo/);
    expect(await rechaza({ notas: "n".repeat(501) })).toMatch(/notas son muy largas/);
    expect(await rechaza({ tipo_entrega: "delivery", zona_entrega_id: "z1", entrega_lat: -27.37, entrega_lng: -55.9, direccion_entrega: "d".repeat(201) })).toMatch(/dirección es muy larga/);
    expect(await rechaza({ cliente_nombre: 123 as unknown as string })).toMatch(/no son válidos/);
    expect(await rechaza({ cliente_telefono: "3764123456" + " ".repeat(40) })).toMatch(/teléfono no es válido/);
  });
  it("pago_con tiene que ser un número finito y razonable", async () => {
    expect(await rechaza({ pago_con: Infinity })).toMatch(/monto con el que pagás/);
    expect(await rechaza({ pago_con: NaN })).toMatch(/monto con el que pagás/);
    expect(await rechaza({ pago_con: 1e12 })).toMatch(/monto con el que pagás/);
  });
  it("con 40 pedidos de Mercado Pago esperando el pago en el local, no entra otro", async () => {
    expect(await rechaza({ medio_pago: "mercadopago_link" }, { pedidosPrevios: 40 })).toMatch(/muchos pedidos esperando el pago/);
    const { admin } = mundo({ pedidosPrevios: 39 });
    expect((await crearPedidoPublico(admin, datos({ medio_pago: "mercadopago_link" }), "1.1.1.1")).error).toBeUndefined();
  });
  it("un cliente con 3 pedidos en efectivo en curso no abre otro", async () => {
    const { admin } = mundo({ pedidosPrevios: 3 });
    const r = await crearPedidoPublico(admin, datos(), "1.1.1.1", { clienteId: "cli-1" });
    expect(r.error).toMatch(/pedidos en curso/);
    const ok = mundo({ pedidosPrevios: 2 });
    expect((await crearPedidoPublico(ok.admin, datos(), "1.1.1.1", { clienteId: "cli-1" })).error).toBeUndefined();
  });
});

describe("crearPedidoPublico: solo Mercado Pago", () => {
  it("con el efectivo apagado rechaza un pedido en efectivo y NO crea nada", async () => {
    medios.efectivo = false;
    try {
      const { admin, calls } = mundo();
      const r = await crearPedidoPublico(admin, datos({ medio_pago: "efectivo" }), "1.1.1.1");
      expect(r.error).toMatch(/ingresar con Google/);
      expect(calls.some((c) => c.table === "pedidos" && c.op === "insert")).toBe(false);
    } finally { medios.efectivo = true; }
  });
  it("con el efectivo apagado el pago con Mercado Pago sigue funcionando", async () => {
    medios.efectivo = false;
    try {
      const { admin } = mundo();
      const r = await crearPedidoPublico(admin, datos({ medio_pago: "mercadopago_link" }), "1.1.1.1");
      expect(r.error).toBeUndefined();
      expect(r.estado).toBe("pendiente_pago");
    } finally { medios.efectivo = true; }
  });
});

describe("crearPedidoPublico", () => {
  it("efectivo + retiro: queda 'confirmado' y el total sale de los precios de la base", async () => {
    const { admin, calls } = mundo();
    const r = await crearPedidoPublico(admin, datos(), "1.1.1.1");
    expect(r).toMatchObject({ pedido_id: "ped-1", estado: "confirmado", subtotal: 2000, costo_envio: 0, total: 2000 });
    const ins = calls.find((c) => c.table === "pedidos" && c.op === "insert")!;
    expect(ins.payload).toMatchObject({ origen: "storefront", estado: "confirmado", total: 2000, expira_en: null });
  });

  it("mercadopago_link: queda 'pendiente_pago' con vencimiento a 2 horas", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
    const { admin, calls } = mundo();
    const r = await crearPedidoPublico(admin, datos({ medio_pago: "mercadopago_link" }), "1.1.1.1");
    expect(r.estado).toBe("pendiente_pago");
    expect(calls.find((c) => c.table === "pedidos" && c.op === "insert")!.payload.expira_en).toBe("2026-09-19T14:00:00.000Z");
    vi.useRealTimers();
  });

  it("delivery: el costo de envío sale de la zona de ESA sucursal (nunca del cliente)", async () => {
    const { admin, calls } = mundo();
    const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", entrega_lat: -27.37, entrega_lng: -55.9, zona_entrega_id: "z1", direccion_entrega: "Calle 123" }), "1.1.1.1");
    expect(r).toMatchObject({ costo_envio: 800, total: 2800 });
    const zonaQ = calls.find((c) => c.table === "zonas_entrega")!;
    expect(eqDe(zonaQ, "sucursal_id")).toBe(SUC);
    expect(eqDe(zonaQ, "is_active")).toBe(true);
  });

  describe("ubicación GPS de entrega", () => {
    const envio = (over: Partial<DatosPedidoPublico> = {}) => datos({ tipo_entrega: "delivery", entrega_lat: -27.37, entrega_lng: -55.9, zona_entrega_id: "z1", ...over });

    it("con GPS y sin calle el pedido entra: guarda el punto y deja la dirección como \"Ubicación compartida por GPS\"", async () => {
      const { admin, calls } = mundo();
      const r = await crearPedidoPublico(admin, envio({ entrega_lat: -27.3671234567, entrega_lng: -55.8961234567 }), "1.1.1.1");
      expect(r.error).toBeUndefined();
      const ins = calls.find((x) => x.table === "pedidos" && x.op === "insert")!;
      expect(ins.payload).toMatchObject({ direccion_entrega: "Ubicación compartida por GPS", entrega_latitud: -27.367123, entrega_longitud: -55.896123 });
    });
    it("con GPS y dirección escrita guarda las dos", async () => {
      const { admin, calls } = mundo();
      await crearPedidoPublico(admin, envio({ direccion_entrega: "Calle 123", entrega_lat: -27.36, entrega_lng: -55.89 }), "1.1.1.1");
      const ins = calls.find((x) => x.table === "pedidos" && x.op === "insert")!;
      expect(ins.payload).toMatchObject({ direccion_entrega: "Calle 123", entrega_latitud: -27.36 });
    });
    it("desde la tienda el envío exige la ubicación GPS (no alcanza con escribir la calle) y nada se crea", async () => {
      const { admin, calls } = mundo();
      const sinGps = { entrega_lat: null, entrega_lng: null };
      expect((await crearPedidoPublico(admin, envio(sinGps), "1.1.1.1")).error).toMatch(/Compartí tu ubicación/);
      expect(calls.some((x) => x.table === "pedidos" && x.op === "insert")).toBe(false);
    });
    it("el bot de WhatsApp sigue pudiendo pedir un envío con la dirección escrita (sin GPS)", async () => {
      const { admin, calls } = mundo();
      const r = await crearPedidoPublico(admin, envio({ direccion_entrega: "Calle 123", entrega_lat: null, entrega_lng: null }), "1.1.1.1", { bot: { cliente_wa_id: "w1", pedido_existente_id: "p1" } });
      expect(r.error).toBeUndefined();
      const ins = calls.find((x) => x.table === "pedidos" && (x.op === "insert" || x.op === "update") && x.payload?.direccion_entrega);
      expect(ins?.payload).not.toHaveProperty("entrega_latitud");
      expect(ins?.payload).toMatchObject({ direccion_entrega: "Calle 123" });
    });
    it("coordenadas inválidas se rechazan aunque haya calle (no se guarda basura)", async () => {
      for (const [lat, lng] of [[200, -55], [-27, 500], [Number.NaN, -55], [0, 0]] as const) {
        const { admin, calls } = mundo();
        const r = await crearPedidoPublico(admin, envio({ direccion_entrega: "Calle 123", entrega_lat: lat, entrega_lng: lng }), "1.1.1.1");
        expect(r.error, String([lat, lng])).toMatch(/ubicación/);
        expect(calls.some((x) => x.table === "pedidos" && x.op === "insert")).toBe(false);
      }
    });
    it("en un retiro en el local la ubicación se ignora", async () => {
      const { admin, calls } = mundo();
      const r = await crearPedidoPublico(admin, datos({ entrega_lat: -27.36, entrega_lng: -55.89 }), "1.1.1.1");
      expect(r.error).toBeUndefined();
      expect(calls.find((x) => x.table === "pedidos" && x.op === "insert")!.payload).not.toHaveProperty("entrega_latitud");
    });
  });

  it("delivery con zona inexistente/otra sucursal/inactiva se rechaza", async () => {
    const { admin } = mundo({ zona: null });
    const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", entrega_lat: -27.37, entrega_lng: -55.9, zona_entrega_id: "z-ajena", direccion_entrega: "x" }), "1.1.1.1");
    expect(r.error).toMatch(/zona/i);
  });

  it("respeta el mínimo de envío", async () => {
    const { admin } = mundo({ sucursal: { pedido_minimo_envio: 5000 } });
    const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", entrega_lat: -27.37, entrega_lng: -55.9, zona_entrega_id: "z1", direccion_entrega: "x" }), "1.1.1.1");
    expect(r.error).toMatch(/mínimo/);
  });

  it("pago_con menor al total se rechaza; igual o mayor pasa", async () => {
    expect((await crearPedidoPublico(mundo().admin, datos({ pago_con: 1500 }), "ip")).error).toMatch(/al menos el total/);
    expect((await crearPedidoPublico(mundo().admin, datos({ pago_con: 2000 }), "ip")).error).toBeUndefined();
  });

  it("sucursal inactiva o sin pedidos online no acepta pedidos", async () => {
    expect((await crearPedidoPublico(mundo({ sucursal: { is_active: false } }).admin, datos(), "ip")).error).toMatch(/no acepta pedidos/);
    expect((await crearPedidoPublico(mundo({ sucursal: { pedidos_online_habilitado: false } }).admin, datos(), "ip")).error).toMatch(/no acepta pedidos/);
  });

  it("rate limit: al 6to intento en la ventana devuelve error y NO crea el pedido", async () => {
    const { admin, calls } = mundo({ rateCount: 5 });
    const r = await crearPedidoPublico(admin, datos(), "1.1.1.1");
    expect(r.error).toMatch(/Demasiados intentos/);
    expect(calls.some((c) => c.table === "pedidos" && c.op === "insert")).toBe(false);
  });

  it("valida nombre, teléfono, tipo de entrega y medio de pago ANTES de gastar un intento del rate limit", async () => {
    const { admin, calls } = mundo();
    expect((await crearPedidoPublico(admin, datos({ cliente_nombre: "A" }), "ip")).error).toBeDefined();
    expect((await crearPedidoPublico(admin, datos({ cliente_telefono: "123" }), "ip")).error).toBeDefined();
    expect((await crearPedidoPublico(admin, datos({ tipo_entrega: "drone" as any }), "ip")).error).toBeDefined();
    expect((await crearPedidoPublico(admin, datos({ medio_pago: "bitcoin" as any }), "ip")).error).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it("stock insuficiente rechaza el pedido", async () => {
    const r = await crearPedidoPublico(mundo({ stock: 1 }).admin, datos(), "ip");
    expect(r.error).toMatch(/Quedan solo 1 de Alfajor y pediste 2/);
  });

  it("si falla el insert de ítems borra el pedido huérfano y devuelve el error", async () => {
    const { admin, calls } = mundo({ itemsError: true });
    const r = await crearPedidoPublico(admin, datos(), "ip");
    expect(r.error).toBe("fk");
    const borrado = calls.find((c) => c.table === "pedidos" && c.op === "delete")!;
    expect(eqDe(borrado, "id")).toBe("ped-1");
  });

  describe("beneficios de cliente registrado", () => {
    const cliente = { clienteId: "cli-1" };
    const conBeneficio = { descuento_cliente_pct: 10, descuento_cliente_solo_primera: false, envio_gratis_primera_compra: false };
    const inserto = (calls: Q[]) => calls.find((c) => c.table === "pedidos" && c.op === "insert")!.payload;
    const items = (calls: Q[]) => calls.find((c) => c.table === "pedido_items")!.payload as { subtotal: number }[];

    it("un invitado no recibe beneficio aunque la sucursal lo tenga configurado", async () => {
      const { admin, calls } = mundo({ sucursal: conBeneficio });
      const r = await crearPedidoPublico(admin, datos(), "ip");
      expect(r).toMatchObject({ descuento: 0, total: 2000 });
      expect(inserto(calls).cliente_id).toBeUndefined();
    });

    it("cliente registrado: descuento sobre productos, total menor y la venta refleja lo cobrado", async () => {
      const { admin, calls } = mundo({ sucursal: conBeneficio });
      const r = await crearPedidoPublico(admin, datos(), "ip", cliente);
      expect(r).toMatchObject({ subtotal: 2000, descuento: 200, total: 1800 });
      expect(inserto(calls)).toMatchObject({ cliente_id: "cli-1", descuento_total: 200, subtotal: 2000, total: 1800 });
      expect(items(calls).reduce((s, i) => s + i.subtotal, 0)).toBe(1800); // ítems = subtotal - descuento
    });

    it("el descuento no toca el envío", async () => {
      const { admin } = mundo({ sucursal: conBeneficio });
      const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", entrega_lat: -27.37, entrega_lng: -55.9, zona_entrega_id: "z1", direccion_entrega: "x" }), "ip", cliente);
      expect(r).toMatchObject({ descuento: 200, costo_envio: 800, total: 2600 });
    });

    it("'solo primera compra': con una compra previa ya no hay descuento", async () => {
      const cfg = { ...conBeneficio, descuento_cliente_solo_primera: true };
      expect((await crearPedidoPublico(mundo({ sucursal: cfg, pedidosPrevios: 0 }).admin, datos(), "ip", cliente)).descuento).toBe(200);
      expect((await crearPedidoPublico(mundo({ sucursal: cfg, pedidosPrevios: 1 }).admin, datos(), "ip", cliente)).descuento).toBe(0);
    });

    it("envío gratis en la primera compra: solo en delivery y solo la primera vez", async () => {
      const cfg = { descuento_cliente_pct: 0, descuento_cliente_solo_primera: false, envio_gratis_primera_compra: true };
      const delivery = datos({ tipo_entrega: "delivery", entrega_lat: -27.37, entrega_lng: -55.9, zona_entrega_id: "z1", direccion_entrega: "x" });
      expect(await crearPedidoPublico(mundo({ sucursal: cfg }).admin, delivery, "ip", cliente)).toMatchObject({ costo_envio: 0, envio_bonificado: true, total: 2000 });
      expect(await crearPedidoPublico(mundo({ sucursal: cfg, pedidosPrevios: 3 }).admin, { ...delivery, medio_pago: "mercadopago_link" }, "ip", cliente)).toMatchObject({ costo_envio: 800, envio_bonificado: false, total: 2800 });
      expect((await crearPedidoPublico(mundo({ sucursal: cfg }).admin, datos(), "ip", cliente)).envio_bonificado).toBe(false); // retiro: no hay envío que bonificar
    });

    it("con la sucursal sin beneficios (todo en 0) el cliente paga igual que un invitado", async () => {
      const r = await crearPedidoPublico(mundo().admin, datos(), "ip", cliente);
      expect(r).toMatchObject({ descuento: 0, total: 2000 });
    });

    it("el 'pago con' se valida contra el total YA con descuento", async () => {
      const { admin } = mundo({ sucursal: conBeneficio });
      expect((await crearPedidoPublico(admin, datos({ pago_con: 1800 }), "ip", cliente)).error).toBeUndefined();
    });
  });

  describe("con contexto de servidor (bot de WhatsApp)", () => {
    const ctx = { bot: { cliente_wa_id: "549376400", pedido_existente_id: "conv-1" } };

    it("completa la fila de la conversación (update, no insert) solo si sigue en 'carrito'", async () => {
      const { admin, calls } = mundo();
      const r = await crearPedidoPublico(admin, datos(), "wa:549376400", ctx);
      expect(r.error).toBeUndefined();
      expect(calls.some((c) => c.table === "pedidos" && c.op === "insert")).toBe(false);
      const upd = calls.find((c) => c.table === "pedidos" && c.op === "update")!;
      expect(upd.payload).toMatchObject({ origen: "whatsapp", cliente_wa_id: "549376400", estado: "confirmado" });
      expect(eqDe(upd, "id")).toBe("conv-1");
      expect(eqDe(upd, "estado")).toBe("carrito");
      expect(eqDe(upd, "sucursal_id")).toBe(SUC);
    });

    it("si falla el insert de ítems la conversación vuelve a 'carrito' (no se borra)", async () => {
      const { admin, calls } = mundo({ itemsError: true });
      const r = await crearPedidoPublico(admin, datos(), "ip", ctx);
      expect(r.error).toBe("fk");
      expect(calls.some((c) => c.table === "pedidos" && c.op === "delete")).toBe(false);
      const revert = calls.filter((c) => c.table === "pedidos" && c.op === "update").at(-1)!;
      expect(revert.payload).toMatchObject({ estado: "carrito" });
    });

    it("sin contexto el pedido sigue siendo del storefront (el browser no puede pedir otro origen)", async () => {
      const { admin, calls } = mundo();
      await crearPedidoPublico(admin, { ...datos(), origen: "whatsapp", pedido_existente_id: "conv-1" } as any, "ip");
      const ins = calls.find((c) => c.table === "pedidos" && c.op === "insert")!;
      expect(ins.payload.origen).toBe("storefront");
      expect(ins.payload.cliente_wa_id).toBeNull();
    });
  });

  // Hallazgo de auditoría: la sucursal puede tener horario_pedidos (abierto/cerrado) pero
  // el servidor no lo valida -- solo la UI. Un POST directo a iniciarPedido() entra igual.
  it("rechaza pedidos fuera del horario de atención de la sucursal", async () => {
    const cerrado = [{ dia: 0, abre: "08:00", cierra: "09:00" }, { dia: 1, abre: "08:00", cierra: "09:00" }, { dia: 2, abre: "08:00", cierra: "09:00" }, { dia: 3, abre: "08:00", cierra: "09:00" }, { dia: 4, abre: "08:00", cierra: "09:00" }, { dia: 5, abre: "08:00", cierra: "09:00" }, { dia: 6, abre: "08:00", cierra: "09:00" }];
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T18:00:00Z")); // 15:00 AR, todos los días cierra a las 9
    const r = await crearPedidoPublico(mundo({ sucursal: { horario_pedidos: cerrado } }).admin, datos(), "ip");
    vi.useRealTimers();
    expect(r.error).toBeDefined();
  });
});
