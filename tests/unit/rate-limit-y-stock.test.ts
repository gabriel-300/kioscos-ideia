import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

let headersActuales = new Headers();
vi.mock("next/headers", () => ({ headers: async () => headersActuales, cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { chequearRateLimit, identificadorCliente, normalizarIp } from "@/lib/pedidos/rate-limit";
import { chequearStockLiviano } from "@/lib/pedidos/stock";

beforeEach(() => { headersActuales = new Headers(); });

describe("identificadorCliente", () => {
  it("prefiere cf-connecting-ip (lo setea el edge de Cloudflare, no se puede falsificar desde el cliente)", async () => {
    headersActuales = new Headers({ "cf-connecting-ip": "200.1.2.3", "x-forwarded-for": "6.6.6.6" });
    expect(await identificadorCliente("3764123456")).toBe("200.1.2.3");
  });
  it("sin el header cae al teléfono (solo dev/local: el atacante elige el teléfono, por eso no debe pasar en prod)", async () => {
    expect(await identificadorCliente("(376) 412-3456")).toBe("tel:3764123456");
  });
});

describe("normalizarIp (IPv6: se cuenta por el bloque /64)", () => {
  it("una IPv4 queda igual", () => {
    expect(normalizarIp("200.1.2.3")).toBe("200.1.2.3");
  });
  it("dos direcciones del mismo /64 dan el mismo identificador, aunque cambie lo último", () => {
    const a = normalizarIp("2800:2a0:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2800:02a0:0001:0002::/64");
    expect(normalizarIp("2800:2a0:1:2::1")).toBe(a);
    expect(normalizarIp("2800:2A0:1:2:1:2:3:4")).toBe(a);
  });
  it("otro /64 es otro identificador", () => {
    expect(normalizarIp("2800:2a0:1:3::1")).not.toBe(normalizarIp("2800:2a0:1:2::1"));
  });
  it("expande el :: y entiende una IPv4 mapeada", () => {
    expect(normalizarIp("::1")).toBe("0000:0000:0000:0000::/64");
    expect(normalizarIp("2001:db8::")).toBe("2001:0db8:0000:0000::/64");
    expect(normalizarIp("::ffff:200.1.2.3")).toBe("200.1.2.3");
  });
  it("identificadorCliente la usa", async () => {
    headersActuales = new Headers({ "cf-connecting-ip": "2800:2a0:1:2:9:9:9:9" });
    expect(await identificadorCliente("x")).toBe("2800:02a0:0001:0002::/64");
  });
});

describe("chequearRateLimit", () => {
  it("acepta otro límite y otra ventana (el upsell de la IA)", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T12:00:00Z"));
    const { admin, calls } = fakeAdmin((q: Q) => (q.op === "select" ? { count: 29 } : { data: null }));
    expect(await chequearRateLimit(admin, "upsell:1.1.1.1", { limite: 30, ventanaMs: 60_000 })).toBeNull();
    expect(calls.find((c) => c.op === "select")!.filters.find((f) => f.op === "gte")!.val).toBe("2026-09-19T11:59:00.000Z");
    const lleno = fakeAdmin(() => ({ count: 30 })).admin;
    expect(await chequearRateLimit(lleno, "upsell:1.1.1.1", { limite: 30 })).toMatch(/Demasiados intentos/);
    vi.useRealTimers();
  });
  it("bajo el límite: deja pasar y registra el intento", async () => {
    const { admin, calls } = fakeAdmin((q: Q) => (q.op === "select" ? { count: 4 } : { data: null }));
    expect(await chequearRateLimit(admin, "1.1.1.1")).toBeNull();
    expect(calls.some((c) => c.op === "insert" && c.payload.identificador === "1.1.1.1")).toBe(true);
  });

  it("en el límite (5 en 10 min): bloquea y NO registra otro intento", async () => {
    const { admin, calls } = fakeAdmin((q: Q) => (q.op === "select" ? { count: 5 } : { data: null }));
    expect(await chequearRateLimit(admin, "1.1.1.1")).toMatch(/Demasiados intentos/);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("la ventana es de 10 minutos y se filtra por identificador", async () => {
    const ahora = new Date("2026-09-19T12:00:00Z");
    vi.useFakeTimers(); vi.setSystemTime(ahora);
    const { admin, calls } = fakeAdmin(() => ({ count: 0 }));
    await chequearRateLimit(admin, "9.9.9.9");
    const sel = calls.find((c) => c.op === "select")!;
    expect(eqDe(sel, "identificador")).toBe("9.9.9.9");
    expect(sel.filters.find((f) => f.op === "gte")!.val).toBe("2026-09-19T11:50:00.000Z");
    vi.useRealTimers();
  });

  // Hallazgo de auditoría: cuenta y después inserta en dos pasos (no atómico). Con N
  // requests en paralelo todas leen count=4 y pasan. Este test documenta el hueco.
  it.fails("N requests simultáneas no pueden superar el límite (check-then-insert no es atómico)", async () => {
    let filas = 4;
    const { admin } = fakeAdmin(async (q: Q) => {
      if (q.op === "select") { await Promise.resolve(); return { count: filas }; }
      if (q.op === "insert") filas++;
      return { data: null };
    });
    const resultados = await Promise.all(Array.from({ length: 10 }, () => chequearRateLimit(admin, "1.1.1.1")));
    expect(resultados.filter((r) => r === null).length).toBeLessThanOrEqual(1);
  });
});

describe("chequearStockLiviano", () => {
  const items = (cantidad: number) => [{ product_id: "p1", promo_id: null, cantidad, precio_unitario: 10, subtotal: 10 * cantidad }];
  const conStock = (stock_actual: number) =>
    fakeAdmin(() => ({ data: [{ product_id: "p1", product_name: "Alfajor", stock_actual }] })).admin;

  it("hay stock suficiente -> null", async () => {
    expect(await chequearStockLiviano(conStock(10), "s", items(3))).toBeNull();
  });
  it("stock insuficiente -> mensaje con el nombre del producto", async () => {
    expect(await chequearStockLiviano(conStock(2), "s", items(3))).toMatch(/Alfajor/);
  });
  it("suma las líneas repetidas del mismo producto (ej. producto suelto + componente de combo)", async () => {
    const dos = [...items(2), ...items(2)];
    expect(await chequearStockLiviano(conStock(3), "s", dos)).toMatch(/Quedan solo 3/);
  });
  it("sin fila en la vista = el local nunca tuvo ese producto, se rechaza", async () => {
    const admin = fakeAdmin(() => ({ data: [] })).admin;
    expect(await chequearStockLiviano(admin, "s", items(5))).toMatch(/no está disponible en este local/);
  });
  it("si la consulta falla NO bloquea el pedido (decisión de diseño: best-effort)", async () => {
    const admin = fakeAdmin(() => ({ error: { message: "x" } })).admin;
    expect(await chequearStockLiviano(admin, "s", items(5))).toBeNull();
  });
});
