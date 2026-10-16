import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import {
  parsearMontoAR, parsearCsv, leerCsvPedidos, leerExcelEstadoCuenta, completarConExcel, cerrarLiquidacion, cruzarConVentas,
  calcularPlazoCobro, sumarDiasHabiles, validarPedidos, validarEstadoCuenta, validarResumenExcel, resumirExcel, esPedidoEnEfectivo,
  type Celda, type EstadoCuentaPeya, type HojaExcel, type PedidoPeya, type VentaSistema,
} from "@/lib/tesoreria/peya";

// Semana 05/10–11/10/2026 de la tienda 626966 «Angiru Enminutas»: archivos reales bajados del Portal de PedidosYa.
const FIXTURES = resolve(__dirname, "../fixtures/peya");
const csvTexto = () => readFileSync(resolve(FIXTURES, "orderDetails.csv"), "utf8");

// El «.xls» es un .xlsx por dentro: se abre por contenido. En la aplicación lo abre el navegador; acá, el mismo paquete en Node.
async function hojasDelExcel(): Promise<HojaExcel[]> {
  const req = createRequire(import.meta.url);
  const ExcelJS = req("exceljs/dist/exceljs.min.js");
  const buf = readFileSync(resolve(FIXTURES, "estado-de-cuenta_428019.xls"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const hojas: HojaExcel[] = [];
  wb.eachSheet((ws: { name: string; eachRow: (o: object, f: (r: { values: unknown[] }) => void) => void }) => {
    const filas: Celda[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => filas.push((r.values as Celda[]).slice(1)));
    hojas.push({ nombre: ws.name, filas });
  });
  return hojas;
}

const ESTADO_EJEMPLO: EstadoCuentaPeya = {
  periodo_desde: "2026-10-05", periodo_hasta: "2026-10-11", total_liquidado: 3724304,
  publicidad: -1112155, iva_comisiones: -881461, retenciones_sirtac: -366800, reintegros: 0, ajustes: 0, saldo_anterior: 0,
  fecha_pago_procesado: "2026-10-23", cuenta_destino: "PSP PEYA terminada en 8313", ajustes_nota: null,
};

describe("parsearMontoAR (formato argentino, en centavos)", () => {
  it("lee miles con punto y decimales con coma", () => {
    expect(parsearMontoAR("10.000,00")).toBe(1000000);
    expect(parsearMontoAR("-4.870,25")).toBe(-487025);
    expect(parsearMontoAR("2.820,50")).toBe(282050);
    expect(parsearMontoAR("0,00")).toBe(0);
    expect(parsearMontoAR("1.234.567,8")).toBe(123456780);
    expect(parsearMontoAR("ARS -24.007,30")).toBe(-2400730);
  });
  it("vacío es cero y lo que no es un importe es null (no cero)", () => {
    expect(parsearMontoAR("")).toBe(0);
    expect(parsearMontoAR(null)).toBe(0);
    expect(parsearMontoAR("abc")).toBeNull();
    expect(parsearMontoAR("1,2,3")).toBeNull();
    expect(parsearMontoAR("12.34")).toBeNull();      // ambiguo: no se adivina
    expect(parsearMontoAR("1.000,123")).toBeNull();
  });
  it("un número ya numérico se redondea a centavos sin errores de float", () => {
    expect(parsearMontoAR(448.93)).toBe(44893);
    expect(parsearMontoAR(0.1 + 0.2)).toBe(30);
    expect(parsearMontoAR(Number.NaN)).toBeNull();
  });
});

describe("parsearCsv", () => {
  it("respeta comillas, comillas escapadas, comas dentro de comillas, BOM y CRLF", () => {
    const f = parsearCsv('﻿a,b,c\r\n"x,y","dijo ""hola""",3\r\n');
    expect(f).toEqual([["a", "b", "c"], ["x,y", 'dijo "hola"', "3"]]);
  });
  it("un salto de línea dentro de comillas no corta la fila", () => {
    expect(parsearCsv('a,b\n"1\n2",3')).toEqual([["a", "b"], ["1\n2", "3"]]);
  });
});

describe("leerCsvPedidos con el CSV real de la semana", () => {
  const l = leerCsvPedidos(csvTexto());

  it("lee los 11 pedidos sin errores: 10 entregados y 1 cancelado", () => {
    expect(l.errores).toEqual([]);
    expect(l.pedidos).toHaveLength(11);
    expect(l.pedidos.filter((p) => p.estado === "entregado")).toHaveLength(10);
    expect(l.pedidos.filter((p) => p.estado === "cancelado")).toHaveLength(1);
  });

  it("el pedido cancelado trae ingreso estimado negativo, importe de pago 0 y su fecha es la de cancelación", () => {
    const c = l.pedidos.find((p) => p.nro_pedido === "2316989676")!;
    expect(c).toMatchObject({ estado: "cancelado", ingreso_estimado: -487025, importe_pago: 0, gastos_operativos: 402500, impuesto: 84525, monto_adeudado: 487025 });
    expect(c.fecha_pedido).toBeNull();
    expect(c.cancelado_en).toBe("2026-10-08T08:42:00-03:00");
    expect(c.motivo_rechazo).toBe("Inalcanzable");
  });

  it("«Descuento financiado por usted» se guarda como cargo Plus", () => {
    const p = l.pedidos.find((x) => x.nro_pedido === "2313299352")!;
    expect(p.cargo_plus).toBe(44893);
    expect(p).toMatchObject({ total_parcial: 1000000, comision: 230000, comision_pago_linea: 32000, impuesto: 64448, ingreso_estimado: 628659, tienda_id: "626966" });
    expect(p.fecha_pedido).toBe("2026-10-05T07:49:00-03:00");
  });

  it("los totales de la semana son los del estado de cuenta", () => {
    const entregados = l.pedidos.filter((p) => p.estado === "entregado");
    const suma = (f: (p: PedidoPeya) => number) => entregados.reduce((s, p) => s + f(p), 0);
    expect(suma((p) => p.total_parcial)).toBe(9170000);
    expect(suma((p) => p.comision)).toBe(2109100);
    expect(suma((p) => p.cargo_plus)).toBe(282050);
    expect(suma((p) => p.comision_pago_linea)).toBe(291630);
  });

  it("falta una columna: error claro que la nombra", () => {
    const sinComision = csvTexto().replace("Ingreso estimado", "Otra cosa");
    const r = leerCsvPedidos(sinComision);
    expect(r.pedidos).toEqual([]);
    expect(r.errores[0]).toMatch(/«Ingreso estimado»/);
  });

  it("un importe mal formateado es un error de esa fila y no se convierte en cero", () => {
    const roto = csvTexto().replace('"10.000,00"', '"10.0x0,00"');
    const r = leerCsvPedidos(roto);
    expect(r.errores.join(" ")).toMatch(/2313299352/);
    expect(r.pedidos.some((p) => p.nro_pedido === "2313299352")).toBe(false);
    expect(r.pedidos).toHaveLength(10);
  });

  it("un archivo que no es el CSV de PedidosYa se rechaza", () => {
    expect(leerCsvPedidos("a,b\n1,2").errores[0]).toMatch(/No parece el CSV/);
    expect(leerCsvPedidos("").errores).toHaveLength(1);
  });

  it("un pedido repetido en el archivo se toma una sola vez (idempotencia)", () => {
    const lineas = csvTexto().trimEnd().split("\n");
    const duplicado = [...lineas, lineas[1]].join("\n");
    const r = leerCsvPedidos(duplicado);
    expect(r.pedidos).toHaveLength(11);
    expect(r.advertencias.join(" ")).toMatch(/repetido/);
  });
});

describe("leerExcelEstadoCuenta con el Excel real (.xls que es .xlsx)", () => {
  it("lee los 10 pedidos entregados y la cancelación, con los totales del estado de cuenta", async () => {
    const x = leerExcelEstadoCuenta(await hojasDelExcel());
    expect(x.errores).toEqual([]);
    expect(x.pedidos).toHaveLength(10);
    expect(x.totales).toEqual({ venta_neta: 9170000, servicio: 2109100, plus: 282050, cancelaciones: 402500 });
    expect(x.cancelaciones).toEqual([expect.objectContaining({ nro_pedido: "2316989676", monto_final: -402500, comision: 402500 })]);
    expect(x.pedidos[0]).toMatchObject({ nro_pedido: "2313299352", fecha: "2026-10-05", servicio_pct: "23.00%", cobrado_por: "PedidosYa", metodo_pago: "Pago en la aplicación" });
  });

  it("sin la hoja «Lista de Pedidos» no es el estado de cuenta", () => {
    expect(leerExcelEstadoCuenta([{ nombre: "Otra", filas: [["a"]] }]).errores[0]).toMatch(/Lista de Pedidos/);
  });

  it("completa el método de pago y quién cobró en los pedidos del CSV", async () => {
    const x = leerExcelEstadoCuenta(await hojasDelExcel());
    const completos = completarConExcel(leerCsvPedidos(csvTexto()).pedidos, x);
    expect(completos.find((p) => p.nro_pedido === "2313299352")).toMatchObject({ cobrado_por: "PedidosYa", metodo_pago: "Pago en la aplicación" });
  });
});

describe("cerrarLiquidacion: la cuenta tiene que cerrar a $0,00", () => {
  const pedidos = () => leerCsvPedidos(csvTexto()).pedidos;

  it("con el estado de cuenta de la semana: neto calculado = Total liquidado = $37.243,04, diferencia 0", async () => {
    const excel = leerExcelEstadoCuenta(await hojasDelExcel());
    const r = cerrarLiquidacion(pedidos(), excel, ESTADO_EJEMPLO);
    expect(r).toMatchObject({
      entregados: 10, cancelados: 1, ventas_netas: 9170000, servicio_ventas: 2109100, servicio_linea: 291630, cargo_plus: 282050,
      cargos_cancelacion: 487025, ingreso_estimado: 5436810, neto_calculado: 3724304, diferencia: 0, cierra: true, hayErrores: false,
    });
    expect(r.iva_publicidad).toBe(-233551);                  // 8.814,61 − 6.479,10: sale de los archivos, no de un 21 % fijo
    expect(r.informativo.servicio_pct).toBeCloseTo(23, 5);   // dato informativo, no regla
    expect(r.informativo.iva_publicidad_pct).toBeCloseTo(21, 1);
    expect(r.verificaciones.every((v) => v.ok)).toBe(true);
  });

  it("si el Total liquidado no coincide NO cierra y muestra la diferencia", () => {
    const r = cerrarLiquidacion(pedidos(), null, { ...ESTADO_EJEMPLO, total_liquidado: 3724304 + 1000 });
    expect(r.cierra).toBe(false);
    expect(r.diferencia).toBe(-1000);
    expect(r.verificaciones.find((v) => v.id === "neto")).toMatchObject({ ok: false, esperado: 3725304, obtenido: 3724304 });
  });

  it("si falta una retención no cierra: la diferencia es justo lo que falta", () => {
    const r = cerrarLiquidacion(pedidos(), null, { ...ESTADO_EJEMPLO, retenciones_sirtac: 0 });
    expect(r.cierra).toBe(false);
    expect(r.diferencia).toBe(366800);
  });

  it("sin estado de cuenta (liquidación estimada) no hay cierre pero se calcula el ingreso estimado", () => {
    const r = cerrarLiquidacion(pedidos(), null, null);
    expect(r.cierra).toBe(false);
    expect(r.neto_calculado).toBeNull();
    expect(r.ingreso_estimado).toBe(5436810);
  });

  it("si el CSV y el Excel no traen los mismos pedidos o las mismas ventas, lo marca en rojo y no cierra", async () => {
    const excel = leerExcelEstadoCuenta(await hojasDelExcel());
    const sinUno = pedidos().filter((p) => p.nro_pedido !== "2316119662");
    const r = cerrarLiquidacion(sinUno, excel, null);
    expect(r.hayErrores).toBe(true);
    expect(r.verificaciones.find((v) => v.id === "pedidos")?.detalle).toMatch(/solo en el Excel: 2316119662/);
    expect(r.verificaciones.find((v) => v.id === "ventas")?.ok).toBe(false);
  });

  it("con los datos que viajan al servidor (solo totales y números) da el mismo resultado", async () => {
    const excel = leerExcelEstadoCuenta(await hojasDelExcel());
    const validado = validarResumenExcel(JSON.parse(JSON.stringify(resumirExcel(excel))));
    expect("valor" in validado).toBe(true);
    const r = cerrarLiquidacion(pedidos(), (validado as { valor: typeof excel }).valor, ESTADO_EJEMPLO);
    expect(r.cierra).toBe(true);
  });

  it("reintegros y ajustes se suman con el signo del estado de cuenta (sin reglas inventadas)", () => {
    const r = cerrarLiquidacion(pedidos(), null, { ...ESTADO_EJEMPLO, reintegros: 50000, ajustes: -20000, saldo_anterior: -10000, total_liquidado: 3724304 + 20000 });
    expect(r.diferencia).toBe(0);
    expect(r.cierra).toBe(true);
  });
});

describe("fechas de cobro", () => {
  it("la acreditación llega hasta 72 hs hábiles después de la fecha de pago", () => {
    expect(sumarDiasHabiles("2026-10-23", 3)).toBe("2026-10-28");   // viernes → miércoles
    expect(sumarDiasHabiles("2026-10-21", 3)).toBe("2026-10-26");   // miércoles → lunes
  });

  it("con el estado de cuenta, la fecha de pago es la que informa PedidosYa (12 días tras cerrar el período)", () => {
    const p = calcularPlazoCobro({ periodo_hasta: "2026-10-11", fecha_pago_procesado: "2026-10-23", anterior: null });
    expect(p).toMatchObject({ fecha_pago_procesado: "2026-10-23", plazo_dias: 12, confirmado: true, alerta: null, fecha_acreditacion_hasta: "2026-10-28" });
  });

  it("sin estado de cuenta se estima con el plazo de la última liquidación y se marca como estimado", () => {
    const p = calcularPlazoCobro({ periodo_hasta: "2026-10-18", fecha_pago_procesado: null, anterior: { periodo_hasta: "2026-10-11", fecha_pago_procesado: "2026-10-23" } });
    expect(p).toMatchObject({ fecha_pago_estimada: "2026-10-30", confirmado: false, fecha_pago_procesado: null });
  });

  it("sin ninguna liquidación anterior no inventa una fecha", () => {
    expect(calcularPlazoCobro({ periodo_hasta: "2026-10-11", fecha_pago_procesado: null, anterior: null }).fecha_pago_estimada).toBeNull();
  });

  it("avisa cuando cambió el plazo de cobro", () => {
    const p = calcularPlazoCobro({ periodo_hasta: "2026-10-18", fecha_pago_procesado: "2026-10-27", anterior: { periodo_hasta: "2026-10-11", fecha_pago_procesado: "2026-10-23" } });
    expect(p.alerta).toMatch(/Cambió el plazo de cobro: ahora 9 días .* 12/);
  });
});

describe("cruzarConVentas: cruce por día, importe y hora (el sistema no guarda el nº de pedido)", () => {
  // Ventas «Pedido Ya Plataforma» del Parque en la semana de ejemplo, como están en el sistema (hora de carga, importe = suma de productos).
  const venta = (id: string, cuando: string, total: number, canal = "pedido_ya_plataforma"): VentaSistema => ({ id, creado_en: `${cuando}-03:00`, total, canal });
  const VENTAS: VentaSistema[] = [
    venta("v1", "2026-10-05T10:13:00", 1000000), venta("v2", "2026-10-06T18:36:00", 1120000), venta("v3", "2026-10-07T13:45:00", 1200000),
    venta("v4", "2026-10-07T20:55:00", 900000), venta("v5", "2026-10-09T13:57:00", 770000), venta("v6", "2026-10-09T13:58:00", 1020000),
    venta("v7", "2026-10-09T18:57:00", 850000), venta("v8", "2026-10-09T20:31:00", 1190000), venta("v9", "2026-10-11T20:30:00", 780000),
  ];

  it("la semana de ejemplo: 9 pedidos cruzan y el de $3.400 «2 Facturas» no tiene venta en el sistema", () => {
    const r = cruzarConVentas(leerCsvPedidos(csvTexto()).pedidos, VENTAS);
    const estado = (nro: string) => r.filas.find((f) => f.nro_pedido === nro)!;
    expect(r.filas.filter((f) => f.estado === "conciliado")).toHaveLength(9);
    expect(estado("2316119662")).toMatchObject({ estado: "sin_venta", movimiento_id: null });
    expect(estado("2316989676")).toMatchObject({ estado: "no_aplica" });          // el cancelado no tiene venta
    expect(estado("2313299352")).toMatchObject({ estado: "conciliado", movimiento_id: "v1", diferencia: 0 });
    expect(estado("2321589168")).toMatchObject({ estado: "conciliado", movimiento_id: "v9" });
    expect(r.ventasSinPeya).toEqual([]);
  });

  it("la venta que cargó el kiosco una hora y media después igual cruza", () => {
    const pedido = leerCsvPedidos(csvTexto()).pedidos.find((p) => p.nro_pedido === "2315952450")!;   // PedidosYa 13:03, sistema 13:45
    expect(cruzarConVentas([pedido], VENTAS).filas[0].estado).toBe("conciliado");
  });

  it("dos pedidos del mismo importe el mismo día: cada venta se usa una sola vez, la más cercana a cada uno", () => {
    const base = leerCsvPedidos(csvTexto()).pedidos.find((p) => p.nro_pedido === "2313299352")!;
    const a: PedidoPeya = { ...base, nro_pedido: "1000001", fecha_pedido: "2026-10-05T10:00:00-03:00", total_parcial: 500000 };
    const b: PedidoPeya = { ...base, nro_pedido: "1000002", fecha_pedido: "2026-10-05T16:00:00-03:00", total_parcial: 500000 };
    const r = cruzarConVentas([a, b], [venta("tarde", "2026-10-05T16:10:00", 500000), venta("temprano", "2026-10-05T10:05:00", 500000)]);
    expect(r.filas.find((f) => f.nro_pedido === "1000001")?.movimiento_id).toBe("temprano");
    expect(r.filas.find((f) => f.nro_pedido === "1000002")?.movimiento_id).toBe("tarde");
  });

  it("si hay un solo pedido y dos ventas iguales, una queda como «venta sin PedidosYa»", () => {
    const base = leerCsvPedidos(csvTexto()).pedidos.find((p) => p.nro_pedido === "2313299352")!;
    const r = cruzarConVentas([{ ...base, total_parcial: 500000 }], [venta("a", "2026-10-05T08:00:00", 500000), venta("b", "2026-10-05T09:00:00", 500000)]);
    expect(r.filas[0]).toMatchObject({ estado: "conciliado", movimiento_id: "a" });
    expect(r.ventasSinPeya.map((v) => v.id)).toEqual(["b"]);
  });

  it("una venta cercana en el tiempo pero de otro importe queda «importe distinto» con la diferencia", () => {
    const base = leerCsvPedidos(csvTexto()).pedidos.find((p) => p.nro_pedido === "2313299352")!;      // $10.000 a las 07:49
    const r = cruzarConVentas([base], [venta("x", "2026-10-05T08:30:00", 1050000)]);
    expect(r.filas[0]).toMatchObject({ estado: "importe_distinto", movimiento_id: "x", diferencia: -50000 });
  });

  it("los pedidos en efectivo quedan «pendiente de validar»: no se asume la regla contable", () => {
    const base = leerCsvPedidos(csvTexto()).pedidos.find((p) => p.nro_pedido === "2313299352")!;
    const efectivo: PedidoPeya = { ...base, forma_pago: "Efectivo", efectivo_cobrado: 1000000, monto_adeudado: 230000 };   // SUPUESTO: no hay un archivo real con efectivo
    expect(esPedidoEnEfectivo(efectivo)).toBe(true);
    expect(esPedidoEnEfectivo(base)).toBe(false);
    const r = cruzarConVentas([efectivo], [venta("e", "2026-10-05T08:00:00", 1000000, "pedido_ya_efectivo")]);
    expect(r.filas[0]).toMatchObject({ estado: "efectivo_pendiente", movimiento_id: "e" });
  });
});

describe("validación en el servidor (nada de lo que manda el navegador se confía)", () => {
  const pedidos = () => leerCsvPedidos(csvTexto()).pedidos;

  it("acepta lo que produce la lectura", () => {
    expect("valor" in validarPedidos(JSON.parse(JSON.stringify(pedidos())))).toBe(true);
    expect("valor" in validarEstadoCuenta(ESTADO_EJEMPLO)).toBe(true);
  });
  it("rechaza importes con decimales, pedidos repetidos, números raros y listas vacías", () => {
    const [p] = pedidos();
    expect(validarPedidos([])).toHaveProperty("error");
    expect(validarPedidos([{ ...p, total_parcial: 100.5 }])).toHaveProperty("error");
    expect(validarPedidos([p, p])).toHaveProperty("error");
    expect(validarPedidos([{ ...p, nro_pedido: "12; drop" }])).toHaveProperty("error");
    expect(validarPedidos([{ ...p, articulos: "x".repeat(600) }])).toHaveProperty("error");
  });
  it("rechaza un estado de cuenta con período al revés, fecha inválida o importes no enteros", () => {
    expect(validarEstadoCuenta({ ...ESTADO_EJEMPLO, periodo_hasta: "2026-10-01" })).toHaveProperty("error");
    expect(validarEstadoCuenta({ ...ESTADO_EJEMPLO, fecha_pago_procesado: "2026-02-30" })).toHaveProperty("error");
    expect(validarEstadoCuenta({ ...ESTADO_EJEMPLO, total_liquidado: 10.5 })).toHaveProperty("error");
    expect(validarEstadoCuenta(null)).toHaveProperty("error");
  });
});
