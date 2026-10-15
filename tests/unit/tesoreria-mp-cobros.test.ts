import { describe, it, expect } from "vitest";
import {
  leerReporteCobros, validarCobros, fechaMp, diaArgentino, claseDeCobro, resumirCobros, cruzarConSistema, MAX_FILAS_IMPORTACION,
  type Celda, type CobroGuardado, type OrdenQr,
} from "@/lib/tesoreria/mp-cobros";

// Encabezados reales del reporte de cobros de MP (solo las columnas que usamos, con su código entre paréntesis).
const ENCABEZADO: Celda[] = [
  "Fecha de compra (date_created)", "Fecha de acreditación (date_approved)", "Fecha de liberación del dinero (date_released)",
  "Nombre de la contraparte (counterpart_name)", "Descripción de la operación (reason)", "Código de referencia (external_reference)",
  "Número de operación de Mercado Pago (operation_id)", "Estado de la operación (status)", "Detalle del estado (status_detail)",
  "Tipo de operación (operation_type)", "Valor del producto (transaction_amount)", "Tarifa de Mercado Pago (mercadopago_fee)",
  "Monto recibido (net_received_amount)", "Medio de pago (payment_type)", "Monto devuelto (amount_refunded)",
  "Número de caja externo (external_id)",
];
const fila = (o: Record<string, Celda> = {}): Celda[] => {
  const base: Record<string, Celda> = {
    date_created: "13/10/2026 21:02:27", date_approved: "13/10/2026 21:02:28", date_released: "13/10/2026 21:02:28",
    counterpart_name: "Cliente Anónimo", reason: "Kioscos IDEIA", external_reference: "617e3514-70b4-4129-b160-d44989238d9a",
    operation_id: "183013333773", status: "approved", status_detail: "accredited", operation_type: "regular_payment",
    transaction_amount: "4000.00", mercadopago_fee: "-38.72", net_received_amount: "3801.28", payment_type: "account_money",
    amount_refunded: "0.00", external_id: "CajaPARQUE136276582",
  };
  const v = { ...base, ...o };
  return ENCABEZADO.map((h) => v[String(h).match(/\(([a-z_]+)\)$/)![1]]);
};

describe("fechaMp / diaArgentino", () => {
  it("interpreta la hora de MP como hora argentina", () => {
    expect(fechaMp("13/10/2026 21:02:27")).toBe("2026-10-13T21:02:27-03:00");
    expect(diaArgentino(fechaMp("13/10/2026 21:02:27")!)).toBe("2026-10-13");
  });
  it("un cobro de las 23:30 sigue siendo de ese día aunque en UTC ya sea el siguiente", () => {
    expect(diaArgentino(fechaMp("13/10/2026 23:30:00")!)).toBe("2026-10-13");
  });
  it("devuelve null si no se puede leer", () => {
    expect(fechaMp("ayer")).toBeNull();
    expect(fechaMp(null)).toBeNull();
  });
});

describe("leerReporteCobros", () => {
  it("lee un cobro, vuelve positiva la comisión y no se lleva datos personales", () => {
    const l = leerReporteCobros([ENCABEZADO, fila()]);
    expect(l.errores).toEqual([]);
    expect(l.filas).toHaveLength(1);
    expect(l.filas[0]).toMatchObject({
      operation_id: "183013333773", monto_bruto: 4000, tarifa: 38.72, monto_neto: 3801.28,
      tipo_operacion: "regular_payment", caja_externa: "CajaPARQUE136276582", estado: "approved",
    });
    expect(JSON.stringify(l.filas)).not.toContain("Cliente Anónimo");
    expect(l.desde).toBe("2026-10-13");
  });

  it("ignora los rechazados y las operaciones repetidas", () => {
    const l = leerReporteCobros([
      ENCABEZADO,
      fila({ operation_id: "1" }),
      fila({ operation_id: "1" }),
      fila({ operation_id: "2", status: "rejected", status_detail: "cc_rejected_insufficient_amount" }),
    ]);
    expect(l.filas).toHaveLength(1);
    expect(l.ignoradas).toBe(1);
  });

  it("avisa si el archivo no es un reporte de cobros", () => {
    const l = leerReporteCobros([["Fecha", "Monto"], ["01/01/2026", 10]]);
    expect(l.filas).toHaveLength(0);
    expect(l.errores[0]).toMatch(/No parece el reporte de cobros/);
  });

  it("reporta la fila con importe ilegible y sigue con las demás", () => {
    const l = leerReporteCobros([ENCABEZADO, fila({ operation_id: "1", transaction_amount: "abc" }), fila({ operation_id: "2" })]);
    expect(l.filas).toHaveLength(1);
    expect(l.errores[0]).toMatch(/Fila 2/);
  });

  it("devuelve el rango de días del archivo", () => {
    const l = leerReporteCobros([
      ENCABEZADO,
      fila({ operation_id: "1", date_created: "09/10/2026 10:00:00" }),
      fila({ operation_id: "2", date_created: "13/10/2026 23:59:00" }),
    ]);
    expect([l.desde, l.hasta]).toEqual(["2026-10-09", "2026-10-13"]);
  });
});

describe("validarCobros (servidor)", () => {
  const ok = leerReporteCobros([ENCABEZADO, fila()]).filas;

  it("acepta lo que produce la lectura", () => {
    expect("valor" in validarCobros(ok)).toBe(true);
  });
  it("rechaza lo que no es una lista", () => {
    expect(validarCobros({ a: 1 })).toHaveProperty("error");
    expect(validarCobros([])).toHaveProperty("error");
  });
  it("rechaza un número de operación con caracteres raros", () => {
    expect(validarCobros([{ ...ok[0], operation_id: "1; drop table" }])).toHaveProperty("error");
  });
  it("rechaza importes que no son números", () => {
    expect(validarCobros([{ ...ok[0], monto_bruto: "4000" }])).toHaveProperty("error");
    expect(validarCobros([{ ...ok[0], monto_neto: Number.NaN }])).toHaveProperty("error");
  });
  it("rechaza operaciones repetidas y demasiadas filas", () => {
    expect(validarCobros([ok[0], ok[0]])).toHaveProperty("error");
    const muchas = Array.from({ length: MAX_FILAS_IMPORTACION + 1 }, (_, i) => ({ ...ok[0], operation_id: String(i + 1) }));
    expect(validarCobros(muchas)).toHaveProperty("error");
  });
  it("rechaza textos desmedidos", () => {
    expect(validarCobros([{ ...ok[0], descripcion: "x".repeat(400) }])).toHaveProperty("error");
  });
});

describe("claseDeCobro", () => {
  it("una venta por QR de una caja conocida es cobro", () => {
    expect(claseDeCobro({ tipo_operacion: "regular_payment" }, "suc-1")).toBe("cobro");
  });
  it("un fondeo o un cobro sin local queda a clasificar: no se asume qué es", () => {
    expect(claseDeCobro({ tipo_operacion: "account_fund" }, "suc-1")).toBe("a_clasificar");
    expect(claseDeCobro({ tipo_operacion: "regular_payment" }, null)).toBe("a_clasificar");
  });
});

const cobro = (o: Partial<CobroGuardado> = {}): CobroGuardado => ({
  operation_id: "1", sucursal_id: "parque", fecha_cobro: "2026-10-13T21:00:00-03:00", fecha_liberacion: null,
  monto_bruto: 1000, tarifa: 10, monto_neto: 990, monto_devuelto: 0, estado: "approved", clase: "cobro",
  clasificacion: null, external_reference: "ref-1", ...o,
});
const orden = (o: Partial<OrdenQr> = {}): OrdenQr => ({
  external_reference: "ref-1", mp_payment_id: "1", estado: "pagado", monto: 1000, paid_at: "2026-10-14T00:00:30Z",
  movimiento_id: "venta-1", sucursal_id: "parque", ...o,
});

describe("resumirCobros", () => {
  it("suma solo cobros de caja aprobados y separa lo que queda a liberar", () => {
    const ahora = Date.parse("2026-10-14T12:00:00-03:00");
    const r = resumirCobros([
      cobro({ operation_id: "1" }),
      cobro({ operation_id: "2", monto_bruto: 2000, tarifa: 20, monto_neto: 1980, fecha_liberacion: "2026-10-20T00:00:00-03:00" }),
      cobro({ operation_id: "3", clase: "a_clasificar", sucursal_id: null, monto_bruto: 91120, monto_neto: 91120 }),
      cobro({ operation_id: "4", estado: "refunded" }),
    ], ahora);
    expect(r.total).toMatchObject({ cobros: 2, bruto: 3000, tarifa: 30, neto: 2970, aLiberar: 1980 });
    expect(r.porSucursal.get("parque")?.cobros).toBe(2);
  });
});

describe("cruzarConSistema", () => {
  const rango = [{ desde: "2026-10-09", hasta: "2026-10-13" }];

  it("un cobro con su orden y su venta no genera diferencias", () => {
    const c = cruzarConSistema([cobro()], [orden()], rango);
    expect(c).toEqual({ mpSinSistema: [], mpSinVenta: [], distintoMonto: [], sistemaSinMp: [] });
  });
  it("detecta lo que MP cobró y el sistema no tiene", () => {
    const c = cruzarConSistema([cobro({ operation_id: "9", external_reference: "otra" })], [orden()], rango);
    expect(c.mpSinSistema.map((x) => x.operation_id)).toEqual(["9"]);
  });
  it("detecta una orden pagada que no quedó atada a una venta", () => {
    const c = cruzarConSistema([cobro()], [orden({ movimiento_id: null })], rango);
    expect(c.mpSinVenta).toHaveLength(1);
  });
  it("detecta importes distintos", () => {
    const c = cruzarConSistema([cobro()], [orden({ monto: 900 })], rango);
    expect(c.distintoMonto).toHaveLength(1);
  });
  it("una orden del sistema sin cobro cuenta solo si el día está cubierto por una importación", () => {
    const huerfana = orden({ external_reference: "ref-x", mp_payment_id: "77", paid_at: "2026-10-12T15:00:00Z" });
    expect(cruzarConSistema([], [huerfana], rango).sistemaSinMp).toHaveLength(1);
    expect(cruzarConSistema([], [huerfana], [{ desde: "2026-10-01", hasta: "2026-10-05" }]).sistemaSinMp).toHaveLength(0);
  });
  it("une por referencia cuando la orden no tiene número de operación", () => {
    const c = cruzarConSistema([cobro()], [orden({ mp_payment_id: null })], rango);
    expect(c.mpSinSistema).toHaveLength(0);
  });
});
