import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validarEgreso, validarPago } from "@/lib/tesoreria/validaciones";
import { agruparDeuda, diferenciaConKiosco, efectivoDeTesoreria, montoSobre, obligacionesDelMes, rangoDelMes, mesAnteriorYSiguiente, resumirEgresos, tengoMenosDebo, type FijoParaObligaciones } from "@/lib/tesoreria/calculos";
import type { EgresoEntrada } from "@/lib/tesoreria/tipos";

const HOY = "2026-10-05";

const base: EgresoEntrada = {
  fecha: "2026-10-04", monto: 29600, sucursal_id: null, categoria: "mercaderia", proveedor_id: null,
  descripcion: "Lo de Mario - fiambre", comprobante: "sin", comprobante_numero: null, comprobante_path: null,
  pagado: true, origen: "efectivo_tesoreria", gasto_fijo_id: null, nota: null, retiros_caja_ids: [], entregas_ids: [],
};

describe("validarEgreso", () => {
  it("acepta un egreso sin factura (el gasto se registra igual)", () => {
    const r = validarEgreso(base, HOY);
    expect("valor" in r && r.valor.comprobante).toBe("sin");
  });

  it("guarda el número de remito o de factura, con o sin factura (se lleva cada compra por su remito)", () => {
    const con = validarEgreso({ ...base, comprobante: "con", comprobante_numero: " 0005-00019355 " }, HOY);
    expect("valor" in con && con.valor.comprobante_numero).toBe("0005-00019355");
    const sin = validarEgreso({ ...base, comprobante: "sin", comprobante_numero: " 2264 " }, HOY);
    expect("valor" in sin && [sin.valor.comprobante, sin.valor.comprobante_numero]).toEqual(["sin", "2264"]);
    const sinNumero = validarEgreso({ ...base, comprobante: "sin", comprobante_numero: "  " }, HOY);
    expect("valor" in sinNumero && sinNumero.valor.comprobante_numero).toBeNull();
  });

  it("la migración 110 saca el CHECK que impedía guardar el número en compras sin factura", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/110_numero_de_remito_sin_factura.sql"), "utf8");
    expect(sql).toMatch(/drop constraint if exists egresos_numero_solo_con_comprobante/);
  });

  it("redondea el monto a centavos", () => {
    const r = validarEgreso({ ...base, monto: 100.005 }, HOY);
    expect("valor" in r && r.valor.monto).toBe(100.01);
  });

  it.each([0, -5, NaN, Infinity, 2_000_000_000])("rechaza el monto %s", (monto) => {
    expect("error" in validarEgreso({ ...base, monto }, HOY)).toBe(true);
  });

  it("rechaza fechas futuras, inexistentes o mal escritas", () => {
    expect("error" in validarEgreso({ ...base, fecha: "2026-10-06" }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, fecha: "2026-02-30" }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, fecha: "05/10/2026" }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, fecha: HOY }, HOY)).toBe(false);
  });

  it("rechaza categoría, comprobante u origen que no están en la lista", () => {
    expect("error" in validarEgreso({ ...base, categoria: "regalo" }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, comprobante: "tal-vez" }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, origen: "cheque" }, HOY)).toBe(true);
  });

  it("exige descripción y limita el largo", () => {
    expect("error" in validarEgreso({ ...base, descripcion: "   " }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, descripcion: "x".repeat(201) }, HOY)).toBe(true);
  });

  it("solo acepta la ruta con la forma que genera el servidor (mes/uuid.extensión)", () => {
    const uuid = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";
    for (const mala of ["../remitos/x.jpg", "a b;c.jpg", "2026-10/abc123.webp", `2026-10/${uuid}.exe`, `../2026-10/${uuid}.jpg`, `2026-10/otra/${uuid}.jpg`]) {
      expect("error" in validarEgreso({ ...base, comprobante_path: mala }, HOY), mala).toBe(true);
    }
    for (const buena of [`2026-10/${uuid}.webp`, `2026-10/${uuid}.pdf`, `2026-10/${uuid}.jpg`, `2026-10/${uuid}.png`]) {
      expect("error" in validarEgreso({ ...base, comprobante_path: buena }, HOY), buena).toBe(false);
    }
  });

  it("un retiro de caja solo se registra con origen 'retiro_caja', y ese origen exige un retiro", () => {
    expect("error" in validarEgreso({ ...base, origen: "efectivo_tesoreria", retiros_caja_ids: ["r1"] }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, origen: "retiro_caja", retiros_caja_ids: [] }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, origen: "retiro_caja", retiros_caja_ids: ["r1"] }, HOY)).toBe(false);
  });

  it("una compra pendiente no tiene origen ni fecha de pago; una pagada toma la fecha del egreso", () => {
    const pend = validarEgreso({ ...base, pagado: false, origen: "transferencia" }, HOY);
    expect("valor" in pend && [pend.valor.pagado, pend.valor.origen, pend.valor.fecha_pago]).toEqual([false, null, null]);
    const pag = validarEgreso(base, HOY);
    expect("valor" in pag && [pag.valor.pagado, pag.valor.origen, pag.valor.fecha_pago]).toEqual([true, "efectivo_tesoreria", "2026-10-04"]);
  });

  it("una compra pagada exige origen; 'pagado' tiene que ser verdadero o falso", () => {
    expect("error" in validarEgreso({ ...base, origen: null }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, pagado: undefined as unknown as boolean }, HOY)).toBe(true);
  });

  it("un retiro de caja no puede quedar pendiente", () => {
    expect("error" in validarEgreso({ ...base, pagado: false, origen: null, retiros_caja_ids: ["r1"] }, HOY)).toBe(true);
  });

  it("quita ids repetidos y rechaza listas enormes o con valores inválidos", () => {
    const r = validarEgreso({ ...base, entregas_ids: ["a", "a", "b"] }, HOY);
    expect("valor" in r && r.valor.entregas_ids).toEqual(["a", "b"]);
    expect("error" in validarEgreso({ ...base, entregas_ids: Array.from({ length: 51 }, (_, i) => `id${i}`) }, HOY)).toBe(true);
    expect("error" in validarEgreso({ ...base, entregas_ids: [""] }, HOY)).toBe(true);
  });
});

describe("validarEgreso: compras de un proveedor de la lista", () => {
  const conProveedor: EgresoEntrada = { ...base, proveedor_id: "p1", sucursal_id: "s1", pagado: false, origen: null };

  it("la compra con proveedor, «se debe» y con kiosco es válida", () => {
    const r = validarEgreso(conProveedor, HOY);
    expect("valor" in r && [r.valor.proveedor_id, r.valor.sucursal_id, r.valor.pagado, r.valor.origen, r.valor.fecha_pago]).toEqual(["p1", "s1", false, null, null]);
  });

  it("con proveedor no se puede marcar «ya se pagó» (se pagaría dos veces): el pago va por Proveedores", () => {
    const r = validarEgreso({ ...conProveedor, pagado: true, origen: "efectivo_tesoreria" }, HOY);
    expect(r).toEqual({ error: expect.stringContaining("Proveedores") });
  });

  it("con proveedor hace falta el kiosco", () => {
    expect("error" in validarEgreso({ ...conProveedor, sucursal_id: null }, HOY)).toBe(true);
  });

  it("un retiro de caja con proveedor no es un egreso: es un pago a la cuenta", () => {
    const r = validarEgreso({ ...conProveedor, pagado: true, origen: "retiro_caja", retiros_caja_ids: ["r1"] }, HOY);
    expect(r).toEqual({ error: expect.stringContaining("pago a la cuenta") });
  });

  it("sin proveedor todo sigue igual: «ya se pagó» y kiosco «General» valen", () => {
    expect("valor" in validarEgreso({ ...base, proveedor_id: null, sucursal_id: null, pagado: true, origen: "efectivo_tesoreria" }, HOY)).toBe(true);
    expect("valor" in validarEgreso({ ...base, proveedor_id: null, sucursal_id: "s1", pagado: false, origen: null }, HOY)).toBe(true);
    expect("valor" in validarEgreso({ ...base, proveedor_id: null, origen: "retiro_caja", retiros_caja_ids: ["r1"] }, HOY)).toBe(true);
  });
});

describe("validarPago", () => {
  it("acepta transferencia, Mercado Pago y efectivo de Tesorería", () => {
    for (const origen of ["transferencia", "mercadopago", "efectivo_tesoreria"]) {
      expect("valor" in validarPago({ origen, fecha_pago: HOY }, HOY)).toBe(true);
    }
  });
  it("no acepta 'retiro de caja' (solo se da al registrar el retiro), ni fechas futuras o inválidas", () => {
    expect("error" in validarPago({ origen: "retiro_caja", fecha_pago: HOY }, HOY)).toBe(true);
    expect("error" in validarPago({ origen: "transferencia", fecha_pago: "2026-10-06" }, HOY)).toBe(true);
    expect("error" in validarPago({ origen: "transferencia", fecha_pago: "ayer" }, HOY)).toBe(true);
  });
});

describe("diferenciaConKiosco", () => {
  it("compara la factura real con lo que cargó el kiosco", () => {
    expect(diferenciaConKiosco(140000, 123679)).toBe(16321);
    expect(diferenciaConKiosco(100000, 123679)).toBe(-23679);
    expect(diferenciaConKiosco(123679, 123679)).toBe(0);
  });
  it("si el kiosco no cargó importes no hay con qué comparar", () => {
    expect(diferenciaConKiosco(140000, 0)).toBeNull();
    expect(diferenciaConKiosco(NaN, 1000)).toBeNull();
  });
});

describe("agruparDeuda", () => {
  it("junta por proveedor, o por el texto escrito si no tiene proveedor de la lista", () => {
    const nombres = new Map([["p1", "Panadería Petri"]]);
    const r = agruparDeuda([
      { proveedor_id: "p1", descripcion: "x", monto: 1000 },
      { proveedor_id: "p1", descripcion: "y", monto: 500.5 },
      { proveedor_id: null, descripcion: "Lo de Mario", monto: 3000 },
      { proveedor_id: null, descripcion: " lo de mario ", monto: 200 },
    ], nombres);
    expect(r.total).toBe(4700.5);
    expect(r.items.map((d) => [d.nombre, d.monto, d.cantidad])).toEqual([["Lo de Mario", 3200, 2], ["Panadería Petri", 1500.5, 2]]);
  });
  it("sin pendientes no debe nada", () => {
    expect(agruparDeuda([], new Map())).toEqual({ items: [], total: 0 });
  });
});

describe("resumirEgresos", () => {
  it("no mezcla los retiros de socios con el gasto operativo", () => {
    const r = resumirEgresos([
      { categoria: "mercaderia",   monto: 1000, comprobante: "con" },
      { categoria: "mercaderia",   monto: 500,  comprobante: "sin" },
      { categoria: "alquiler",     monto: 2000, comprobante: "con" },
      { categoria: "retiro_socio", monto: 9999, comprobante: "sin" },
    ]);
    expect(r.operativos).toBe(3500);
    expect(r.retirosSocio).toBe(9999);
    expect(r.conFactura).toBe(3000);
    expect(r.sinFactura).toBe(500);
    expect(r.porCategoria).toEqual([{ categoria: "alquiler", monto: 2000 }, { categoria: "mercaderia", monto: 1500 }]);
  });

  it("sin egresos da todo en cero", () => {
    expect(resumirEgresos([])).toEqual({ operativos: 0, retirosSocio: 0, conFactura: 0, sinFactura: 0, porCategoria: [] });
  });
});

describe("efectivo de Tesorería", () => {
  it("el sobre vale lo verificado si existe; si no, declarado menos fondo (nunca negativo)", () => {
    expect(montoSobre({ efectivo_declarado: 100000, fondo_siguiente: 20000, sobre_monto_verificado: null })).toBe(80000);
    expect(montoSobre({ efectivo_declarado: 100000, fondo_siguiente: 20000, sobre_monto_verificado: 79500 })).toBe(79500);
    expect(montoSobre({ efectivo_declarado: 10000, fondo_siguiente: 30000, sobre_monto_verificado: null })).toBe(0);
    expect(montoSobre({ efectivo_declarado: 10000, fondo_siguiente: null, sobre_monto_verificado: null })).toBe(0);
  });

  it("suma sobres y resta solo lo pagado en efectivo de Tesorería", () => {
    const r = efectivoDeTesoreria({
      efectivoInicial: 50000,
      sobresRecibidos: [
        { efectivo_declarado: 100000, fondo_siguiente: 20000, sobre_monto_verificado: null },   // 80000
        { efectivo_declarado: 60000,  fondo_siguiente: 20000, sobre_monto_verificado: 39000 },  // 39000
      ],
      egresos: [
        { origen: "efectivo_tesoreria", monto: 30000 },
        { origen: "retiro_caja",        monto: 29600 },   // salió del cajón del kiosco: no toca Tesorería
        { origen: "transferencia",      monto: 70000 },   // no es efectivo
        { origen: "mercadopago",        monto: 5000 },
      ],
    });
    expect(r).toEqual({ efectivo: 50000 + 119000 - 30000, sobres: 119000, salidas: 30000 });
  });
});

describe("meses", () => {
  it("da el primer y el último día, incluso en febrero bisiesto", () => {
    expect(rangoDelMes("2026-10")).toEqual({ desde: "2026-10-01", hasta: "2026-10-31" });
    expect(rangoDelMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });
  it("rechaza un mes mal escrito", () => {
    expect(rangoDelMes("2026-13")).toBeNull();
    expect(rangoDelMes("octubre")).toBeNull();
  });
  it("navega entre años", () => {
    expect(mesAnteriorYSiguiente("2026-01")).toEqual({ anterior: "2025-12", siguiente: "2026-02" });
    expect(mesAnteriorYSiguiente("2026-12")).toEqual({ anterior: "2026-11", siguiente: "2027-01" });
  });
});

describe("obligacionesDelMes", () => {
  const fijo = (o: Partial<FijoParaObligaciones> = {}): FijoParaObligaciones => ({
    id: "f1", categoria: "sueldos", descripcion: "Sueldo Iris", monto_estimado: 1000000, dia_vencimiento: 5, sucursal_id: null, ...o,
  });

  it("una obligación sin pago en el mes está sin registrar y suma a lo pendiente", () => {
    const r = obligacionesDelMes([fijo(), fijo({ id: "f2", descripcion: "Alquiler", monto_estimado: 500000, dia_vencimiento: 10 })], [], "2026-10", "2026-10-03");
    expect(r.pendiente).toBe(1500000);
    expect(r.sinRegistrar).toBe(2);
    expect(r.items.map((i) => [i.descripcion, i.vencimiento, i.vencida])).toEqual([["Sueldo Iris", "2026-10-05", false], ["Alquiler", "2026-10-10", false]]);
  });

  it("queda vencida cuando pasó el día y no se registró", () => {
    const r = obligacionesDelMes([fijo()], [], "2026-10", "2026-10-06");
    expect(r.items[0].vencida).toBe(true);
  });

  it("registrada deja de ser pendiente, y si se pagó en partes se suman (el estimado no es un tope)", () => {
    const r = obligacionesDelMes(
      [fijo()],
      [{ gasto_fijo_id: "f1", monto: 600000 }, { gasto_fijo_id: "f1", monto: 450000 }, { gasto_fijo_id: null, monto: 99999 }],
      "2026-10", "2026-10-20",
    );
    expect(r.items[0]).toMatchObject({ registrada: true, pagado: 1050000, pagos: 2, vencida: false });
    expect(r.pendiente).toBe(0);
    expect(r.registrado).toBe(1050000);
  });

  it("un vencimiento que no existe en el mes (día 31 en un mes de 30) cae en el último día", () => {
    const r = obligacionesDelMes([fijo({ dia_vencimiento: 31 })], [], "2026-11", "2026-11-01");
    expect(r.items[0].vencimiento).toBe("2026-11-30");
  });
});

describe("tengoMenosDebo", () => {
  it("efectivo menos proveedores menos obligaciones sin registrar; puede dar negativo", () => {
    expect(tengoMenosDebo({ efectivo: 3000000, deudaProveedores: 1000000, obligacionesPendientes: 1500000 })).toBe(500000);
    expect(tengoMenosDebo({ efectivo: 100000, deudaProveedores: 2630000, obligacionesPendientes: 4200000 })).toBe(-6730000);
  });
});

describe("migración 111 (retiro como pago a proveedor y remito único)", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/111_retiro_como_pago_proveedor.sql"), "utf8");

  it("el pago a proveedor admite el retiro de caja como origen", () => {
    expect(sql).toMatch(/proveedor_cuenta_origen_check[\s\S]*'retiro_caja'/);
  });

  it("un retiro se imputa a un gasto o a un pago, nunca a los dos", () => {
    expect(sql).toMatch(/retiros_caja_un_solo_destino[\s\S]*egreso_id is null or proveedor_cuenta_id is null/);
  });

  it("el remito (proveedor + kiosco + número) es único entre los egresos vigentes", () => {
    expect(sql).toMatch(/create unique index if not exists egresos_remito_unico/);
    expect(sql).toMatch(/where anulado_en is null and proveedor_id is not null and sucursal_id is not null and comprobante_numero is not null/);
  });
});