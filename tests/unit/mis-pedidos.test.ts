import { describe, it, expect } from "vitest";
import {
  armarResumen, leerPedidosRecordados, MAX_PEDIDOS_RECORDADOS, recordarPedido, resumirLineas, VIGENCIA_MIS_PEDIDOS_MS,
} from "@/lib/pedidos/mis-pedidos";
import { pedidosPorIds } from "@/lib/pedidos/mis-pedidos-servidor";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

function storageFalso(inicial?: string) {
  let valor: string | null = inicial ?? null;
  return { getItem: () => valor, setItem: (_: string, v: string) => { valor = v; }, leer: () => valor };
}
const P = (n: number) => ({ sucursalId: "s1", pedidoId: `p${n}`, numero: n });

describe("pedidos recordados en el navegador", () => {
  it("guarda el más nuevo primero y no repite un pedido", () => {
    const s = storageFalso();
    recordarPedido(s, P(1), 1000);
    recordarPedido(s, P(2), 2000);
    recordarPedido(s, P(1), 3000);
    expect(leerPedidosRecordados(s, 3000).map((p) => p.pedidoId)).toEqual(["p1", "p2"]);
  });
  it("no pasa del máximo y descarta lo viejo", () => {
    const s = storageFalso();
    for (let i = 1; i <= MAX_PEDIDOS_RECORDADOS + 5; i++) recordarPedido(s, P(i), 1000 + i);
    expect(leerPedidosRecordados(s, 2000)).toHaveLength(MAX_PEDIDOS_RECORDADOS);
    expect(leerPedidosRecordados(s, 1000 + VIGENCIA_MIS_PEDIDOS_MS + 10_000)).toHaveLength(0);
  });
  it("un contenido roto o ajeno se ignora", () => {
    expect(leerPedidosRecordados(storageFalso("no es json"))).toEqual([]);
    expect(leerPedidosRecordados(storageFalso('{"a":1}'))).toEqual([]);
    expect(leerPedidosRecordados(storageFalso('[{"pedidoId":5}]'))).toEqual([]);
  });
  it("con el almacenamiento bloqueado no rompe", () => {
    const bloqueado = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(() => recordarPedido(bloqueado, P(1))).not.toThrow();
    expect(leerPedidosRecordados(bloqueado)).toEqual([]);
  });
});

describe("resumen de un pedido", () => {
  const lineas = (...t: string[]) => t.map((titulo) => ({ titulo, componentes: [] }));
  it("resume las líneas: pocas, y 'y N más' cuando son muchas", () => {
    expect(resumirLineas([])).toBe("");
    expect(resumirLineas(lineas("2× Chipa"))).toBe("2× Chipa");
    expect(resumirLineas(lineas("2× Chipa", "1× Café"))).toBe("2× Chipa y 1× Café");
    expect(resumirLineas(lineas("a", "b", "c", "d", "e"))).toBe("a, b, c y 2 más");
  });
  it("arma el estado en lenguaje del cliente y limpia el nombre del local", () => {
    const fila = { id: "p1", numero: 7, estado: "entregado", tipo_entrega: "delivery", medio_pago: "efectivo", total: "6000.00", created_at: "2026-10-23T17:00:00Z", sucursal_id: "s1", sucursales: { nombre: "Angiru Food UNAM" } };
    expect(armarResumen(fila, lineas("2× Chipa"))).toMatchObject({ titulo: "Pedido entregado", final: true, total: 6000, sucursal: "UNAM", delivery: true, resumen: "2× Chipa" });
    expect(armarResumen({ ...fila, estado: "en_reparto" }, [])).toMatchObject({ titulo: "Tu pedido va en camino", final: false });
  });
});

describe("pedidosPorIds", () => {
  const UUID = "4af1ad9f-cd2f-47cd-974d-2bc8037db9a4";
  it("sin ids válidos no consulta nada", async () => {
    const f = fakeAdmin(() => ({ data: [] }));
    expect(await pedidosPorIds(f.admin, ["x", "../etc", ""])).toEqual([]);
    expect(await pedidosPorIds(f.admin, "no-es-lista" as unknown as string[])).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
  it("consulta solo los uuid válidos, sin repetir, y nunca trae carritos", async () => {
    const f = fakeAdmin((q: Q) => (q.table === "pedidos" ? { data: [] } : undefined));
    await pedidosPorIds(f.admin, [UUID, UUID, "basura"]);
    const q = f.calls.find((c) => c.table === "pedidos")!;
    expect(q.filters).toEqual(expect.arrayContaining([
      { op: "in", col: "id", val: [UUID], extra: undefined },
      { op: "neq", col: "estado", val: "carrito" },
    ]));
  });
});
