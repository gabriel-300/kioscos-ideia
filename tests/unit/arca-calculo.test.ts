import { describe, expect, it } from "vitest";
import { desglosarIva, importeArca, idAlicuotaArca } from "@/lib/arca/calculo";
import { cuitValido, datosFaltantesEmisor, debeFacturarseSola, montoQueSeFacturaSolo, normalizarReceptor } from "@/lib/arca/reglas";

describe("desglosarIva (precio final con IVA incluido)", () => {
  it("1210 al 21% → neto 1000 + IVA 210 (el caso que ARCA aprobó en homologación)", () => {
    const d = desglosarIva([{ subtotal: 1210, alicuota: 21 }]);
    expect(d).toMatchObject({ total: 1210, neto: 1000, iva: 210 });
    expect(d.tramos).toEqual([{ alicuota: 21, idArca: 5, base: 1000, importe: 210 }]);
  });

  it("siempre cierra al centavo: neto + IVA = total, para muchos importes", () => {
    for (let c = 1; c <= 20000; c += 7) {
      const total = c / 100;
      const d = desglosarIva([{ subtotal: total, alicuota: 21 }]);
      expect(Math.round((d.neto + d.iva) * 100)).toBe(Math.round(total * 100));
    }
  });

  it("agrupa por alícuota y la suma de los tramos es el total", () => {
    const d = desglosarIva([
      { subtotal: 1210, alicuota: 21 },
      { subtotal: 605, alicuota: 21 },
      { subtotal: 1105, alicuota: 10.5 },
      { subtotal: 300, alicuota: 0 },
    ]);
    expect(d.tramos.map((t) => t.alicuota)).toEqual([0, 10.5, 21]);
    expect(d.total).toBe(3220);
    expect(d.tramos.find((t) => t.alicuota === 21)).toMatchObject({ base: 1500, importe: 315 });
    expect(d.tramos.find((t) => t.alicuota === 10.5)).toMatchObject({ base: 1000, importe: 105 });
    expect(d.tramos.find((t) => t.alicuota === 0)).toMatchObject({ base: 300, importe: 0 });
    expect(Math.round((d.neto + d.iva) * 100)).toBe(322000);
  });

  it("no arrastra decimales de float al sumar", () => {
    const d = desglosarIva([{ subtotal: 0.1, alicuota: 21 }, { subtotal: 0.2, alicuota: 21 }]);
    expect(d.total).toBe(0.3);
  });

  it("rechaza una alícuota que ARCA no soporta y un subtotal inválido", () => {
    expect(() => desglosarIva([{ subtotal: 100, alicuota: 5 }])).toThrow(/no soportada/);
    expect(() => desglosarIva([{ subtotal: NaN, alicuota: 21 }])).toThrow();
    expect(idAlicuotaArca(10.5)).toBe(4);
  });

  it("importeArca da siempre dos decimales", () => {
    expect(importeArca(1210)).toBe("1210.00");
    expect(importeArca(0.1 + 0.2)).toBe("0.30");
  });
});

describe("debeFacturarseSola (QR de Mercado Pago = billetera virtual, y transferencia)", () => {
  const base = { tipo: "venta", canal: "consumidor_final", anulado_en: null, pago_efectivo: null, pago_billetera: null, pago_tarjeta: null, pago_transferencia: null };
  it("efectivo y tarjeta/posnet: no se facturan solos", () => {
    expect(debeFacturarseSola({ ...base, pago_efectivo: 1000 })).toBe(false);
    expect(debeFacturarseSola({ ...base, pago_tarjeta: 500 })).toBe(false);
    expect(debeFacturarseSola({ ...base, pago_efectivo: 700, pago_tarjeta: 300 })).toBe(false);
  });
  it("billetera virtual (QR de Mercado Pago): sí", () => {
    expect(debeFacturarseSola({ ...base, pago_billetera: 500 })).toBe(true);
  });
  it("transferencia: sí", () => {
    expect(debeFacturarseSola({ ...base, pago_transferencia: 500 })).toBe(true);
  });
  it("mezcla efectivo + billetera o transferencia: se factura la venta entera", () => {
    const v = { ...base, pago_efectivo: 700, pago_billetera: 300 };
    expect(debeFacturarseSola(v)).toBe(true);
    expect(montoQueSeFacturaSolo(v)).toBe(300);
    expect(debeFacturarseSola({ ...base, pago_efectivo: 700, pago_transferencia: 300 })).toBe(true);
    expect(montoQueSeFacturaSolo({ pago_billetera: 100, pago_transferencia: 200.5 })).toBe(300.5);
  });
  it("fiado, Pedido Ya plataforma, anuladas y no-ventas: no, aunque haya billetera o transferencia", () => {
    expect(debeFacturarseSola({ ...base, canal: "cuenta_corriente", pago_billetera: 1 })).toBe(false);
    expect(debeFacturarseSola({ ...base, canal: "pedido_ya_plataforma", pago_transferencia: 1 })).toBe(false);
    expect(debeFacturarseSola({ ...base, anulado_en: "2026-11-03", pago_transferencia: 1 })).toBe(false);
    expect(debeFacturarseSola({ ...base, tipo: "entrega", pago_billetera: 1 })).toBe(false);
  });
});

describe("receptor y CUIT", () => {
  it("CUIT de la SAS y de Damián son válidos; uno alterado no", () => {
    expect(cuitValido("30719673623")).toBe(true);
    expect(cuitValido("20302371866")).toBe(true);
    expect(cuitValido("30719673624")).toBe(false);
    expect(cuitValido("123")).toBe(false);
  });
  it("sin dato = consumidor final; DNI y CUIT se reconocen; basura se rechaza", () => {
    expect(normalizarReceptor("")).toEqual({ receptor: { docTipo: 99, docNro: "0", condicionIva: 5 } });
    expect(normalizarReceptor("30.123.456").receptor).toMatchObject({ docTipo: 96, docNro: "30123456" });
    expect(normalizarReceptor("20-30237186-6").receptor).toMatchObject({ docTipo: 80, docNro: "20302371866" });
    expect(normalizarReceptor("20-30237186-7").error).toMatch(/CUIT/);
    expect(normalizarReceptor("12345").error).toMatch(/DNI/);
  });
});

import { urlQrArca } from "@/lib/arca/qr";
describe("QR de ARCA", () => {
  it("arma la URL con el JSON de la especificación en base64", () => {
    const url = urlQrArca({ fecha: "2026-11-03", cuit: "30719673623", puntoVenta: 1, tipoCmp: 6, numero: 1, importe: 1210, docTipo: 99, docNro: "0", cae: "86441044960533" });
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
    const json = JSON.parse(Buffer.from(url.split("?p=")[1], "base64").toString());
    expect(json).toEqual({ ver: 1, fecha: "2026-11-03", cuit: 30719673623, ptoVta: 1, tipoCmp: 6, nroCmp: 1, importe: 1210, moneda: "PES", ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: "E", codAut: 86441044960533 });
  });
});

describe("receptor de Factura A", () => {
  it("exige un CUIT válido y lo marca Responsable Inscripto", () => {
    expect(normalizarReceptor("30-71967362-3", "A").receptor).toEqual({ docTipo: 80, docNro: "30719673623", condicionIva: 1 });
    expect(normalizarReceptor("", "A").error).toMatch(/CUIT/);
    expect(normalizarReceptor("30123456", "A").error).toMatch(/CUIT/);      // un DNI no sirve para la A
    expect(normalizarReceptor("30-71967362-4", "A").error).toMatch(/válido/);
  });
  it("la B no cambia: vacío = consumidor final y un CUIT sigue yendo como consumidor final", () => {
    expect(normalizarReceptor("", "B").receptor).toMatchObject({ docTipo: 99, condicionIva: 5 });
    expect(normalizarReceptor("30719673623").receptor).toMatchObject({ docTipo: 80, condicionIva: 5 });
  });
});

describe("datosFaltantesEmisor (protección para facturar de verdad)", () => {
  const completo = { ambiente: "produccion", domicilio: "176 5812 - Posadas", ingresos_brutos: "123-456", inicio_actividades: "2026-11-01" };
  it("producción completa: no falta nada", () => {
    expect(datosFaltantesEmisor(completo)).toEqual([]);
  });
  it("producción incompleta: dice qué falta (vacío, null, undefined o solo espacios)", () => {
    expect(datosFaltantesEmisor({ ambiente: "produccion", domicilio: "176 5812", ingresos_brutos: null, inicio_actividades: null })).toEqual(["Ingresos Brutos", "inicio de actividades"]);
    expect(datosFaltantesEmisor({ ambiente: "produccion" })).toEqual(["domicilio", "Ingresos Brutos", "inicio de actividades"]);
    expect(datosFaltantesEmisor({ ...completo, ingresos_brutos: "   " })).toEqual(["Ingresos Brutos"]);
  });
  it("homologación (pruebas): no se exige nada", () => {
    expect(datosFaltantesEmisor({ ambiente: "homologacion", domicilio: null, ingresos_brutos: null, inicio_actividades: null })).toEqual([]);
  });
});

describe("cliente exento de IVA (se detecta solo por el CUIT)", () => {
  it("la Universidad Nacional de Misiones sale como Factura B exento, sin que nadie lo marque", () => {
    expect(normalizarReceptor("30-59821809-5", "B").receptor).toEqual({ docTipo: 80, docNro: "30598218095", condicionIva: 4 });
  });
  it("un CUIT común sigue siendo Consumidor Final", () => {
    expect(normalizarReceptor("30546689979", "B").receptor).toMatchObject({ docTipo: 80, condicionIva: 5 });
  });
  it("con Factura A no se aplica (A es para Responsables Inscriptos)", () => {
    expect(normalizarReceptor("30598218095", "A").receptor?.condicionIva).toBe(1);
  });
  it("la opción exento explícita exige un CUIT válido", () => {
    expect(normalizarReceptor("12345678", "B", true).error).toMatch(/CUIT/);
  });
});
