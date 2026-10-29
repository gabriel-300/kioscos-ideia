import { describe, it, expect } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";
import { armarLineas, formatearCantidad } from "@/lib/pedidos/lineas";
import { decidirTrasFalla, ESPERA_ENTRE_RECARGAS_MS, etiquetaEntrega, etiquetaPago, idsNoAvisados, marcarAvisados, podarAvisados, VIDA_AVISADOS_MS } from "@/lib/pedidos/aviso";
import { cargarLineasDePedidos } from "@/lib/pedidos/lineas-servidor";
import { detalleDePedidosPorAtender, idsPedidosPorAtender } from "@/lib/pedidos/por-atender";

describe("lineas: qué pidió el cliente", () => {
  const prod = new Map([["p1", "Chipa x 6"], ["p2", "Café"]]);
  const promos = new Map([["m1", "Combo merienda"]]);

  it("productos sueltos: cantidad × nombre", () => {
    expect(armarLineas([{ product_id: "p1", promo_id: null, cantidad: 2 }], prod, promos)).toEqual([{ titulo: "2× Chipa x 6", componentes: [] }]);
  });
  it("una promo se guarda como una fila por componente y se agrupa bajo su nombre", () => {
    const l = armarLineas([
      { product_id: "p1", promo_id: "m1", cantidad: 2 },
      { product_id: "p2", promo_id: "m1", cantidad: 1 },
      { product_id: "p2", promo_id: null, cantidad: 1 },
    ], prod, promos);
    expect(l).toEqual([
      { titulo: "Combo merienda", componentes: ["2× Chipa x 6", "1× Café"] },
      { titulo: "1× Café", componentes: [] },
    ]);
  });
  it("un nombre que no se encuentra no rompe: dice 'Producto' / 'Promo'", () => {
    expect(armarLineas([{ product_id: "x", promo_id: null, cantidad: 1 }], prod, promos)[0].titulo).toBe("1× Producto");
    expect(armarLineas([{ product_id: "p1", promo_id: "zz", cantidad: 1 }], prod, promos)[0].titulo).toBe("Promo");
  });
  it("las cantidades se muestran sin ceros de más (numeric llega como número o texto)", () => {
    expect(formatearCantidad("2.00")).toBe("2");
    expect(formatearCantidad(0.25)).toBe("0,25");
    expect(formatearCantidad(3)).toBe("3");
  });
});

describe("aviso: cómo se paga y se entrega", () => {
  const base = { medioPago: "efectivo", estado: "confirmado", pagoCon: null as number | null, total: 4500, delivery: false };

  it("efectivo con retiro: cuánto cobrar y dónde", () => {
    expect(etiquetaPago(base)).toMatch(/cobrar \$\s?4\.500 al retirar/);
  });
  it("efectivo con envío: al entregar, y el vuelto si paga con más", () => {
    const t = etiquetaPago({ ...base, delivery: true, pagoCon: 5000 });
    expect(t).toContain("al entregar");
    expect(t).toMatch(/paga con \$\s?5\.000 \(vuelto \$\s?500\)/);
  });
  it("si dice que paga con menos que el total no inventa un vuelto negativo", () => {
    expect(etiquetaPago({ ...base, pagoCon: 1000 })).not.toContain("vuelto");
  });
  it("Mercado Pago por link: avisa si todavía no pagó o si ya está pagado", () => {
    expect(etiquetaPago({ ...base, medioPago: "mercadopago_link", estado: "pendiente_pago" })).toBe("Mercado Pago: esperando el pago");
    expect(etiquetaPago({ ...base, medioPago: "mercadopago_link", estado: "pagado" })).toContain("ya pagado");
  });
  it("medio de pago desconocido no rompe", () => {
    expect(etiquetaPago({ ...base, medioPago: null })).toMatch(/sin definir/);
  });
  it("entrega", () => {
    expect(etiquetaEntrega({ delivery: false, zona: null })).toBe("Retiro en el local");
    expect(etiquetaEntrega({ delivery: true, zona: "Centro" })).toBe("Envío a domicilio · Centro");
  });
});

describe("aviso: pedidos ya vistos", () => {
  it("solo los que no se marcaron como vistos", () => {
    expect(idsNoAvisados(["a", "b", "c"], { b: 1 })).toEqual(["a", "c"]);
  });
  it("marcar agrega sin pisar lo anterior", () => {
    expect(marcarAvisados({ a: 1 }, ["b"], 5)).toEqual({ a: 1, b: 5 });
  });
  it("los vistos hace más de 2 días se olvidan (no crece sin límite)", () => {
    const ahora = 10 * VIDA_AVISADOS_MS;
    const r = podarAvisados({ viejo: ahora - VIDA_AVISADOS_MS - 1, reciente: ahora - 1000, roto: "x" as unknown as number }, ahora);
    expect(Object.keys(r)).toEqual(["reciente"]);
  });
});

// ── servidor ──
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const pedidoFila = (id: string, over: Record<string, unknown> = {}) => ({
  id, numero: 7, estado: "confirmado", tipo_entrega: "retiro_local", cliente_nombre: "Ana", cliente_telefono: "3764000000",
  direccion_entrega: null, direccion_referencia: null, zona_nombre: null, medio_pago: "efectivo", pago_con: 5000, notas: "sin cebolla",
  total: 4500, costo_envio: 0, descuento_total: 0, expira_en: null, created_at: "2026-10-13T12:00:00Z", sucursales: { nombre: "Parque de las Fiestas" }, ...over,
});

function mundo(opts: { pedidos?: any[]; asignadas?: any[]; items?: any[] } = {}) {
  return fakeAdmin((q: Q) => {
    if (q.table === "pedidos") return { data: opts.pedidos ?? [] };
    if (q.table === "profile_sucursales") return { data: opts.asignadas ?? [{ sucursal_id: "s1" }] };
    if (q.table === "pedido_items") return { data: opts.items ?? [] };
    if (q.table === "products") return { data: [{ id: "p1", name: "Chipa x 6" }, { id: "p2", name: "Café" }] };
    if (q.table === "promos") return { data: [{ id: "m1", name: "Combo merienda" }] };
  });
}

describe("cargarLineasDePedidos", () => {
  it("arma las líneas de cada pedido, ordenadas alfabéticamente", async () => {
    const { admin } = mundo({ items: [
      { id: "i1", pedido_id: UUID_A, product_id: "p2", promo_id: null, cantidad: 1 },
      { id: "i2", pedido_id: UUID_A, product_id: "p1", promo_id: null, cantidad: 2 },
      { id: "i3", pedido_id: UUID_B, product_id: "p1", promo_id: "m1", cantidad: 1 },
    ] });
    const m = await cargarLineasDePedidos(admin, [UUID_A, UUID_B]);
    expect(m.get(UUID_A)!.map((l) => l.titulo)).toEqual(["1× Café", "2× Chipa x 6"]);
    expect(m.get(UUID_B)![0]).toEqual({ titulo: "Combo merienda", componentes: ["1× Chipa x 6"] });
  });
  it("sin pedidos no consulta nada", async () => {
    const { admin, calls } = mundo();
    expect((await cargarLineasDePedidos(admin, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it("con muchos pedidos consulta en tandas (no arma una URL enorme)", async () => {
    const { admin, calls } = mundo();
    await cargarLineasDePedidos(admin, Array.from({ length: 120 }, (_, i) => `id-${i}`));
    const consultas = calls.filter((c) => c.table === "pedido_items");
    expect(consultas).toHaveLength(3);
    for (const c of consultas) expect((c.filters.find((f) => f.col === "pedido_id")!.val as string[]).length).toBeLessThanOrEqual(50);
  });
  it("si la consulta falla devuelve vacío en vez de romper la pantalla", async () => {
    const f = fakeAdmin(() => ({ error: { message: "boom" } }));
    expect((await cargarLineasDePedidos(f.admin, [UUID_A])).size).toBe(0);
  });
});

describe("idsPedidosPorAtender", () => {
  it("devuelve los ids de los que esperan al local (no los que ya se atienden ni los vencidos)", async () => {
    const { admin } = mundo({ pedidos: [
      { id: UUID_A, estado: "confirmado", medio_pago: "efectivo", expira_en: null },
      { id: UUID_B, estado: "en_preparacion", medio_pago: "efectivo", expira_en: null },
      { id: UUID_C, estado: "pendiente_pago", medio_pago: "mercadopago_link", expira_en: "2000-01-01T00:00:00Z" },
    ] });
    expect(await idsPedidosPorAtender(admin, "u-ids", "admin")).toEqual([UUID_A]);
  });
});

describe("detalleDePedidosPorAtender", () => {
  it("devuelve lo que pidió el cliente, cómo paga y las aclaraciones", async () => {
    const { admin } = mundo({
      pedidos: [pedidoFila(UUID_A)],
      items: [{ id: "i1", pedido_id: UUID_A, product_id: "p1", promo_id: null, cantidad: 2 }],
    });
    const [p] = await detalleDePedidosPorAtender(admin, "u-det1", "admin", [UUID_A]);
    expect(p).toMatchObject({ id: UUID_A, numero: 7, cliente: "Ana", sucursal: "Parque de las Fiestas", notas: "sin cebolla", pagoCon: 5000, total: 4500, delivery: false });
    expect(p.lineas).toEqual([{ titulo: "2× Chipa x 6", componentes: [] }]);
  });
  it("descarta ids que no son uuid y no consulta si no queda ninguno", async () => {
    const { admin, calls } = mundo();
    expect(await detalleDePedidosPorAtender(admin, "u-det2", "admin", ["1' or '1'='1", "../x", ""])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("revalida contra la base: un pedido que ya no está por atender no se muestra", async () => {
    const { admin } = mundo({ pedidos: [pedidoFila(UUID_A, { estado: "en_preparacion" })] });
    expect(await detalleDePedidosPorAtender(admin, "u-det3", "admin", [UUID_A])).toEqual([]);
  });
  it("un vendedor solo ve pedidos de SUS sucursales (aunque mande ids de otra)", async () => {
    const { admin, calls } = mundo({ pedidos: [pedidoFila(UUID_A)], asignadas: [{ sucursal_id: "s1" }] });
    await detalleDePedidosPorAtender(admin, "u-det4", "vendedor", [UUID_A]);
    const q = calls.find((c) => c.table === "pedidos")!;
    expect(q.filters.find((f) => f.col === "sucursal_id")!.val).toEqual(["s1"]);
    expect(eqDe(q, "sucursal_id")).toBeUndefined(); // es un .in, no un .eq
  });
  it("sin sucursales asignadas no consulta pedidos", async () => {
    const { admin, calls } = mundo({ asignadas: [] });
    expect(await detalleDePedidosPorAtender(admin, "u-det5", "repartidor", [UUID_A])).toEqual([]);
    expect(calls.some((c) => c.table === "pedidos")).toBe(false);
  });
  it("no devuelve más de 20 pedidos por aviso", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const { admin, calls } = mundo();
    await detalleDePedidosPorAtender(admin, "u-det6", "admin", ids);
    expect((calls.find((c) => c.table === "pedidos")!.filters.find((f) => f.col === "id")!.val as string[]).length).toBe(20);
  });
  it("si no se pudo leer el detalle igual avisa del pedido (sin líneas)", async () => {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "pedidos") return { data: [pedidoFila(UUID_A)] };
      if (q.table === "profile_sucursales") return { data: [{ sucursal_id: "s1" }] };
      if (q.table === "pedido_items") return { error: { message: "boom" } };
    });
    const [p] = await detalleDePedidosPorAtender(f.admin, "u-det7", "admin", [UUID_A]);
    expect(p.lineas).toEqual([]);
    expect(p.cliente).toBe("Ana");
  });
});

describe("decidirTrasFalla (el aviso no queda mudo)", () => {
  const AHORA = 10_000_000;
  it("una falla aislada no molesta: ni cartel ni recarga", () => {
    expect(decidirTrasFalla(1, null, AHORA)).toEqual({ mostrarAviso: false, recargar: false });
  });
  it("a la segunda falla seguida avisa en pantalla, sin recargar todavía", () => {
    expect(decidirTrasFalla(2, null, AHORA)).toEqual({ mostrarAviso: true, recargar: false });
  });
  it("a la tercera recarga sola (pestaña vieja tras un despliegue)", () => {
    expect(decidirTrasFalla(3, null, AHORA)).toEqual({ mostrarAviso: true, recargar: true });
  });
  it("pero no entra en un ciclo: si ya recargó hace poco, solo avisa", () => {
    expect(decidirTrasFalla(5, AHORA - 60_000, AHORA)).toEqual({ mostrarAviso: true, recargar: false });
    expect(decidirTrasFalla(5, AHORA - ESPERA_ENTRE_RECARGAS_MS, AHORA).recargar).toBe(true);
  });
});
