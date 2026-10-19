import { describe, it, expect } from "vitest";
import { calcularCuentas, type CompraAdeudada, type MovimientoProveedor } from "@/lib/tesoreria/proveedores-cuenta";
import { listadoDeuda, tramoDe } from "@/lib/tesoreria/deuda-vencimientos";

const HOY = "2026-10-19";
const compra = (o: Partial<CompraAdeudada> = {}): CompraAdeudada => ({
  id: "c1", proveedor_id: "petri", sucursal_id: "parque", fecha: "2026-10-01", monto: 1000, descripcion: "Remito", comprobante_numero: null, fecha_vencimiento: null, ...o,
});
const mov = (o: Partial<MovimientoProveedor> = {}): MovimientoProveedor => ({
  id: "m1", tipo: "pago", proveedor_id: "petri", sucursal_id: "parque", fecha: "2026-10-05", monto: 500,
  origen: "efectivo_tesoreria", nota: null, created_at: "2026-10-05T12:00:00Z", created_by: null, ...o,
});

describe("tramoDe", () => {
  it("sin fecha es «sin vencimiento»", () => expect(tramoDe(null, HOY)).toBe("sin_vencimiento"));

  it("ayer ya venció; hoy todavía no", () => {
    expect(tramoDe("2026-10-18", HOY)).toBe("vencida");
    expect(tramoDe("2026-10-19", HOY)).toBe("vence_7");
  });

  it("los límites de 7 y 30 días", () => {
    expect(tramoDe("2026-10-26", HOY)).toBe("vence_7");
    expect(tramoDe("2026-10-27", HOY)).toBe("vence_30");
    expect(tramoDe("2026-11-18", HOY)).toBe("vence_30");
    expect(tramoDe("2026-11-19", HOY)).toBe("mas_30");
  });

  it("cruza el cambio de mes y de año sin errores", () => {
    expect(tramoDe("2027-01-01", "2026-12-31")).toBe("vence_7");
    expect(tramoDe("2026-12-30", "2027-01-02")).toBe("vencida");
  });
});

describe("listadoDeuda", () => {
  it("cada fila es lo que falta pagar del comprobante y las filas suman el saldo", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", monto: 1000, fecha_vencimiento: "2026-10-10" }), compra({ id: "b", fecha: "2026-10-05", monto: 2000, fecha_vencimiento: "2026-11-30" })],
      [mov({ id: "p", monto: 400 })],
    );
    const l = listadoDeuda(cuentas, HOY);
    expect(l.filas.map((f) => [f.egreso_id, f.tramo, f.monto])).toEqual([["a", "vencida", 600], ["b", "mas_30", 2000]]);
    expect(l.total).toBe(cuentas[0].saldo);
    expect(l.total).toBe(2600);
  });

  it("un comprobante cubierto por un pago no figura; uno cubierto en parte figura por lo que falta", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", monto: 1000, fecha_vencimiento: "2026-10-10" }), compra({ id: "b", fecha: "2026-10-05", monto: 2000, fecha_vencimiento: "2026-10-10" })],
      [mov({ id: "p", monto: 1500 })],
      [{ pago_id: "p", egreso_id: "b", monto: 1500 }],
    );
    const l = listadoDeuda(cuentas, HOY);
    expect(l.filas.map((f) => [f.egreso_id, f.monto])).toEqual([["a", 1000], ["b", 500]]);
  });

  it("calcula los días de atraso o los que faltan", () => {
    const cuentas = calcularCuentas([compra({ id: "a", fecha_vencimiento: "2026-10-14" }), compra({ id: "b", fecha_vencimiento: "2026-10-22" })], []);
    const l = listadoDeuda(cuentas, HOY);
    expect(l.filas.map((f) => [f.egreso_id, f.dias])).toEqual([["a", 5], ["b", -3]]);
  });

  it("el saldo inicial que los pagos todavía no cubrieron figura como «saldo anterior», sin vencimiento", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", monto: 1000, fecha_vencimiento: "2026-10-30" })],
      [mov({ id: "s", tipo: "saldo_inicial", origen: null, monto: 5000 }), mov({ id: "p", monto: 1200 })],
    );
    const l = listadoDeuda(cuentas, HOY);
    // 1200 de pago cubren 1200 del saldo inicial: quedan 3800 de saldo anterior y la compra entera.
    expect(l.filas.find((f) => f.egreso_id === null)).toMatchObject({ tramo: "sin_vencimiento", monto: 3800 });
    expect(l.total).toBe(4800);
    expect(l.total).toBe(cuentas[0].saldo);
  });

  it("una cuenta con saldo a favor no figura como deuda y se informa aparte", () => {
    const cuentas = calcularCuentas([compra({ monto: 1000 })], [mov({ monto: 1600 })]);
    const l = listadoDeuda(cuentas, HOY);
    expect(l.filas).toEqual([]);
    expect(l.total).toBe(0);
    expect(l.aFavor).toBe(600);
  });

  it("los totales por tramo y el orden: lo más vencido primero, lo sin fecha al final", () => {
    const cuentas = calcularCuentas([
      compra({ id: "sin", fecha: "2026-10-02", monto: 100 }),
      compra({ id: "lejos", fecha: "2026-10-02", monto: 200, fecha_vencimiento: "2026-12-30" }),
      compra({ id: "poco", fecha: "2026-10-02", monto: 300, fecha_vencimiento: "2026-10-20" }),
      compra({ id: "viejaVencida", fecha: "2026-10-02", monto: 400, fecha_vencimiento: "2026-10-05" }),
      compra({ id: "recienVencida", fecha: "2026-10-02", monto: 500, fecha_vencimiento: "2026-10-17" }),
    ], []);
    const l = listadoDeuda(cuentas, HOY);
    expect(l.filas.map((f) => f.egreso_id)).toEqual(["viejaVencida", "recienVencida", "poco", "lejos", "sin"]);
    expect(l.totales.vencida).toEqual({ cantidad: 2, monto: 900 });
    expect(l.totales.vence_7).toEqual({ cantidad: 1, monto: 300 });
    expect(l.totales.sin_vencimiento).toEqual({ cantidad: 1, monto: 100 });
  });
});
