import { describe, expect, it } from "vitest";
import { lineasParaReimprimir } from "@/lib/arca/ticket-datos";

const item = (nombre: string | null, cantidad: number, precio: number, subtotal: number) =>
  ({ cantidad, precio_unitario: precio, subtotal, product: nombre ? { name: nombre } : null });

describe("lineasParaReimprimir", () => {
  it("si los ítems suman el total de la factura, no agrega nada", () => {
    const l = lineasParaReimprimir([item("Agua", 1, 2000, 2000), item("Pan", 2, 850, 1700)], 3700);
    expect(l.map((x) => x.nombre)).toEqual(["Agua", "Pan"]);
  });

  it("si la factura incluye envío (los ítems suman menos), la diferencia sale como una línea más", () => {
    const l = lineasParaReimprimir([item("Empanada", 4, 1500, 6000)], 7000);
    expect(l).toHaveLength(2);
    expect(l[1]).toEqual({ nombre: "Envío y otros", cantidad: 1, precio: 1000, subtotal: 1000 });
  });

  it("no inventa líneas por diferencias de redondeo de centavos", () => {
    expect(lineasParaReimprimir([item("A", 1, 100, 99.999)], 100)).toHaveLength(1);
  });

  it("redondea las cantidades por peso y tolera un producto borrado", () => {
    const l = lineasParaReimprimir([item(null, 0.006666666666666667, 15000, 100)], 100);
    expect(l[0]).toMatchObject({ nombre: "Producto", cantidad: 0.0067 });
  });
});
