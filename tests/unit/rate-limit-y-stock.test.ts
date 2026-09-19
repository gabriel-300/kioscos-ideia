import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

let headersActuales = new Headers();
vi.mock("next/headers", () => ({ headers: async () => headersActuales, cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { chequearRateLimit, identificadorCliente } from "@/lib/pedidos/rate-limit";
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

describe("chequearRateLimit", () => {
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
    expect(await chequearStockLiviano(conStock(3), "s", dos)).toMatch(/stock suficiente/);
  });
  it("sin fila en la vista = stock desconocido, no bloquea", async () => {
    const admin = fakeAdmin(() => ({ data: [] })).admin;
    expect(await chequearStockLiviano(admin, "s", items(5))).toBeNull();
  });
  it("si la consulta falla NO bloquea el pedido (decisión de diseño: best-effort)", async () => {
    const admin = fakeAdmin(() => ({ error: { message: "x" } })).admin;
    expect(await chequearStockLiviano(admin, "s", items(5))).toBeNull();
  });
});
