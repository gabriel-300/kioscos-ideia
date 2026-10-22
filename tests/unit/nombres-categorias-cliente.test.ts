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
    expect(nombreCategoriaCliente("KIOSKO")).toBe("Kiosco");
    expect(nombreCategoriaCliente("Confitería")).toBe("Dulces");
    expect(nombreCategoriaCliente("Algo Nuevo")).toBe("Algo Nuevo");
  });
  it("ordena primero lo que apetece y deja al final lo desconocido, sin perder el orden original", () => {
    const g = (name: string) => ({ name });
    const orden = ordenarCategoriasCliente([g("KIOSKO"), g("BEBIDAS"), g("Zeta"), g("PANADERIA"), g("Promos"), g("Alfa"), g("MINUTAS")]).map((x) => x.name);
    expect(orden).toEqual(["Promos", "MINUTAS", "PANADERIA", "BEBIDAS", "KIOSKO", "Zeta", "Alfa"]);
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
