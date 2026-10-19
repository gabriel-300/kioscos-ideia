import { describe, it, expect } from "vitest";
import {
  calcularCuentas, estadoPorCompra, totalAdeudado, validarMovimientoProveedor, validarImputaciones, deudaDelResumen,
  type CompraAdeudada, type MovimientoProveedor,
} from "@/lib/tesoreria/proveedores-cuenta";

const compra = (o: Partial<CompraAdeudada> = {}): CompraAdeudada => ({
  id: "c1", proveedor_id: "petri", sucursal_id: "parque", fecha: "2026-10-01", monto: 1000, descripcion: "Remito", comprobante_numero: null, ...o,
});
const mov = (o: Partial<MovimientoProveedor> = {}): MovimientoProveedor => ({
  id: "m1", tipo: "pago", proveedor_id: "petri", sucursal_id: "parque", fecha: "2026-10-05", monto: 500,
  origen: "efectivo_tesoreria", nota: null, created_at: "2026-10-05T12:00:00Z", created_by: null, ...o,
});

describe("calcularCuentas", () => {
  it("el saldo es saldo inicial + compras que se deben − pagos", () => {
    const [c] = calcularCuentas(
      [compra({ id: "a", monto: 1000 }), compra({ id: "b", monto: 2000 })],
      [mov({ id: "s", tipo: "saldo_inicial", origen: null, monto: 5000 }), mov({ id: "p", monto: 1500 })],
    );
    expect(c).toMatchObject({ saldoInicial: 5000, compras: 3000, pagos: 1500, saldo: 6500 });
  });

  it("un pago en bloque cubre primero el saldo inicial y después las compras más viejas", () => {
    const [c] = calcularCuentas(
      [compra({ id: "nueva", fecha: "2026-10-10", monto: 1000 }), compra({ id: "vieja", fecha: "2026-10-02", monto: 1000 })],
      [mov({ id: "s", tipo: "saldo_inicial", origen: null, monto: 500 }), mov({ id: "p", monto: 1700 })],
    );
    // 1700 − 500 de saldo inicial = 1200 para compras: la vieja entera y 200 de la nueva.
    expect(c.detalleCompras.map((d) => [d.compra.id, d.estado, d.resta])).toEqual([
      ["vieja", "cubierta", 0], ["nueva", "parcial", 800],
    ]);
    expect(c.saldo).toBe(800);
  });

  it("un pago de más queda como saldo a favor (negativo)", () => {
    const [c] = calcularCuentas([compra({ monto: 1000 })], [mov({ monto: 1500 })]);
    expect(c.saldo).toBe(-500);
    expect(c.detalleCompras[0].estado).toBe("cubierta");
  });

  it("separa por proveedor y por local: lo de UNAM no tapa lo de Parque", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", sucursal_id: "parque", monto: 1000 }), compra({ id: "b", sucursal_id: "unam", monto: 800 })],
      [mov({ sucursal_id: "unam", monto: 800 })],
    );
    const por = Object.fromEntries(cuentas.map((c) => [c.sucursal_id, c.saldo]));
    expect(por).toEqual({ parque: 1000, unam: 0 });
  });

  it("las compras sin local van a una cuenta «general» del proveedor", () => {
    const [c] = calcularCuentas([compra({ sucursal_id: null })], []);
    expect(c.sucursal_id).toBeNull();
    expect(c.saldo).toBe(1000);
  });

  it("un proveedor con solo saldo inicial y sin compras aparece igual", () => {
    const [c] = calcularCuentas([], [mov({ tipo: "saldo_inicial", origen: null, monto: 2630 })]);
    expect(c.saldo).toBe(2630);
    expect(c.detalleCompras).toEqual([]);
  });

  it("ordena de mayor deuda a menor", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", proveedor_id: "x", monto: 100 }), compra({ id: "b", proveedor_id: "y", monto: 900 })], [],
    );
    expect(cuentas.map((c) => c.proveedor_id)).toEqual(["y", "x"]);
  });
});

describe("totalAdeudado", () => {
  it("separa lo que se debe de lo que está a favor", () => {
    expect(totalAdeudado([{ saldo: 1000 }, { saldo: -300 }, { saldo: 200 }])).toEqual({ debe: 1200, aFavor: 300, neto: 900 });
  });
});

describe("validarMovimientoProveedor", () => {
  const base = { tipo: "pago", proveedor_id: "petri", sucursal_id: "parque", fecha: "2026-10-05", monto: 1500.555, origen: "transferencia", nota: " remitos 204 " };
  const HOY = "2026-10-15";

  it("acepta un pago y redondea el monto", () => {
    const r = validarMovimientoProveedor(base, HOY);
    expect(r).toEqual({ valor: { tipo: "pago", proveedor_id: "petri", sucursal_id: "parque", fecha: "2026-10-05", monto: 1500.56, origen: "transferencia", nota: "remitos 204" } });
  });
  it("el pago exige de dónde salió la plata, y no acepta el retiro de caja (tiene su propio camino)", () => {
    expect(validarMovimientoProveedor({ ...base, origen: null }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, origen: "retiro_caja" }, HOY)).toHaveProperty("error");
  });
  it("el saldo inicial no lleva origen", () => {
    const r = validarMovimientoProveedor({ ...base, tipo: "saldo_inicial", origen: "transferencia" }, HOY);
    expect("valor" in r && r.valor.origen).toBeNull();
  });
  it("rechaza monto cero o negativo, fecha futura o inválida, y faltantes", () => {
    expect(validarMovimientoProveedor({ ...base, monto: 0 }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, monto: -5 }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, fecha: "2026-10-16" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, fecha: "2026-02-30" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, proveedor_id: "" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, sucursal_id: "" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoProveedor({ ...base, tipo: "otro" }, HOY)).toHaveProperty("error");
  });
});

describe("estadoPorCompra", () => {
  it("devuelve estado, resta y cubierto por id de compra según los pagos de la cuenta", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", fecha: "2026-10-01", monto: 1000 }), compra({ id: "b", fecha: "2026-10-02", monto: 1000 }), compra({ id: "c", fecha: "2026-10-03", monto: 1000 })],
      [mov({ monto: 1400 })],
    );
    expect(estadoPorCompra(cuentas)).toEqual({
      a: { estado: "cubierta", resta: 0, cubierto: 1000 },
      b: { estado: "parcial", resta: 600, cubierto: 400 },
      c: { estado: "pendiente", resta: 1000, cubierto: 0 },
    });
  });

  it("cada cuenta usa solo sus propios pagos y sin cuentas no hay nada", () => {
    const cuentas = calcularCuentas(
      [compra({ id: "a", sucursal_id: "parque", monto: 1000 }), compra({ id: "b", sucursal_id: "unam", monto: 1000 })],
      [mov({ sucursal_id: "parque", monto: 1000 })],
    );
    const est = estadoPorCompra(cuentas);
    expect(est.a.estado).toBe("cubierta");
    expect(est.b.estado).toBe("pendiente");
    expect(estadoPorCompra([])).toEqual({});
  });
});

describe("deudaDelResumen", () => {
  const nombreProv = new Map([["petri", "Petri"]]);
  const nombreLoc = new Map([["parque", "Parque"]]);
  const pend = (o: Record<string, unknown>) => ({
    id: "e1", proveedor_id: "petri", sucursal_id: "parque", descripcion: "Remito", monto: 1000, fecha: "2026-10-01", comprobante_numero: null, ...o,
  }) as Parameters<typeof deudaDelResumen>[0][number];

  it("lo que se debe es el saldo (compras − pagos), y las compras sin proveedor siguen agrupadas por texto", () => {
    const r = deudaDelResumen(
      [pend({ id: "a", monto: 1000 }), pend({ id: "b", monto: 2000 }), pend({ id: "c", proveedor_id: null, descripcion: "Lo de Mario", monto: 300 })],
      [mov({ monto: 1200 })],
      nombreProv, nombreLoc,
    );
    expect(r.total).toBe(2100);   // Petri (3000 − 1200 = 1800) + Lo de Mario (300)
    expect(r.items.map((i) => [i.nombre, i.monto])).toEqual([["Petri · Parque", 1800], ["Lo de Mario", 300]]);
  });

  it("la cantidad de remitos cuenta solo los que los pagos todavía no cubren", () => {
    const r = deudaDelResumen(
      [pend({ id: "a", fecha: "2026-10-01", monto: 1000 }), pend({ id: "b", fecha: "2026-10-02", monto: 1000 }), pend({ id: "c", fecha: "2026-10-03", monto: 1000 })],
      [mov({ monto: 1500 })],   // cubre «a» entero y la mitad de «b»
      nombreProv, nombreLoc,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ monto: 1500, cantidad: 2 });
  });

  it("un proveedor al día no aparece en lo que se debe", () => {
    const r = deudaDelResumen([pend({ monto: 1000 })], [mov({ monto: 1000 })], nombreProv, nombreLoc);
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
  });
});

describe("imputación de pagos a remitos o facturas (migración 112)", () => {
  const dos = [compra({ id: "vieja", fecha: "2026-10-02", monto: 1000 }), compra({ id: "nueva", fecha: "2026-10-10", monto: 2000 })];

  it("un pago imputado a la compra nueva la cubre a ella y no a la más vieja", () => {
    const [c] = calcularCuentas(dos, [mov({ id: "p", monto: 2000 })], [{ pago_id: "p", egreso_id: "nueva", monto: 2000 }]);
    expect(c.detalleCompras.map((d) => [d.compra.id, d.estado, d.resta])).toEqual([["vieja", "pendiente", 1000], ["nueva", "cubierta", 0]]);
  });

  it("el saldo no cambia por imputar: sigue siendo saldo inicial + compras − pagos", () => {
    const sin = calcularCuentas(dos, [mov({ id: "p", monto: 2000 })])[0];
    const con = calcularCuentas(dos, [mov({ id: "p", monto: 2000 })], [{ pago_id: "p", egreso_id: "nueva", monto: 2000 }])[0];
    expect(con.saldo).toBe(sin.saldo);
    expect(con.saldo).toBe(1000);
  });

  it("un pago se reparte entre varios remitos y lo que sobra cubre lo más viejo", () => {
    const tres = [...dos, compra({ id: "ultima", fecha: "2026-10-12", monto: 500 })];
    const [c] = calcularCuentas(tres, [mov({ id: "p", monto: 1600 })], [{ pago_id: "p", egreso_id: "nueva", monto: 1000 }, { pago_id: "p", egreso_id: "ultima", monto: 500 }]);
    // 1500 imputados; los 100 restantes caen en la más vieja.
    expect(Object.fromEntries(c.detalleCompras.map((d) => [d.compra.id, [d.estado, d.resta]]))).toEqual({
      vieja: ["parcial", 900], nueva: ["parcial", 1000], ultima: ["cubierta", 0],
    });
  });

  it("imputar parte de un remito lo deja en parte y el resto del pago a cuenta cubre lo más viejo", () => {
    const [c] = calcularCuentas(dos, [mov({ id: "p", monto: 1500 })], [{ pago_id: "p", egreso_id: "nueva", monto: 500 }]);
    expect(Object.fromEntries(c.detalleCompras.map((d) => [d.compra.id, [d.estado, d.resta]]))).toEqual({
      vieja: ["cubierta", 0], nueva: ["parcial", 1500],
    });
  });

  it("si el pago se anuló (ya no está entre los movimientos), su imputación se ignora", () => {
    const [c] = calcularCuentas(dos, [], [{ pago_id: "anulado", egreso_id: "nueva", monto: 2000 }]);
    expect(c.detalleCompras.every((d) => d.estado === "pendiente")).toBe(true);
  });

  it("si la compra ya no está (anulada o pagada), su imputación se ignora y el pago cubre lo que queda", () => {
    const [c] = calcularCuentas([dos[0]], [mov({ id: "p", monto: 1000 })], [{ pago_id: "p", egreso_id: "ya-no-esta", monto: 1000 }]);
    expect(c.detalleCompras[0].estado).toBe("cubierta");
    expect(c.saldo).toBe(0);
  });

  it("una imputación mayor al monto de la compra no la cubre de más: el exceso sigue a cuenta", () => {
    const [c] = calcularCuentas(dos, [mov({ id: "p", monto: 1500 })], [{ pago_id: "p", egreso_id: "vieja", monto: 1500 }]);
    expect(c.detalleCompras.map((d) => [d.compra.id, d.estado, d.resta])).toEqual([["vieja", "cubierta", 0], ["nueva", "parcial", 1500]]);
  });

  it("sin imputaciones se comporta igual que antes (pagos viejos)", () => {
    const a = calcularCuentas(dos, [mov({ id: "p", monto: 1200 })]);
    const b = calcularCuentas(dos, [mov({ id: "p", monto: 1200 })], []);
    expect(b).toEqual(a);
  });
});

describe("validarImputaciones", () => {
  const resta = new Map([["a", 1000], ["b", 500]]);

  it("sin imputaciones es válido (el pago queda a cuenta)", () => {
    expect(validarImputaciones([], 700, resta)).toEqual({ valor: [] });
    expect(validarImputaciones(undefined, 700, resta)).toEqual({ valor: [] });
  });

  it("acepta repartir el pago entre remitos, con su monto redondeado", () => {
    expect(validarImputaciones([{ egreso_id: "a", monto: 600.004 }, { egreso_id: "b", monto: 400 }], 1000, resta))
      .toEqual({ valor: [{ egreso_id: "a", monto: 600 }, { egreso_id: "b", monto: 400 }] });
  });

  it("rechaza un remito que no es de la cuenta o ya no se debe", () => {
    expect(validarImputaciones([{ egreso_id: "x", monto: 100 }], 1000, resta)).toHaveProperty("error");
  });

  it("rechaza un remito repetido, montos en cero o negativos y no numéricos", () => {
    expect(validarImputaciones([{ egreso_id: "a", monto: 100 }, { egreso_id: "a", monto: 100 }], 1000, resta)).toHaveProperty("error");
    expect(validarImputaciones([{ egreso_id: "a", monto: 0 }], 1000, resta)).toHaveProperty("error");
    expect(validarImputaciones([{ egreso_id: "a", monto: -5 }], 1000, resta)).toHaveProperty("error");
    expect(validarImputaciones([{ egreso_id: "a", monto: NaN }], 1000, resta)).toHaveProperty("error");
  });

  it("rechaza imputar más de lo que le falta a un remito", () => {
    expect(validarImputaciones([{ egreso_id: "b", monto: 501 }], 1000, resta)).toHaveProperty("error");
  });

  it("rechaza que lo imputado supere el monto del pago", () => {
    expect(validarImputaciones([{ egreso_id: "a", monto: 600 }, { egreso_id: "b", monto: 500 }], 1000, resta)).toHaveProperty("error");
  });
});
