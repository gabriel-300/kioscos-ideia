import { describe, it, expect } from "vitest";
import { fakeAdmin, type Q, type Resp } from "../helpers/fake-supabase";
import { frescuraPosicion, POSICION_VIEJA_SEG, segundosDesde, textoHace, validarPosicion } from "@/lib/pedidos/posicion-repartidor";
import { borrarPosicionesDe, guardarPosicion, posicionParaCliente, posicionParaPersonal } from "@/lib/pedidos/posicion-servidor";

// Ubicación en vivo del repartidor: quién puede escribir (solo el asignado, solo en reparto), quién puede
// leer (el cliente solo SU pedido y solo en reparto), posición vieja y datos inválidos.

const SUC = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";
const AHORA = new Date("2026-10-23T15:00:00Z");
const hace = (seg: number) => new Date(AHORA.getTime() - seg * 1000).toISOString();

type Mundo = { pedidos?: any[]; posiciones?: any[] };
function mundo(m: Mundo = {}) {
  return fakeAdmin((q: Q): Resp | undefined => {
    if (q.table === "pedidos") {
      const pedidos = m.pedidos ?? [];
      const id = q.filters.find((f) => f.op === "eq" && f.col === "id")?.val;
      const suc = q.filters.find((f) => f.op === "eq" && f.col === "sucursal_id")?.val;
      return { data: pedidos.filter((p) => (id == null || p.id === id) && (suc == null || p.sucursal_id === suc)) };
    }
    if (q.table === "repartidor_posiciones" && q.op === "select") {
      const id = q.filters.find((f) => f.op === "eq" && f.col === "pedido_id")?.val;
      return { data: (m.posiciones ?? []).filter((p) => p.pedido_id === id) };
    }
  });
}

describe("validarPosicion", () => {
  it("acepta coordenadas válidas y las redondea", () => {
    const r = validarPosicion(-27.3671234567, -55.8960987654, 12.6);
    expect("valor" in r && r.valor).toEqual({ latitud: -27.367123, longitud: -55.896099, precision_m: 13 });
  });
  it.each([[NaN, 1], [91, 0.5], [0.5, 181], [0, 0], ["1", "2"], [null, null]])("rechaza %s,%s", (lat, lng) => {
    expect("error" in validarPosicion(lat, lng, null)).toBe(true);
  });
  it("rechaza una precisión inválida", () => {
    expect("error" in validarPosicion(-27.3, -55.8, -5)).toBe(true);
    expect("error" in validarPosicion(-27.3, -55.8, "x")).toBe(true);
  });
});

describe("antigüedad de la posición", () => {
  it("pasa a vieja pasado el límite", () => {
    expect(frescuraPosicion(POSICION_VIEJA_SEG)).toBe("vigente");
    expect(frescuraPosicion(POSICION_VIEJA_SEG + 1)).toBe("vieja");
  });
  it("calcula segundos y los escribe", () => {
    expect(segundosDesde(hace(20), AHORA)).toBe(20);
    expect(segundosDesde(hace(-5), AHORA)).toBe(0);
    expect(textoHace(20)).toBe("hace 20 s");
    expect(textoHace(200)).toBe("hace 3 min");
  });
});

describe("guardarPosicion (el repartidor manda la suya)", () => {
  const pedidos = [
    { id: P1, estado: "en_reparto", repartidor_id: "rep1" },
    { id: P2, estado: "en_reparto", repartidor_id: "otro" },
  ];
  const base = { userId: "rep1", pedidoIds: [P1], lat: -27.36, lng: -55.89, precision: 10, ahora: AHORA };

  it("guarda la última posición (upsert) en su pedido en reparto", async () => {
    const { admin, calls } = mundo({ pedidos });
    expect(await guardarPosicion(admin, base)).toEqual({ pedidos: 1 });
    const up = calls.find((c) => c.table === "repartidor_posiciones" && c.op === "upsert")!;
    expect(up.payload).toEqual([{ pedido_id: P1, repartidor_id: "rep1", latitud: -27.36, longitud: -55.89, precision_m: 10, actualizado_en: AHORA.toISOString() }]);
  });
  it("un repartidor ajeno es rechazado y no se escribe nada", async () => {
    const { admin, calls } = mundo({ pedidos });
    const r = await guardarPosicion(admin, { ...base, userId: "intruso" });
    expect(r.error).toBeTruthy();
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });
  it("si manda un pedido ajeno junto con el suyo, solo se guarda el suyo", async () => {
    const { admin, calls } = mundo({ pedidos });
    expect(await guardarPosicion(admin, { ...base, pedidoIds: [P1, P2] })).toEqual({ pedidos: 1 });
    expect(calls.find((c) => c.op === "upsert")!.payload.map((f: any) => f.pedido_id)).toEqual([P1]);
  });
  it.each(["en_preparacion", "entregado", "cancelado", "listo_retiro"])("un pedido en estado %s es rechazado", async (estado) => {
    const { admin, calls } = mundo({ pedidos: [{ id: P1, estado, repartidor_id: "rep1" }] });
    expect((await guardarPosicion(admin, base)).error).toBeTruthy();
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });
  it("coordenadas inválidas se rechazan sin tocar la base", async () => {
    const { admin, calls } = mundo({ pedidos });
    expect((await guardarPosicion(admin, { ...base, lat: 500 })).error).toMatch(/inválida/);
    expect((await guardarPosicion(admin, { ...base, lat: 0, lng: 0 })).error).toMatch(/inválida/);
    expect(calls).toHaveLength(0);
  });
  it("ids que no son uuid o una lista vacía se rechazan", async () => {
    const { admin, calls } = mundo({ pedidos });
    expect((await guardarPosicion(admin, { ...base, pedidoIds: ["x"] })).error).toBeTruthy();
    expect((await guardarPosicion(admin, { ...base, pedidoIds: "nope" })).error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
  it("apagar borra solo lo del propio repartidor", async () => {
    const { admin, calls } = mundo();
    await borrarPosicionesDe(admin, "rep1");
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe("repartidor_posiciones");
    expect(del.filters).toEqual([expect.objectContaining({ op: "eq", col: "repartidor_id", val: "rep1" })]);
  });
});

describe("posicionParaCliente (lo que ve quien hizo el pedido)", () => {
  const pedido = { id: P1, sucursal_id: SUC, estado: "en_reparto", tipo_entrega: "delivery", entrega_latitud: -27.3671234, entrega_longitud: -55.8960987 };
  const pos = (seg: number, id = P1) => ({ pedido_id: id, latitud: -27.37, longitud: -55.9, actualizado_en: hace(seg) });

  it("en reparto y con posición reciente: devuelve al repartidor y el destino redondeado, nada más", async () => {
    const { admin } = mundo({ pedidos: [pedido], posiciones: [pos(20)] });
    const r = await posicionParaCliente(admin, SUC, P1, AHORA);
    expect(r).toEqual({ estado: "vigente", haceSeg: 20, repartidor: { lat: -27.37, lng: -55.9 }, destino: { lat: -27.367, lng: -55.896 } });
  });
  it("sin posición todavía", async () => {
    expect(await posicionParaCliente(mundo({ pedidos: [pedido] }).admin, SUC, P1, AHORA)).toEqual({ estado: "sin_posicion" });
  });
  it("una posición vieja se marca como vieja y no entrega coordenadas", async () => {
    const r = await posicionParaCliente(mundo({ pedidos: [pedido], posiciones: [pos(400)] }).admin, SUC, P1, AHORA);
    expect(r).toEqual({ estado: "vieja", haceSeg: 400 });
  });
  it.each(["en_preparacion", "entregado", "cancelado"])("si el pedido está %s no se muestra nada aunque quede una fila", async (estado) => {
    const { admin } = mundo({ pedidos: [{ ...pedido, estado }], posiciones: [pos(5)] });
    expect(await posicionParaCliente(admin, SUC, P1, AHORA)).toEqual({ estado: "no_aplica" });
  });
  it("solo lee la posición de SU pedido: otro pedido, otra sucursal o ids raros no devuelven nada", async () => {
    const { admin, calls } = mundo({ pedidos: [pedido], posiciones: [pos(5, P2)] });
    expect(await posicionParaCliente(admin, SUC, P2, AHORA)).toEqual({ estado: "no_aplica" });
    expect(await posicionParaCliente(admin, "44444444-4444-4444-8444-444444444444", P1, AHORA)).toEqual({ estado: "no_aplica" });
    expect(await posicionParaCliente(admin, SUC, "no-es-uuid", AHORA)).toEqual({ estado: "no_aplica" });
    // la consulta de la posición siempre va filtrada por el pedido
    for (const c of calls.filter((x) => x.table === "repartidor_posiciones")) expect(c.filters.some((f) => f.col === "pedido_id")).toBe(true);
  });
});

describe("posicionParaPersonal (/tenteo/pedidos)", () => {
  it("devuelve la última posición solo si el pedido sigue en reparto", async () => {
    const posiciones = [{ pedido_id: P1, latitud: -27.37, longitud: -55.9, actualizado_en: hace(30) }];
    const enReparto = await posicionParaPersonal(mundo({ pedidos: [{ id: P1, estado: "en_reparto" }], posiciones }).admin, P1, AHORA);
    expect(enReparto).toEqual({ lat: -27.37, lng: -55.9, haceSeg: 30, vieja: false });
    expect(await posicionParaPersonal(mundo({ pedidos: [{ id: P1, estado: "entregado" }], posiciones }).admin, P1, AHORA)).toBeNull();
  });
  it("marca la posición vieja", async () => {
    const posiciones = [{ pedido_id: P1, latitud: -27.37, longitud: -55.9, actualizado_en: hace(900) }];
    const r = await posicionParaPersonal(mundo({ pedidos: [{ id: P1, estado: "en_reparto" }], posiciones }).admin, P1, AHORA);
    expect(r?.vieja).toBe(true);
  });
});
