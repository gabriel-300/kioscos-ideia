import { describe, it, expect } from "vitest";
import { GRUPOS, agruparPedidos, grupoDePedido, haceTiempo, ordenarGrupo } from "@/lib/pedidos/presentacion";

const ped = (estado: string, created_at: string, extra: Record<string, unknown> = {}) => ({ estado, created_at, ...extra });

describe("grupoDePedido: en qué sección va cada pedido", () => {
  it("lo que espera al local va a 'para atender': efectivo nuevo y Mercado Pago ya pagado", () => {
    expect(grupoDePedido({ estado: "confirmado" }, false)).toBe("atender");
    expect(grupoDePedido({ estado: "pagado" }, false)).toBe("atender");
  });
  it("un pago por link solo si todavía puede pagarse; vencido no se muestra", () => {
    expect(grupoDePedido({ estado: "pendiente_pago" }, true)).toBe("atender");
    expect(grupoDePedido({ estado: "pendiente_pago" }, false)).toBeNull();
  });
  it("preparación, listos (retiro o en camino) y entregados", () => {
    expect(grupoDePedido({ estado: "en_preparacion" }, false)).toBe("preparando");
    expect(grupoDePedido({ estado: "listo_retiro" }, false)).toBe("listos");
    expect(grupoDePedido({ estado: "en_reparto" }, false)).toBe("listos");
    expect(grupoDePedido({ estado: "entregado" }, false)).toBe("entregados");
  });
  it("cancelado, vencido, carrito o un estado desconocido no van a la lista", () => {
    for (const e of ["cancelado", "expirado", "carrito", "inventado"]) expect(grupoDePedido({ estado: e }, true)).toBeNull();
  });
});

describe("agruparPedidos", () => {
  const a = ped("confirmado", "2026-10-13T10:00:00Z", { n: "viejo" });
  const b = ped("confirmado", "2026-10-13T12:00:00Z", { n: "nuevo" });
  const c = ped("en_preparacion", "2026-10-13T09:00:00Z", { n: "c" });
  const d = ped("en_preparacion", "2026-10-13T11:00:00Z", { n: "d" });

  it("'para atender' va del más viejo al más nuevo: el que más espera, primero", () => {
    expect(agruparPedidos([b, a], () => false).atender).toEqual([a, b]);
  });
  it("el resto va del más reciente al más viejo", () => {
    expect(agruparPedidos([c, d], () => false).preparando).toEqual([d, c]);
  });
  it("reparte cada pedido en su sección y descarta los que no van", () => {
    const g = agruparPedidos([a, c, ped("cancelado", "2026-10-13T08:00:00Z"), ped("entregado", "2026-10-13T07:00:00Z")], () => false);
    expect([g.atender.length, g.preparando.length, g.listos.length, g.entregados.length]).toEqual([1, 1, 0, 1]);
  });
  it("usa el criterio de pago por link que le pasan", () => {
    const pl = ped("pendiente_pago", "2026-10-13T10:00:00Z");
    expect(agruparPedidos([pl], () => true).atender).toHaveLength(1);
    expect(agruparPedidos([pl], () => false).atender).toHaveLength(0);
  });
  it("no modifica la lista original", () => {
    const original = [b, a];
    ordenarGrupo("atender", original);
    expect(original).toEqual([b, a]);
  });
  it("las secciones salen en orden de urgencia", () => {
    expect(GRUPOS.map((g) => g.clave)).toEqual(["atender", "preparando", "listos", "entregados"]);
  });
});

describe("haceTiempo", () => {
  const ahora = Date.parse("2026-10-13T12:00:00Z");
  const hace = (min: number) => new Date(ahora - min * 60_000).toISOString();

  it("recién, minutos, horas y días", () => {
    expect(haceTiempo(hace(0), ahora).texto).toBe("recién");
    expect(haceTiempo(hace(12), ahora).texto).toBe("hace 12 min");
    expect(haceTiempo(hace(125), ahora).texto).toBe("hace 2 h");
    expect(haceTiempo(hace(60 * 50), ahora).texto).toBe("hace 2 d");
  });
  it("devuelve los minutos (para marcar demoras)", () => {
    expect(haceTiempo(hace(25), ahora).minutos).toBe(25);
  });
  it("una fecha futura (reloj desfasado) no da un número negativo", () => {
    expect(haceTiempo(new Date(ahora + 5 * 60_000).toISOString(), ahora)).toEqual({ texto: "recién", minutos: 0 });
  });
});
