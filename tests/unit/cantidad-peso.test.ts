import { describe, it, expect } from "vitest";
import { armarCatalogo, type DatosCatalogo } from "@/lib/pedidos/catalogo";
import { INICIAL_KG, PASO_KG, redondearKg, sumarKg, textoCantidad } from "@/lib/pedidos/cantidad-peso";

describe("cantidades por peso", () => {
  it("se suma de a 100 g sin errores de coma flotante", () => {
    expect(sumarKg(0.2, 0.1)).toBe(0.3);
    expect(sumarKg(INICIAL_KG, PASO_KG)).toBe(0.6);
    expect(redondearKg(0.30000000000000004)).toBe(0.3);
    expect(sumarKg(0.3, -PASO_KG)).toBe(0.2);
  });
  it("menos de un kilo se muestra en gramos y desde un kilo en kg", () => {
    expect(textoCantidad(0.3, true)).toBe("300 g");
    expect(textoCantidad(0.5, true)).toBe("500 g");
    expect(textoCantidad(1, true)).toBe("1 kg");
    expect(textoCantidad(1.2, true)).toBe("1,2 kg");
  });
  it("lo que se vende por unidad se muestra como número", () => {
    expect(textoCantidad(2, false)).toBe("2");
  });
});

describe("catálogo: stock de un producto por peso", () => {
  const datos = (stockKg: number): DatosCatalogo => ({
    categorias: [{ id: "c1", name: "Congelados" }],
    productos: [
      { id: "kg1", name: "Chipa Bocadito", category_id: "c1", vendible_pos: true, unit_label: "kg", cover_image_url: null },
      { id: "u1", name: "Chipa Long", category_id: "c1", vendible_pos: true, unit_label: "unidad", cover_image_url: null },
    ],
    preciosProducto: [{ product_id: "kg1", precio_dist: 15000 }, { product_id: "u1", precio_dist: 1700 }],
    promos: [], preciosPromo: [],
    stock: [{ product_id: "kg1", stock_actual: stockKg }, { product_id: "u1", stock_actual: stockKg }],
    componentes: [],
  });
  const libre = { categoriasHabilitadas: null, promosHabilitadas: true };
  const ids = (stockKg: number) => armarCatalogo(datos(stockKg), libre).items.map((i) => i.id);

  it("con 0,54 kg el producto por peso SE ofrece (antes se escondía por tener menos de 1)", () => {
    expect(ids(0.54)).toContain("kg1");
  });
  it("el mismo stock fraccionario no alcanza para una unidad", () => {
    expect(ids(0.54)).not.toContain("u1");
  });
  it("con menos de 100 g o en negativo no se ofrece", () => {
    expect(ids(0.05)).not.toContain("kg1");
    expect(ids(0)).not.toContain("kg1");
    expect(ids(-1)).not.toContain("kg1");
  });
  it("marca el producto como 'por kg' para la tienda", () => {
    expect(armarCatalogo(datos(5), libre).items.find((i) => i.id === "kg1")?.unidad).toBe("por kg");
  });
});
