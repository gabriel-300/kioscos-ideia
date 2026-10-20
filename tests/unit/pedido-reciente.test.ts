import { describe, it, expect } from "vitest";
import { CLAVE_PEDIDO_RECIENTE, guardarPedidoReciente, leerPedidoReciente, olvidarPedidoReciente, VIGENCIA_PEDIDO_RECIENTE_MS } from "@/lib/pedidos/pedido-reciente";

function storageFalso(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const P = { sucursalId: "s1", pedidoId: "p1", numero: 27 };

describe("pedido reciente (seguimiento sin cuenta)", () => {
  it("lo guardado se vuelve a leer", () => {
    const s = storageFalso();
    guardarPedidoReciente(s, P, 1000);
    expect(leerPedidoReciente(s, 2000)).toEqual({ ...P, fecha: 1000 });
  });
  it("vence a las 24 horas", () => {
    const s = storageFalso();
    guardarPedidoReciente(s, P, 0);
    expect(leerPedidoReciente(s, VIGENCIA_PEDIDO_RECIENTE_MS)).not.toBeNull();
    expect(leerPedidoReciente(s, VIGENCIA_PEDIDO_RECIENTE_MS + 1)).toBeNull();
  });
  it("olvidar lo borra", () => {
    const s = storageFalso();
    guardarPedidoReciente(s, P);
    olvidarPedidoReciente(s);
    expect(leerPedidoReciente(s)).toBeNull();
  });
  it("datos rotos o incompletos se ignoran", () => {
    expect(leerPedidoReciente(storageFalso({ [CLAVE_PEDIDO_RECIENTE]: "no es json" }))).toBeNull();
    expect(leerPedidoReciente(storageFalso({ [CLAVE_PEDIDO_RECIENTE]: JSON.stringify({ sucursalId: "s1" }) }))).toBeNull();
  });
  it("si el almacenamiento falla no rompe nada", () => {
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } };
    expect(() => guardarPedidoReciente(roto, P)).not.toThrow();
    expect(leerPedidoReciente(roto)).toBeNull();
    expect(() => olvidarPedidoReciente(roto)).not.toThrow();
  });
});
