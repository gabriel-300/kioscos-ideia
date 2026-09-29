import { describe, it, expect } from "vitest";
import { armarCatalogo, GRUPO_PROMOS, type DatosCatalogo } from "@/lib/pedidos/catalogo";

const datos = (over: Partial<DatosCatalogo> = {}): DatosCatalogo => ({
  categorias: [{ id: "c1", name: "Bebidas" }, { id: "c2", name: "Snacks" }],
  productos: [
    { id: "p1", name: "Agua", category_id: "c1", vendible_pos: true, unit_label: null, cover_image_url: null },
    { id: "p2", name: "Papas", category_id: "c2", vendible_pos: true, unit_label: null, cover_image_url: "x.jpg" },
  ],
  preciosProducto: [{ product_id: "p1", precio_dist: 500 }, { product_id: "p2", precio_dist: 900 }],
  promos: [{ id: "m1", name: "Combo", price: 1200, tipo: "promo", category_id: null, cover_image_url: null }],
  preciosPromo: [],
  ...over,
});
const libre = { categoriasHabilitadas: null, promosHabilitadas: true };

describe("armarCatalogo", () => {
  it("agrupa: 'Promos' (promos sin categoría) primero y después cada categoría con contenido", () => {
    const { grupos } = armarCatalogo(datos(), libre);
    expect(grupos.map((g) => g.id)).toEqual([GRUPO_PROMOS, "c1", "c2"]);
    expect(grupos[0].items[0]).toMatchObject({ id: "m1", esPromo: true, etiqueta: "PROMO", price: 1200 });
  });

  it("sin precio en la sucursal (o precio 0) el producto no se ofrece", () => {
    const { items } = armarCatalogo(datos({ preciosProducto: [{ product_id: "p1", precio_dist: 0 }] }), libre);
    expect(items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("el precio de la promo en la sucursal pisa al global", () => {
    const { items } = armarCatalogo(datos({ preciosPromo: [{ promo_id: "m1", price: 999 }] }), libre);
    expect(items.find((i) => i.id === "m1")!.price).toBe(999);
  });

  it("vendible_pos = false oculta el producto", () => {
    const d = datos();
    d.productos[0].vendible_pos = false;
    expect(armarCatalogo(d, libre).items.some((i) => i.id === "p1")).toBe(false);
  });

  it("si la sucursal restringe categorías, solo pasan las habilitadas (y las promos sin categoría dejan de verse)", () => {
    const { items, grupos } = armarCatalogo(datos(), { categoriasHabilitadas: ["c1"], promosHabilitadas: true });
    expect(items.map((i) => i.id)).toEqual(["p1"]);
    expect(grupos.map((g) => g.id)).toEqual(["c1"]);
  });

  it("promos_habilitadas = false quita todas las promos", () => {
    const { items } = armarCatalogo(datos(), { categoriasHabilitadas: null, promosHabilitadas: false });
    expect(items.every((i) => !i.esPromo)).toBe(true);
  });

  it("una receta lleva la etiqueta RECETA y un producto por kg la unidad", () => {
    const d = datos({ promos: [{ id: "r1", name: "Pancho", price: 700, tipo: "receta", category_id: "c2", cover_image_url: null }] });
    d.productos[0].unit_label = "kg";
    const { items } = armarCatalogo(d, libre);
    expect(items.find((i) => i.id === "r1")!.etiqueta).toBe("RECETA");
    expect(items.find((i) => i.id === "p1")!.unidad).toBe("por kg");
  });

  it("un producto sin categoría no se muestra (igual que en el storefront)", () => {
    const d = datos();
    d.productos[0].category_id = null;
    expect(armarCatalogo(d, libre).grupos.flatMap((g) => g.items).some((i) => i.id === "p1")).toBe(false);
  });
});
