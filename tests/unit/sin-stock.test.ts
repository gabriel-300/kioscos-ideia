import { describe, it, expect } from "vitest";
import { ajusteSinStock } from "@/lib/pedidos/sin-stock";
import { revisarStock } from "@/lib/pedidos/stock";
import { fakeAdmin } from "../helpers/fake-supabase";

describe("ajusteSinStock", () => {
  it("unidades: dice cuántas quedan y cuántas se pidieron, y deja el máximo entero", () => {
    const a = ajusteSinStock({ nombre: "Chipa Long ", disponible: 3, pedido: 4, porPeso: false });
    expect(a.maximo).toBe(3);
    expect(a.texto).toBe("Quedan solo 3 de Chipa Long y pediste 4. Bajá la cantidad para seguir.");
    expect(a.aviso).toBe("Ajustamos Chipa Long a 3, que es lo que queda.");
  });
  it("sin comillas ni espacios de más en el nombre", () => {
    expect(ajusteSinStock({ nombre: "  Alfajor  ", disponible: 1, pedido: 2, porPeso: false }).texto).not.toMatch(/["“]|  /);
  });
  it("por peso: habla en gramos y baja a pasos de 100 g", () => {
    const a = ajusteSinStock({ nombre: "Chipa Bocadito", disponible: 0.345, pedido: 0.5, porPeso: true });
    expect(a.maximo).toBe(0.3);
    expect(a.texto).toBe("Quedan solo 300 g de Chipa Bocadito y pediste 500 g. Bajá la cantidad para seguir.");
  });
  it("por peso en kilos", () => {
    expect(ajusteSinStock({ nombre: "Pan", disponible: 1.45, pedido: 2, porPeso: true }).texto).toMatch(/Quedan solo 1,4 kg de Pan y pediste 2 kg/);
  });
  it("agotado: pide sacarlo del pedido (también si queda menos de lo vendible)", () => {
    for (const [disponible, porPeso] of [[0, false], [0.4, false], [0.05, true], [-2, false], [Number.NaN, false]] as const) {
      const a = ajusteSinStock({ nombre: "Café", disponible, pedido: 2, porPeso });
      expect(a.maximo, String(disponible)).toBe(0);
      expect(a.texto).toBe("Café se agotó. Sacalo del pedido para seguir.");
      expect(a.aviso).toBe("Sacamos Café del pedido porque se agotó.");
    }
  });
});

describe("revisarStock: detalle de lo que falta", () => {
  const items = (cantidad: number) => [{ product_id: "p1", promo_id: null, cantidad, precio_unitario: 10, subtotal: 10 * cantidad }];
  const conStock = (stock_actual: number) => fakeAdmin(() => ({ data: [{ product_id: "p1", product_name: "Alfajor ", stock_actual }] })).admin;

  it("devuelve el producto, lo que queda y lo pedido, con el mensaje claro", async () => {
    expect(await revisarStock(conStock(2), "s", items(3))).toEqual({
      error: "Quedan solo 2 de Alfajor y pediste 3. Bajá la cantidad para seguir.", productId: "p1", disponible: 2, pedido: 3,
    });
  });
  it("sin nada de stock avisa que se agotó", async () => {
    expect((await revisarStock(conStock(0), "s", items(1)))?.error).toBe("Alfajor se agotó. Sacalo del pedido para seguir.");
  });
  it("con stock alcanza -> null; sin fila en la vista no hay productId", async () => {
    expect(await revisarStock(conStock(5), "s", items(3))).toBeNull();
    const r = await revisarStock(fakeAdmin(() => ({ data: [] })).admin, "s", items(3));
    expect(r?.error).toMatch(/no está disponible en este local/);
    expect(r?.productId).toBeUndefined();
  });
});
