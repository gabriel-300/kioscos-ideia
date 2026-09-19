import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// crearMovimiento es la ruta de venta del STAFF (la del mostrador): precio
// autoritativo del servidor, reparto de combos, descuento de Pedido Ya, medios
// de pago y permisos. Se prueba con el doble en memoria de Supabase y sin
// tocar la lógica (solo se mockean las fronteras: sesión, base, caché, IA).
// Los `it.fails` son hallazgos de la auditoría del 19/09/2026 (informe H-xx):
// pasan a "inesperadamente verdes" cuando se corrijan -- ahí se les saca el .fails.

const h = vi.hoisted(() => ({ session: { userId: "u1", role: "vendedor" }, admin: null as any }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/groq", () => ({ leerComprobanteConGroq: vi.fn(), validarComprobante: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireStaff: async () => h.session,
  requireAdmin: async () => {
    if (h.session.role !== "admin") throw new Error("Sin permisos de administrador");
    return h.session;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin, createClient: async () => ({}) }));

import { crearMovimiento } from "@/app/(admin)/admin/movimientos/actions";

const SUC = "suc-1";

type Esc = {
  role?: string;
  userId?: string;
  sucursal?: Record<string, unknown>;      // fila de sucursales (encargado_user_id, canales_habilitados...)
  vendedorEnSucursal?: boolean;
  apertura?: { id: string; created_at: string; created_by: string | null } | null;
  ultimoCierre?: { created_at: string } | null;
  recibidoPorTraspaso?: string | null;
  precios?: { product_id: string; precio_dist: number | null; costo?: number | null }[];
  productos?: { id: string; category_id: string | null }[];
  promos?: { id: string; price: number; is_active: boolean; promo_items: { product_id: string; cantidad: number }[] }[];
  preciosPromo?: { promo_id: string; price: number }[];
  rpcError?: string;
};

function montar(e: Esc = {}) {
  h.session = { userId: e.userId ?? "u1", role: e.role ?? "admin" };
  const f = fakeAdmin(
    (q: Q) => {
      switch (q.table) {
        case "sucursales": return { data: { encargado_user_id: h.session.userId, ...e.sucursal } };
        case "profile_sucursales": return { data: e.vendedorEnSucursal === false ? null : { id: "ps1" } };
        case "aperturas_caja": return { data: e.apertura ?? null };
        case "cierres_caja": return { data: e.ultimoCierre ?? null };
        case "traspasos_caja": return { data: e.recibidoPorTraspaso ? { recibido_por: e.recibidoPorTraspaso } : null };
        case "product_prices": return { data: e.precios ?? [] };
        case "products": return { data: e.productos ?? [] };
        case "promos": return { data: e.promos ?? [] };
        case "promo_prices": return { data: e.preciosPromo ?? [] };
        default: return { data: null };
      }
    },
    (name) => (name === "crear_movimiento_con_items"
      ? (e.rpcError ? { error: { message: e.rpcError } } : { data: "mov-1" })
      : { data: null }),
  );
  h.admin = f.admin;
  return { ...f, args: () => f.rpcCalls.find((c) => c.name === "crear_movimiento_con_items")?.args };
}

const base = (extra: Record<string, unknown> = {}) => ({
  sucursal_id: SUC, fecha: "2026-09-19", tipo: "venta" as const, notas: null, items: [] as any[], ...extra,
});
const P = (id: string, precio: number, costo = 10) => ({ product_id: id, precio_dist: precio, costo });

beforeEach(() => { h.session = { userId: "u1", role: "admin" }; });

describe("crearMovimiento -- el precio lo decide el servidor", () => {
  it("ignora el precio que manda el cliente y usa el de la sucursal", async () => {
    const t = montar({ precios: [P("p1", 1500)] });
    const r = await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 2, precio_unitario: 1 }] }));
    expect(r).toEqual({ movimiento_id: "mov-1" });
    expect(t.args().p_items[0]).toMatchObject({ precio_unitario: 1500, subtotal: 3000 });
  });

  it("Pedido Ya: acepta un precio MAYOR o igual al de catálogo (comisión de la app)", async () => {
    const t = montar({ precios: [P("p1", 1000)] });
    await crearMovimiento(base({ canal: "pedido_ya_plataforma", items: [{ product_id: "p1", cantidad: 1, precio_unitario: 1300 }] }));
    expect(t.args().p_items[0]).toMatchObject({ precio_unitario: 1300, subtotal: 1300 });
  });

  it("Pedido Ya: un precio MENOR al de catálogo se descarta (nunca se cobra menos)", async () => {
    const t = montar({ precios: [P("p1", 1000)] });
    await crearMovimiento(base({ canal: "pedido_ya_efectivo", items: [{ product_id: "p1", cantidad: 1, precio_unitario: 400 }] }));
    expect(t.args().p_items[0]).toMatchObject({ precio_unitario: 1000, subtotal: 1000 });
  });

  it("redondea el subtotal a centavos (sin arrastre de floats)", async () => {
    const t = montar({ precios: [P("p1", 1199.99)] });
    await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 0.3 }] }));
    expect(t.args().p_items[0].subtotal).toBe(360);
  });

  // H-08: si el producto no tiene fila de precio en la sucursal, precioAutorizado devuelve el del cliente.
  it.fails("un producto SIN precio de sucursal no puede venderse con el precio del cliente", async () => {
    const t = montar({ precios: [] });
    const r = await crearMovimiento(base({ items: [{ product_id: "sin-precio", cantidad: 1, precio_unitario: 0.01 }] }));
    expect(r.error).toBeTruthy();
    expect(t.args()).toBeUndefined();
  });
});

describe("crearMovimiento -- combos y recetas", () => {
  const promo = (precio: number, comps: { product_id: string; cantidad: number }[]) =>
    [{ id: "promo1", price: precio, is_active: true, promo_items: comps }];

  it("el precio de la promo POR SUCURSAL manda sobre el vestigial promos.price", async () => {
    const t = montar({ promos: promo(100, [{ product_id: "a", cantidad: 1 }]), preciosPromo: [{ promo_id: "promo1", price: 250 }], precios: [P("a", 1, 10)] });
    await crearMovimiento(base({ items: [{ promo_id: "promo1", cantidad: 2 }] }));
    expect(t.args().p_items).toEqual([expect.objectContaining({ product_id: "a", cantidad: 2, subtotal: 500, precio_unitario: null, promo_id: "promo1" })]);
  });

  it("reparte el precio proporcional al costo y la suma da EXACTO el precio de la promo", async () => {
    const t = montar({
      promos: promo(1999.99, [{ product_id: "a", cantidad: 1 }, { product_id: "b", cantidad: 2 }, { product_id: "c", cantidad: 3 }]),
      precios: [P("a", 1, 333.33), P("b", 1, 777.77), P("c", 1, 11.11)],
    });
    await crearMovimiento(base({ items: [{ promo_id: "promo1", cantidad: 3 }] }));
    const suma = Math.round(t.args().p_items.reduce((s: number, i: any) => s + i.subtotal, 0) * 100) / 100;
    expect(suma).toBe(Math.round(3 * 1999.99 * 100) / 100);
  });

  it("propiedad: en 200 combinaciones aleatorias la suma nunca se desvía ni un centavo ni queda negativa", async () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 200; n++) {
      const k = 1 + Math.floor(rnd() * 5);
      const comps = Array.from({ length: k }, (_, i) => ({ product_id: `p${i}`, cantidad: 1 + Math.floor(rnd() * 4) }));
      const costos = comps.map((c) => P(c.product_id, 1, Math.round(rnd() * 100000) / 100));
      const precio = Math.round(100 + rnd() * 500000) / 100;
      const cant = 1 + Math.floor(rnd() * 7);
      const t = montar({ promos: promo(precio, comps), precios: costos });
      await crearMovimiento(base({ items: [{ promo_id: "promo1", cantidad: cant }] }));
      const items = t.args().p_items as any[];
      const suma = Math.round(items.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
      expect(suma).toBe(Math.round(cant * precio * 100) / 100);
      expect(items.every((i) => i.subtotal >= 0)).toBe(true);
    }
  });

  it("sin costos cargados reparte en partes iguales (sin dividir por cero)", async () => {
    const t = montar({ promos: promo(100, [{ product_id: "a", cantidad: 1 }, { product_id: "b", cantidad: 1 }]), precios: [P("a", 1, 0), P("b", 1, 0)] });
    await crearMovimiento(base({ items: [{ promo_id: "promo1", cantidad: 1 }] }));
    expect(t.args().p_items.map((i: any) => i.subtotal)).toEqual([50, 50]);
  });

  it("rechaza promos inexistentes, inactivas o sin componentes", async () => {
    let t = montar({ promos: [] });
    expect((await crearMovimiento(base({ items: [{ promo_id: "x", cantidad: 1 }] }))).error).toBeTruthy();
    t = montar({ promos: [{ id: "promo1", price: 100, is_active: false, promo_items: [{ product_id: "a", cantidad: 1 }] }] });
    expect((await crearMovimiento(base({ items: [{ promo_id: "promo1", cantidad: 1 }] }))).error).toBeTruthy();
    t = montar({ promos: promo(100, []) });
    expect((await crearMovimiento(base({ items: [{ promo_id: "promo1", cantidad: 1 }] }))).error).toBeTruthy();
    expect(t.args()).toBeUndefined();
  });
});

describe("crearMovimiento -- descuento de Pedido Ya", () => {
  it("prorratea el descuento entre las líneas: el total cobrado es exacto y ninguna línea queda negativa", async () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 200; n++) {
      const k = 1 + Math.floor(rnd() * 4);
      const precios = Array.from({ length: k }, (_, i) => P(`p${i}`, Math.round((50 + rnd() * 5000) * 100) / 100));
      const items = precios.map((p) => ({ product_id: p.product_id, cantidad: 1 + Math.floor(rnd() * 3) }));
      const total = Math.round(items.reduce((s, it, i) => s + Math.round(it.cantidad * precios[i].precio_dist! * 100) / 100, 0) * 100) / 100;
      const descuento = Math.round(rnd() * total * 100) / 100;
      const t = montar({ precios });
      await crearMovimiento(base({ canal: "pedido_ya_efectivo", descuento_total: descuento, items }));
      const out = t.args().p_items as any[];
      const suma = Math.round(out.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
      expect(suma).toBe(Math.round((total - descuento) * 100) / 100);
      expect(out.every((i) => i.subtotal >= 0)).toBe(true);
      expect(Math.abs(t.args().p_pago_efectivo - suma)).toBeLessThan(0.005); // 100% del cobrado va a efectivo (a menos de un centavo)
    }
  });

  // Hallazgo nuevo de esta fase: `pagoEfectivo = items.reduce(...)` no se redondea. Hay 1 caso real en la
  // base (movimiento del 30/07, pedido_ya_efectivo, pago_efectivo = 11865.999999999998). Ese resto de float
  // entra a la suma de efectivo del traspaso de turno y puede volver "distinta de cero" una diferencia de $0.
  it.fails("pedido_ya_efectivo: p_pago_efectivo queda redondeado a centavos", async () => {
    const t = montar({ precios: [P("a", 0.1), P("b", 0.2)] });
    await crearMovimiento(base({ canal: "pedido_ya_efectivo", items: [{ product_id: "a", cantidad: 1 }, { product_id: "b", cantidad: 1 }] }));
    expect(t.args().p_pago_efectivo).toBe(0.3);
  });

  it("un descuento mayor al total se limita al total (nunca deja saldo negativo)", async () => {
    const t = montar({ precios: [P("p1", 1000)] });
    await crearMovimiento(base({ canal: "pedido_ya_plataforma", descuento_total: 99999, items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(t.args().p_items[0].subtotal).toBe(0);
  });

  it("en otros canales el descuento se ignora", async () => {
    const t = montar({ precios: [P("p1", 1000)] });
    await crearMovimiento(base({ canal: "consumidor_final", descuento_total: 500, items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(t.args().p_items[0].subtotal).toBe(1000);
  });
});

describe("crearMovimiento -- medios de pago", () => {
  const pagos = { pago_efectivo: 10, pago_billetera: 20, pago_tarjeta: 30, pago_transferencia: 40 };

  it("cuenta_corriente y pedido_ya_plataforma descartan TODOS los medios de pago del cliente", async () => {
    for (const canal of ["cuenta_corriente", "pedido_ya_plataforma"]) {
      const t = montar({ precios: [P("p1", 1000)] });
      await crearMovimiento(base({ canal, ...pagos, items: [{ product_id: "p1", cantidad: 1 }] }));
      expect(t.args()).toMatchObject({ p_pago_efectivo: null, p_pago_billetera: null, p_pago_tarjeta: null, p_pago_transferencia: null });
    }
  });

  it("pedido_ya_efectivo fuerza el 100% del total a efectivo", async () => {
    const t = montar({ precios: [P("p1", 1000)] });
    await crearMovimiento(base({ canal: "pedido_ya_efectivo", ...pagos, items: [{ product_id: "p1", cantidad: 2 }] }));
    expect(t.args()).toMatchObject({ p_pago_efectivo: 2000, p_pago_billetera: null, p_pago_tarjeta: null, p_pago_transferencia: null });
  });

  it("billetera + tarjeta + transferencia por encima del total se rechaza y NO llama al RPC", async () => {
    const t = montar({ precios: [P("p1", 1200)] });
    const r = await crearMovimiento(base({ pago_tarjeta: 12000, items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(r.error).toMatch(/no puede superar/);
    expect(t.args()).toBeUndefined();
  });

  it("igual al total pasa; el efectivo por encima del total es vuelto y también pasa", async () => {
    let t = montar({ precios: [P("p1", 1200)] });
    expect((await crearMovimiento(base({ pago_billetera: 1200, items: [{ product_id: "p1", cantidad: 1 }] }))).error).toBeUndefined();
    t = montar({ precios: [P("p1", 1200)] });
    expect((await crearMovimiento(base({ pago_efectivo: 2000, items: [{ product_id: "p1", cantidad: 1 }] }))).error).toBeUndefined();
  });

  it("el creador del movimiento sale de la sesión, no del cliente", async () => {
    const t = montar({ userId: "quien-vende", precios: [P("p1", 1000)] });
    await crearMovimiento({ ...base({ items: [{ product_id: "p1", cantidad: 1 }] }), created_by: "otro" } as any);
    expect(t.args().p_created_by).toBe("quien-vende");
  });

  it("si el RPC falla devuelve el mensaje de la base (no lanza)", async () => {
    montar({ precios: [P("p1", 1000)], rpcError: "Esta venta supera el límite de crédito" });
    const r = await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(r).toEqual({ movimiento_id: null, error: "Esta venta supera el límite de crédito" });
  });
});

describe("crearMovimiento -- permisos y validaciones", () => {
  it("solo el admin hace ajustes de stock", async () => {
    let t = montar({ role: "encargado", precios: [P("p1", 1)] });
    expect((await crearMovimiento(base({ tipo: "ajuste", items: [{ product_id: "p1", cantidad: -1 }] }))).error).toMatch(/ajustes/);
    t = montar({ role: "admin", precios: [P("p1", 1)] });
    expect((await crearMovimiento(base({ tipo: "ajuste", items: [{ product_id: "p1", cantidad: -1 }] }))).error).toBeUndefined();
    expect(t.args().p_tipo).toBe("ajuste");
  });

  it("el vendedor no carga entregas", async () => {
    const t = montar({ role: "vendedor", vendedorEnSucursal: true, precios: [P("p1", 1)] });
    const r = await crearMovimiento(base({ tipo: "entrega", items: [{ product_id: "p1", cantidad: 1, precio_unitario: 5 }] }));
    expect(r.error).toMatch(/entregas/);
    expect(t.args()).toBeUndefined();
  });

  it("cantidad <= 0 se rechaza salvo en ajustes; una merma exige motivo", async () => {
    montar({ precios: [P("p1", 1)] });
    expect((await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 0, precio_unitario: null }] }))).error).toMatch(/mayor a 0/);
    expect((await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: -2, precio_unitario: null }] }))).error).toMatch(/mayor a 0/);
    expect((await crearMovimiento(base({ tipo: "merma", notas: "  ", items: [{ product_id: "p1", cantidad: 1, precio_unitario: null }] }))).error).toMatch(/motivo/);
  });

  // La comprobación es `cantidad <= 0` y NaN <= 0 es false: NaN pasa hasta la base.
  it.fails("rechaza cantidad NaN", async () => {
    const t = montar({ precios: [P("p1", 1000)] });
    const r = await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: NaN }] }));
    expect(r.error).toBeTruthy();
    expect(t.args()).toBeUndefined();
  });

  it("un encargado no puede vender en la sucursal de otro", async () => {
    const t = montar({ role: "encargado", userId: "enc-A", sucursal: { encargado_user_id: "enc-B" }, precios: [P("p1", 1000)] });
    const r = await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(r.error).toMatch(/permisos/);
    expect(t.args()).toBeUndefined();
  });

  it("un vendedor sin esa sucursal asignada no puede vender", async () => {
    const t = montar({ role: "vendedor", vendedorEnSucursal: false, precios: [P("p1", 1000)] });
    expect((await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 1 }] }))).error).toMatch(/permisos/);
    expect(t.args()).toBeUndefined();
  });
});

describe("crearMovimiento -- tenedor de la caja", () => {
  const turno = { apertura: { id: "a1", created_at: "2026-09-19T10:00:00Z", created_by: "otra-persona" }, ultimoCierre: null };
  const vender = () => crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 1 }] }));

  it("un vendedor que NO tiene la caja abierta no puede vender: tiene que hacer el traspaso", async () => {
    const t = montar({ role: "vendedor", userId: "v1", vendedorEnSucursal: true, precios: [P("p1", 1000)], ...turno });
    expect((await vender()).error).toMatch(/Traspaso de turno/);
    expect(t.args()).toBeUndefined();
  });

  it("quien abrió el turno puede vender", async () => {
    const t = montar({ role: "vendedor", userId: "otra-persona", vendedorEnSucursal: true, precios: [P("p1", 1000)], ...turno });
    expect((await vender()).error).toBeUndefined();
    expect(t.args()).toBeDefined();
  });

  it("quien recibió la caja por traspaso puede vender", async () => {
    const t = montar({ role: "vendedor", userId: "v1", vendedorEnSucursal: true, recibidoPorTraspaso: "v1", precios: [P("p1", 1000)], ...turno });
    expect((await vender()).error).toBeUndefined();
    expect(t.args()).toBeDefined();
  });

  it("encargado y admin no están sujetos al tenedor", async () => {
    montar({ role: "encargado", userId: "enc", precios: [P("p1", 1000)], ...turno });
    expect((await vender()).error).toBeUndefined();
  });

  // H-10: el servidor no verifica que haya caja abierta; hoy lo evita solo la pantalla (0 ventas fuera de turno en la base).
  it.fails("un vendedor no puede vender con la caja CERRADA", async () => {
    const cerrada = { apertura: { id: "a1", created_at: "2026-09-19T10:00:00Z", created_by: "v1" }, ultimoCierre: { created_at: "2026-09-19T12:00:00Z" } };
    const t = montar({ role: "vendedor", userId: "v1", vendedorEnSucursal: true, precios: [P("p1", 1000)], ...cerrada });
    const r = await vender();
    expect(r.error).toBeTruthy();
    expect(t.args()).toBeUndefined();
  });
});

describe("crearMovimiento -- reglas por sucursal (H-08)", () => {
  // Villa Sarita: solo una categoría y solo consumidor_final. Hoy se aplica únicamente en la pantalla.
  it.fails("un concesionario no puede vender por un canal que su sucursal no tiene habilitado", async () => {
    const t = montar({
      role: "concesionario", userId: "conc", precios: [P("p1", 1000)],
      sucursal: { canales_habilitados: ["consumidor_final"], categorias_habilitadas: ["minutas"] },
    });
    const r = await crearMovimiento(base({ canal: "cuenta_corriente", items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(r.error).toBeTruthy();
    expect(t.args()).toBeUndefined();
  });

  it.fails("un concesionario no puede vender un producto de una categoría no habilitada", async () => {
    const t = montar({
      role: "concesionario", userId: "conc", precios: [P("p1", 1000)], productos: [{ id: "p1", category_id: "helados" }],
      sucursal: { categorias_habilitadas: ["minutas"] },
    });
    const r = await crearMovimiento(base({ items: [{ product_id: "p1", cantidad: 1 }] }));
    expect(r.error).toBeTruthy();
    expect(t.args()).toBeUndefined();
  });
});

describe("crearMovimiento -- alerta de cambio de costo en entregas", () => {
  it("genera una alerta solo si el costo cargado difiere del costo actual", async () => {
    const t = montar({ precios: [P("igual", 1, 100), P("cambia", 1, 100)] });
    await crearMovimiento(base({
      tipo: "entrega", proveedor: "Prov",
      items: [{ product_id: "igual", cantidad: 1, precio_unitario: 100 }, { product_id: "cambia", cantidad: 1, precio_unitario: 130 }],
    }));
    const alertas = t.calls.find((c) => c.table === "alertas_precio" && c.op === "insert")?.payload;
    expect(alertas).toEqual([expect.objectContaining({ product_id: "cambia", costo_anterior: 100, costo_nuevo: 130, movimiento_id: "mov-1" })]);
  });
});
