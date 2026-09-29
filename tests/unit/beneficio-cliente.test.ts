import { describe, it, expect } from "vitest";
import { calcularBeneficio, describirBeneficio, hayBeneficios, repartirDescuento, type ConfigBeneficio } from "@/lib/pedidos/beneficio-cliente";

const cfg = (over: Partial<ConfigBeneficio> = {}): ConfigBeneficio => ({ descuentoPct: 0, descuentoSoloPrimera: false, envioGratisPrimera: false, ...over });
const base = { subtotal: 10000, esCliente: true, esPrimeraCompra: true, esDelivery: true };

describe("calcularBeneficio", () => {
  it("un invitado nunca recibe nada", () => {
    expect(calcularBeneficio({ ...base, esCliente: false, config: cfg({ descuentoPct: 5, envioGratisPrimera: true }) })).toEqual({ descuentoProductos: 0, envioBonificado: false });
  });
  it("todo en 0: no hay beneficio", () => {
    expect(calcularBeneficio({ ...base, config: cfg() })).toEqual({ descuentoProductos: 0, envioBonificado: false });
    expect(hayBeneficios(cfg())).toBe(false);
  });
  it("el % se aplica sobre el subtotal de productos", () => {
    expect(calcularBeneficio({ ...base, config: cfg({ descuentoPct: 5 }) }).descuentoProductos).toBe(500);
  });
  it("con 'solo primera compra' el % no vale desde la segunda", () => {
    const config = cfg({ descuentoPct: 5, descuentoSoloPrimera: true });
    expect(calcularBeneficio({ ...base, config }).descuentoProductos).toBe(500);
    expect(calcularBeneficio({ ...base, esPrimeraCompra: false, config }).descuentoProductos).toBe(0);
  });
  it("sin 'solo primera compra' el % vale siempre", () => {
    expect(calcularBeneficio({ ...base, esPrimeraCompra: false, config: cfg({ descuentoPct: 5 }) }).descuentoProductos).toBe(500);
  });
  it("envío gratis: solo delivery y solo la primera compra", () => {
    const config = cfg({ envioGratisPrimera: true });
    expect(calcularBeneficio({ ...base, config }).envioBonificado).toBe(true);
    expect(calcularBeneficio({ ...base, esPrimeraCompra: false, config }).envioBonificado).toBe(false);
    expect(calcularBeneficio({ ...base, esDelivery: false, config }).envioBonificado).toBe(false);
  });
  it("redondea a centavos", () => {
    expect(calcularBeneficio({ ...base, subtotal: 999.99, config: cfg({ descuentoPct: 5 }) }).descuentoProductos).toBe(50);
  });
});

describe("repartirDescuento", () => {
  it("la suma queda exactamente en subtotal - descuento, sin perder centavos", () => {
    const items = [{ subtotal: 333.33 }, { subtotal: 333.33 }, { subtotal: 333.34 }];
    const r = repartirDescuento(items, 50);
    expect(Math.round(r.reduce((s, i) => s + i.subtotal, 0) * 100) / 100).toBe(950);
  });
  it("reparte en proporción al subtotal de cada línea", () => {
    const r = repartirDescuento([{ subtotal: 3000 }, { subtotal: 1000 }], 400);
    expect(r.map((i) => i.subtotal)).toEqual([2700, 900]);
  });
  it("sin descuento devuelve las líneas tal cual", () => {
    const items = [{ subtotal: 100 }];
    expect(repartirDescuento(items, 0)).toBe(items);
  });
  it("conserva los otros campos de cada línea", () => {
    expect(repartirDescuento([{ subtotal: 100, product_id: "p1" }], 10)[0]).toMatchObject({ product_id: "p1", subtotal: 90 });
  });
});

describe("describirBeneficio", () => {
  it("arma el texto para invitar a registrarse", () => {
    expect(describirBeneficio(cfg({ descuentoPct: 5 }))).toBe("5% de descuento");
    expect(describirBeneficio(cfg({ descuentoPct: 5, descuentoSoloPrimera: true }))).toBe("5% de descuento en tu primera compra");
    expect(describirBeneficio(cfg({ envioGratisPrimera: true }))).toBe("Envío gratis en tu primera compra");
    expect(describirBeneficio(cfg({ descuentoPct: 5, descuentoSoloPrimera: true, envioGratisPrimera: true }))).toBe("5% de descuento en tu primera compra y envío gratis");
  });
  it("sin beneficios no hay texto", () => {
    expect(describirBeneficio(cfg())).toBeNull();
  });
});
