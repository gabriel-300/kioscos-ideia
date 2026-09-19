import { describe, it, expect } from "vitest";
import { redondearMoneda, resolverItemsPedido } from "@/lib/pedidos/pricing";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

const SUC = "suc-1";

type Catalogo = {
  sucursal?: { categorias_habilitadas: string[] | null; promos_habilitadas: boolean };
  products?: { id: string; category_id: string | null; is_active: boolean; vendible_pos: boolean | null }[];
  precios?: { product_id: string; precio_dist: number | null; costo?: number }[];
  promos?: { id: string; price: number; is_active: boolean; category_id: string | null; promo_items: { product_id: string; cantidad: number }[] }[];
  preciosPromo?: { promo_id: string; price: number }[];
};

function admin(c: Catalogo) {
  return fakeAdmin((q: Q) => {
    switch (q.table) {
      case "sucursales": return { data: c.sucursal ?? { categorias_habilitadas: null, promos_habilitadas: true } };
      case "products": return { data: c.products ?? [] };
      case "product_prices": return { data: c.precios ?? [] };
      case "promos": return { data: c.promos ?? [] };
      case "promo_prices": return { data: c.preciosPromo ?? [] };
    }
  }).admin;
}

describe("redondearMoneda", () => {
  it("elimina el arrastre de floats de JS", () => {
    expect(redondearMoneda(1199.9999999999998)).toBe(1200);
    expect(redondearMoneda(0.1 + 0.2)).toBe(0.3);
    expect(redondearMoneda(3 * 0.35)).toBe(1.05);
  });
  // Limitación conocida (Math.round(n*100)/100): 1.005*100 = 100.49999999999999.
  // Con precios en pesos enteros no pega, sí con centavos -- ver informe de auditoría.
  it.fails("redondea 1.005 a 1.01 (half-up decimal)", () => {
    expect(redondearMoneda(1.005)).toBe(1.01);
  });
});

describe("resolverItemsPedido -- productos sueltos", () => {
  const base: Catalogo = {
    products: [{ id: "p1", category_id: "c1", is_active: true, vendible_pos: true }],
    precios: [{ product_id: "p1", precio_dist: 1500 }],
  };

  it("el precio sale de la base, nunca del cliente", async () => {
    const item = { product_id: "p1", cantidad: 2, precio_unitario: 1 } as any; // el cliente intenta mandar precio
    const r = await resolverItemsPedido(admin(base), SUC, [item]);
    expect(r).toMatchObject({ subtotal: 3000, items: [{ precio_unitario: 1500, subtotal: 3000 }] });
  });

  it("carrito vacío o cantidad <= 0 se rechazan", async () => {
    expect(await resolverItemsPedido(admin(base), SUC, [])).toEqual({ error: "El carrito está vacío" });
    expect(await resolverItemsPedido(admin(base), SUC, [{ product_id: "p1", cantidad: 0 }])).toHaveProperty("error");
    expect(await resolverItemsPedido(admin(base), SUC, [{ product_id: "p1", cantidad: -3 }])).toHaveProperty("error");
  });

  it("producto inactivo, no vendible o sin precio se rechazan", async () => {
    const inactivo = { ...base, products: [{ id: "p1", category_id: "c1", is_active: false, vendible_pos: true }] };
    const noVendible = { ...base, products: [{ id: "p1", category_id: "c1", is_active: true, vendible_pos: false }] };
    const sinPrecio = { ...base, precios: [{ product_id: "p1", precio_dist: null }] };
    const precioCero = { ...base, precios: [{ product_id: "p1", precio_dist: 0 }] };
    for (const c of [inactivo, noVendible, sinPrecio, precioCero]) {
      expect(await resolverItemsPedido(admin(c), SUC, [{ product_id: "p1", cantidad: 1 }])).toHaveProperty("error");
    }
  });

  it("producto inexistente (uuid inventado) se rechaza", async () => {
    expect(await resolverItemsPedido(admin(base), SUC, [{ product_id: "no-existe", cantidad: 1 }])).toHaveProperty("error");
  });

  it("respeta categorias_habilitadas de la sucursal", async () => {
    const restringida = { ...base, sucursal: { categorias_habilitadas: ["otra-cat"], promos_habilitadas: true } };
    expect(await resolverItemsPedido(admin(restringida), SUC, [{ product_id: "p1", cantidad: 1 }])).toHaveProperty("error");
    const permitida = { ...base, sucursal: { categorias_habilitadas: ["c1"], promos_habilitadas: true } };
    expect(await resolverItemsPedido(admin(permitida), SUC, [{ product_id: "p1", cantidad: 1 }])).toHaveProperty("items");
  });

  it("redondea el subtotal de cantidades fraccionarias a centavos", async () => {
    const c = { ...base, precios: [{ product_id: "p1", precio_dist: 1199.99 }] };
    const r = await resolverItemsPedido(admin(c), SUC, [{ product_id: "p1", cantidad: 0.3 }]);
    expect(r).toMatchObject({ subtotal: 360 });
  });

  // Hallazgo de auditoría: `cantidad <= 0` deja pasar NaN (NaN <= 0 es false) y no
  // hay tope superior. Un Server Action recibe NaN/Infinity sin problema.
  it.fails("rechaza cantidad NaN", async () => {
    const r = await resolverItemsPedido(admin(base), SUC, [{ product_id: "p1", cantidad: NaN }]);
    expect(r).toHaveProperty("error");
  });
  it.fails("rechaza cantidades absurdas (tope por línea)", async () => {
    const r = await resolverItemsPedido(admin(base), SUC, [{ product_id: "p1", cantidad: 1_000_000 }]);
    expect(r).toHaveProperty("error");
  });
});

describe("resolverItemsPedido -- reparto de promos/combos", () => {
  function conPromo(precio: number, componentes: { product_id: string; cantidad: number; costo: number }[], extra: Partial<Catalogo> = {}): Catalogo {
    return {
      promos: [{ id: "promo1", price: precio, is_active: true, category_id: null, promo_items: componentes.map(({ product_id, cantidad }) => ({ product_id, cantidad })) }],
      precios: componentes.map((c) => ({ product_id: c.product_id, precio_dist: 1, costo: c.costo })),
      ...extra,
    };
  }

  it("la suma de los componentes da EXACTO el precio de la promo (mayor resto)", async () => {
    const c = conPromo(1999.99, [
      { product_id: "a", cantidad: 1, costo: 333.33 },
      { product_id: "b", cantidad: 2, costo: 777.77 },
      { product_id: "c", cantidad: 3, costo: 11.11 },
    ]);
    const r: any = await resolverItemsPedido(admin(c), SUC, [{ promo_id: "promo1", cantidad: 3 }]);
    const suma = redondearMoneda(r.items.reduce((s: number, i: any) => s + i.subtotal, 0));
    expect(suma).toBe(redondearMoneda(3 * 1999.99));
    expect(r.subtotal).toBe(suma);
  });

  it("propiedad: para muchas combinaciones la suma nunca se desvía ni un centavo", async () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 200; n++) {
      const k = 1 + Math.floor(rnd() * 5);
      const comps = Array.from({ length: k }, (_, i) => ({ product_id: `p${i}`, cantidad: 1 + Math.floor(rnd() * 4), costo: Math.round(rnd() * 100000) / 100 }));
      const precio = Math.round(100 + rnd() * 500000) / 100;
      const cant = 1 + Math.floor(rnd() * 7);
      const r: any = await resolverItemsPedido(admin(conPromo(precio, comps)), SUC, [{ promo_id: "promo1", cantidad: cant }]);
      const suma = redondearMoneda(r.items.reduce((s: number, i: any) => s + i.subtotal, 0));
      expect(suma).toBe(redondearMoneda(cant * precio));
    }
  });

  it("sin costos cargados reparte en partes iguales, sin dividir por cero", async () => {
    const c = conPromo(100, [{ product_id: "a", cantidad: 1, costo: 0 }, { product_id: "b", cantidad: 1, costo: 0 }]);
    const r: any = await resolverItemsPedido(admin(c), SUC, [{ promo_id: "promo1", cantidad: 1 }]);
    expect(r.items.map((i: any) => i.subtotal)).toEqual([50, 50]);
  });

  it("usa el precio de la promo POR SUCURSAL si existe", async () => {
    const c = conPromo(100, [{ product_id: "a", cantidad: 1, costo: 10 }], { preciosPromo: [{ promo_id: "promo1", price: 250 }] });
    const r: any = await resolverItemsPedido(admin(c), SUC, [{ promo_id: "promo1", cantidad: 2 }]);
    expect(r.subtotal).toBe(500);
  });

  it("rechaza promos inactivas, sin componentes o con promos deshabilitadas en la sucursal", async () => {
    const inactiva = conPromo(100, [{ product_id: "a", cantidad: 1, costo: 1 }]);
    inactiva.promos![0].is_active = false;
    expect(await resolverItemsPedido(admin(inactiva), SUC, [{ promo_id: "promo1", cantidad: 1 }])).toHaveProperty("error");

    const vacia = conPromo(100, []);
    expect(await resolverItemsPedido(admin(vacia), SUC, [{ promo_id: "promo1", cantidad: 1 }])).toHaveProperty("error");

    const sinPromos = conPromo(100, [{ product_id: "a", cantidad: 1, costo: 1 }], { sucursal: { categorias_habilitadas: null, promos_habilitadas: false } });
    expect(await resolverItemsPedido(admin(sinPromos), SUC, [{ promo_id: "promo1", cantidad: 1 }])).toHaveProperty("error");
  });
});
