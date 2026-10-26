import { describe, it, expect } from "vitest";
import { nombrePresentable } from "@/lib/pedidos/nombres-cliente";
import { nombreCategoriaCliente, ordenarCategoriasCliente } from "@/lib/pedidos/categorias-cliente";
import { elegirMasPedidos } from "@/lib/pedidos/mas-pedidos";

describe("nombrePresentable", () => {
  it("las mayúsculas del kiosco pasan a frase, con acentos y unidades separadas", () => {
    expect(nombrePresentable("CAFE CON LECHE + CHIPA 150GR")).toBe("Café con leche + chipa 150 gr");
    expect(nombrePresentable("CAFE/LUNGO + CHIPA 150GR")).toBe("Café/lungo + chipa 150 gr");
    expect(nombrePresentable("BUDIN DE LIMON")).toBe("Budín de limón");
    expect(nombrePresentable("PAN SUPER PANCHO")).toBe("Pan super pancho");
  });
  it("las siglas sin vocales se quedan en mayúsculas", () => {
    expect(nombrePresentable("MEDIALUNA JYQ X4")).toBe("Medialuna JYQ x4");
    expect(nombrePresentable("PIZZA MM HORNO")).toBe("Pizza MM horno");
  });
  it("un número delante no es 'la primera palabra'", () => {
    expect(nombrePresentable("3 EMPANADAS DE CARNE")).toBe("3 Empanadas de carne");
  });
  it("un nombre que ya está bien escrito no se toca (solo la primera letra)", () => {
    expect(nombrePresentable("Pizza 4 Quesos MM Horno")).toBe("Pizza 4 Quesos MM Horno");
    expect(nombrePresentable("Ensalada con proteina + Agua")).toBe("Ensalada con proteina + Agua");
    expect(nombrePresentable("chocotorta")).toBe("Chocotorta");
  });
  it("espacios de más y nombres raros no rompen", () => {
    expect(nombrePresentable("  Empanada   Pollo  ")).toBe("Empanada Pollo");
    expect(nombrePresentable("")).toBe("");
    expect(nombrePresentable("123")).toBe("123");
  });
});

describe("categorías para el cliente", () => {
  it("renombra las internas y deja las desconocidas como están", () => {
    expect(nombreCategoriaCliente("MINUTAS CONG")).toBe("Congelados");
    expect(nombreCategoriaCliente("MINUTAS")).toBe("Food");
    expect(nombreCategoriaCliente("KIOSKO")).toBe("Kiosco");
    expect(nombreCategoriaCliente("KIOSCO")).toBe("Kiosco");
    expect(nombreCategoriaCliente("CONFITERIA")).toBe("Confitería");
    expect(nombreCategoriaCliente("Confitería")).toBe("Confitería");
    expect(nombreCategoriaCliente("Cafeteria")).toBe("Cafetería");
    expect(nombreCategoriaCliente("Algo Nuevo")).toBe("Algo Nuevo");
  });
  it("ordena primero lo que apetece y deja al final lo desconocido, sin perder el orden original", () => {
    const g = (name: string) => ({ name });
    const orden = ordenarCategoriasCliente([g("KIOSCO"), g("BEBIDAS"), g("Zeta"), g("PANADERIA"), g("Promos"), g("Alfa"), g("MINUTAS")]).map((x) => x.name);
    expect(orden).toEqual(["Promos", "MINUTAS", "PANADERIA", "BEBIDAS", "KIOSCO", "Zeta", "Alfa"]);
  });
  it("la cafetería va después de la confitería y antes de los congelados y las bebidas", () => {
    const g = (name: string) => ({ name });
    const orden = ordenarCategoriasCliente([g("BEBIDAS"), g("MINUTAS CONG"), g("Cafeteria"), g("CONFITERIA"), g("PANADERIA"), g("MINUTAS")]).map((x) => x.name);
    expect(orden).toEqual(["MINUTAS", "PANADERIA", "CONFITERIA", "Cafeteria", "MINUTAS CONG", "BEBIDAS"]);
  });
});

describe("elegirMasPedidos", () => {
  const items = [
    { id: "a", image: "a.jpg" }, { id: "b", image: null }, { id: "c", image: "c.jpg" },
    { id: "d", image: "d.jpg" }, { id: "e", image: "e.jpg" }, { id: "f", image: "f.jpg" },
  ];
  it("sigue el ranking y se queda con lo disponible y con foto", () => {
    expect(elegirMasPedidos(["b", "a", "zz", "c", "d", "e"], items)).toEqual(["a", "c", "d", "e"]);
  });
  it("con menos de 4 con foto no arma la tira", () => {
    expect(elegirMasPedidos(["a", "b", "c"], items)).toEqual([]);
  });
  it("respeta el máximo y no repite", () => {
    expect(elegirMasPedidos(["a", "a", "c", "d", "e", "f"], items, 3, 2)).toEqual(["a", "c", "d"]);
  });
});

import { MAX_BANNERS, normalizarDestacados, resolverBanners } from "@/lib/pedidos/destacado-online";

describe("banners destacados", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";
  const D = "44444444-4444-4444-8444-444444444444";
  const items = [{ id: A, image: "a.jpg" }, { id: B, image: null }, { id: C, image: "c.jpg" }, { id: D, image: "d.jpg" }];

  it("normaliza: ids válidos, sin repetir, hasta 3, títulos limpios (acepta item_id o itemId)", () => {
    const r = normalizarDestacados([{ itemId: A, titulo: "  Combo   del día " }, { item_id: B, titulo: "" }, { itemId: A, titulo: "repetido" }, { itemId: "nada" }, { itemId: C }, { itemId: D }]);
    expect(r).toEqual([{ itemId: A, titulo: "Combo del día" }, { itemId: B, titulo: null }, { itemId: C, titulo: null }]);
    expect(r).toHaveLength(MAX_BANNERS);
    expect(normalizarDestacados([{ itemId: A, titulo: "z".repeat(80) }])[0].titulo).toHaveLength(40);
    expect(normalizarDestacados("x")).toEqual([]);
  });
  it("rota lo que eligió el administrador, en ese orden y con su título; ignora lo que hoy no tiene foto", () => {
    expect(resolverBanners([{ itemId: C, titulo: "Combo del día" }, { itemId: B, titulo: null }, { itemId: A, titulo: null }], [], items))
      .toEqual([{ itemId: C, kicker: "Combo del día" }, { itemId: A, kicker: "Lo mejor de hoy" }]);
  });
  it("sin elegidos válidos rota lo más pedido (hasta 3, con foto)", () => {
    expect(resolverBanners([], [B, A, C, D], items)).toEqual([
      { itemId: A, kicker: "Lo más pedido" }, { itemId: C, kicker: "Lo más pedido" }, { itemId: D, kicker: "Lo más pedido" },
    ]);
    expect(resolverBanners([{ itemId: B, titulo: "x" }], [A], items)).toEqual([{ itemId: A, kicker: "Lo más pedido" }]);
  });
  it("sin nada con foto queda un solo banner general", () => {
    expect(resolverBanners([], [B], items)).toEqual([{ itemId: null, kicker: "" }]);
  });
});

describe("nombrePresentable: tildes en nombres ya escritos como frase", () => {
  it("agrega las tildes que suelen faltar, respetando mayúsculas", () => {
    expect(nombrePresentable("Cafe con leche")).toBe("Café con leche");
    expect(nombrePresentable("budin limon")).toBe("Budín limón");
    expect(nombrePresentable("Sandwich de Jamon")).toBe("Sándwich de Jamón");
  });
  it("no toca palabras que solo contienen esas letras", () => {
    expect(nombrePresentable("Cafeteras")).toBe("Cafeteras");
  });
});
