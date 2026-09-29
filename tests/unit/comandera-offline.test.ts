import { describe, it, expect } from "vitest";
import { armarCatalogoComandera, paraEvento } from "@/lib/comandera-offline/catalogo";
import { generarComanderaHtml, nombreArchivoComandera } from "@/lib/comandera-offline/html";

const base = {
  sucursal: { id: "s1", nombre: "Villa Sarita", categorias_habilitadas: ["c1"], promos_habilitadas: false },
  categorias: [{ id: "c1", name: "MINUTAS" }, { id: "c2", name: "BEBIDAS" }],
  productos: [
    { id: "p1", name: "Empanada Carne", category_id: "c1", unit_label: "unidad", vendible_pos: true },
    { id: "p2", name: "Chipa Bocadito", category_id: "c1", unit_label: "kg", vendible_pos: true },
    { id: "p3", name: "Gaseosa", category_id: "c2", unit_label: "unidad", vendible_pos: true },
    { id: "p4", name: "Sin precio", category_id: "c1", unit_label: "unidad", vendible_pos: true },
    { id: "p5", name: "Solo insumo", category_id: "c1", unit_label: "unidad", vendible_pos: false },
    { id: "p6", name: "Alfajor", category_id: "c1", unit_label: "unidad", vendible_pos: true },
  ],
  precios: [
    { product_id: "p1", precio_dist: "2300.00" },
    { product_id: "p2", precio_dist: "15000.00" },
    { product_id: "p3", precio_dist: "1500.00" },
    { product_id: "p5", precio_dist: "100.00" },
    { product_id: "p6", precio_dist: "900.00" },
  ],
  promos: [{ id: "m1", name: "Combo", price: 5000, category_id: "c1" }],
  preciosPromo: [],
  ahora: new Date("2026-10-01T12:00:00Z"),
};

describe("armarCatalogoComandera", () => {
  it("respeta categorías habilitadas, vendible_pos, precio > 0 y deja afuera los productos por kg", () => {
    const c = armarCatalogoComandera(base);
    expect(c.categorias.map((x) => x.nombre)).toEqual(["MINUTAS"]);
    expect(c.categorias[0].items.map((i) => i.nombre)).toEqual(["Alfajor", "Empanada Carne"]);
    expect(c.categorias[0].items[1].precio).toBe(2300);
    expect(c.omitidosPorKg).toEqual(["Chipa Bocadito"]);
  });

  it("no ofrece promos si la sucursal las deshabilita, y sí si las habilita", () => {
    expect(armarCatalogoComandera(base).categorias[0].items.some((i) => i.promo)).toBe(false);
    const c = armarCatalogoComandera({ ...base, sucursal: { ...base.sucursal, promos_habilitadas: true } });
    expect(c.categorias[0].items.find((i) => i.promo)?.precio).toBe(5000);
  });

  it("sin restricción ofrece todas las categorías y manda las promos sin categoría a 'Promos'", () => {
    const c = armarCatalogoComandera({
      ...base,
      sucursal: { ...base.sucursal, categorias_habilitadas: null, promos_habilitadas: true },
      promos: [{ id: "m2", name: "Promo suelta", price: 800, category_id: null }],
    });
    expect(c.categorias.map((x) => x.nombre)).toEqual(["MINUTAS", "BEBIDAS", "Promos"]);
  });

  it("el precio de la promo en la sucursal pisa al global", () => {
    const c = armarCatalogoComandera({
      ...base,
      sucursal: { ...base.sucursal, promos_habilitadas: true },
      preciosPromo: [{ promo_id: "m1", price: 4200 }],
    });
    expect(c.categorias[0].items.find((i) => i.promo)?.precio).toBe(4200);
  });
});

describe("generarComanderaHtml", () => {
  const catalogo = armarCatalogoComandera(base);

  it("incorpora el catálogo, no deja marcadores y no lleva el aviso de kg", () => {
    const html = generarComanderaHtml(catalogo);
    expect(html).not.toContain("__DATA__");
    expect(html).toContain("Empanada Carne");
    expect(html).not.toContain("omitidosPorKg");
  });

  it("un nombre con </script> no puede cerrar el script", () => {
    const html = generarComanderaHtml({
      ...catalogo,
      categorias: [{ id: "c1", nombre: "X", items: [{ id: "a", nombre: "</script><img src=x onerror=alert(1)>", precio: 1 }] }],
    });
    expect(html.match(/<\/script>/g)).toHaveLength(1); // solo el de cierre real
    expect(html).not.toContain("<img src=x");
  });

  it("el JavaScript incrustado tiene sintaxis válida", () => {
    const html = generarComanderaHtml(catalogo);
    const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
    expect(() => new Function(js)).not.toThrow();
  });

  it("nombre del archivo sin acentos ni espacios, según el título", () => {
    expect(nombreArchivoComandera({ ...catalogo, titulo: "Parque de las Fiestas" })).toBe("comandera-parque-de-las-fiestas.html");
    expect(nombreArchivoComandera({ ...catalogo, titulo: "Ñandú Café" })).toBe("comandera-nandu-cafe.html");
  });

  it("el archivo usa el título y la clave del evento, y no expone el nombre de la sucursal", () => {
    const html = generarComanderaHtml(paraEvento({ ...catalogo, sucursalNombre: "Kiosco Secreto" }, "Fiesta Villa Sarita", ["p1"]));
    expect(html).toContain("Fiesta Villa Sarita");
    expect(html).not.toContain("Kiosco Secreto");
  });
});

describe("paraEvento", () => {
  const cat = armarCatalogoComandera({
    ...base,
    sucursal: { ...base.sucursal, categorias_habilitadas: null },
  });

  it("se queda solo con los productos elegidos y descarta categorías vacías", () => {
    const e = paraEvento(cat, "Fiesta", ["p3"]);
    expect(e.categorias.map((c) => c.nombre)).toEqual(["BEBIDAS"]);
    expect(e.categorias[0].items.map((i) => i.id)).toEqual(["p3"]);
  });

  it("ignora ids que no son del catálogo (no se puede colar un producto de otra sucursal)", () => {
    const e = paraEvento(cat, "Fiesta", ["p3", "inventado"]);
    expect(e.categorias.flatMap((c) => c.items).map((i) => i.id)).toEqual(["p3"]);
  });

  it("normaliza el título y arma la clave con el evento: mismo nombre = misma numeración", () => {
    const a = paraEvento(cat, "  Fiesta   Villa Sarita ", ["p3"]);
    expect(a.titulo).toBe("Fiesta Villa Sarita");
    expect(a.clave).toBe("s1:fiesta-villa-sarita");
    expect(paraEvento(cat, "fiesta villa sarita", ["p1"]).clave).toBe(a.clave);
    expect(paraEvento(cat, "Otro evento", ["p3"]).clave).not.toBe(a.clave);
  });

  it("limita el título a 40 caracteres", () => {
    expect(paraEvento(cat, "x".repeat(80), ["p3"]).titulo).toHaveLength(40);
  });
});
