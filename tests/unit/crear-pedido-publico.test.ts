import { describe, it, expect, vi } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { crearPedidoPublico, type DatosPedidoPublico } from "@/lib/pedidos/crear-pedido-publico";

const SUC = "suc-1";
const datos = (over: Partial<DatosPedidoPublico> = {}): DatosPedidoPublico => ({
  sucursal_id: SUC, cliente_nombre: "Ana", cliente_telefono: "3764123456", notas: null,
  tipo_entrega: "retiro_local", zona_entrega_id: null, direccion_entrega: null, direccion_referencia: null,
  medio_pago: "efectivo", pago_con: null, items: [{ product_id: "p1", cantidad: 2 }], ...over,
});

type Mundo = { sucursal?: any; zona?: any; rateCount?: number; stock?: number; itemsError?: boolean };
function mundo(m: Mundo = {}) {
  const sucursal = { is_active: true, pedidos_online_habilitado: true, delivery_habilitado: true, retiro_habilitado: true, pedido_minimo_envio: 0, retiro_eta_min: 15, retiro_eta_max: 25, categorias_habilitadas: null, promos_habilitadas: true, ...m.sucursal };
  return fakeAdmin((q: Q) => {
    switch (q.table) {
      case "pedido_rate_limits": return { count: m.rateCount ?? 0 };
      case "sucursales": return { data: sucursal };
      case "products": return { data: [{ id: "p1", category_id: null, is_active: true, vendible_pos: true }] };
      case "product_prices": return { data: [{ product_id: "p1", precio_dist: 1000 }] };
      case "stock_sucursal": return { data: [{ product_id: "p1", product_name: "Alfajor", stock_actual: m.stock ?? 100 }] };
      case "zonas_entrega": return { data: m.zona === undefined ? { id: "z1", nombre: "Centro", costo: 800, eta_min: 30, eta_max: 45 } : m.zona };
      case "pedidos": return q.op === "insert" ? { data: { id: "ped-1", numero: 12, estado: q.payload.estado } } : { data: null };
      case "pedido_items": return m.itemsError ? { error: { message: "fk" } } : { data: null };
    }
  });
}

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
    const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", zona_entrega_id: "z1", direccion_entrega: "Calle 123" }), "1.1.1.1");
    expect(r).toMatchObject({ costo_envio: 800, total: 2800 });
    const zonaQ = calls.find((c) => c.table === "zonas_entrega")!;
    expect(eqDe(zonaQ, "sucursal_id")).toBe(SUC);
    expect(eqDe(zonaQ, "is_active")).toBe(true);
  });

  it("delivery con zona inexistente/otra sucursal/inactiva se rechaza", async () => {
    const { admin } = mundo({ zona: null });
    const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", zona_entrega_id: "z-ajena", direccion_entrega: "x" }), "1.1.1.1");
    expect(r.error).toMatch(/zona/i);
  });

  it("respeta el mínimo de envío", async () => {
    const { admin } = mundo({ sucursal: { pedido_minimo_envio: 5000 } });
    const r = await crearPedidoPublico(admin, datos({ tipo_entrega: "delivery", zona_entrega_id: "z1", direccion_entrega: "x" }), "1.1.1.1");
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
    expect(r.error).toMatch(/stock suficiente/);
  });

  it("si falla el insert de ítems borra el pedido huérfano y devuelve el error", async () => {
    const { admin, calls } = mundo({ itemsError: true });
    const r = await crearPedidoPublico(admin, datos(), "ip");
    expect(r.error).toBe("fk");
    const borrado = calls.find((c) => c.table === "pedidos" && c.op === "delete")!;
    expect(eqDe(borrado, "id")).toBe("ped-1");
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
