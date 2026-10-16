// Liquidaciones de PedidosYa (migración 108). Funciones puras: leen los archivos que baja una persona del Portal de PedidosYa,
// verifican que la cuenta cierre y cruzan los pedidos con las ventas del kiosco. No tocan la base.
//
// REGLAS DE ESTE ARCHIVO
//  * El dinero se calcula SIEMPRE en centavos enteros (nunca float). Los importes con formato argentino («1.234,56») se parsean
//    de forma explícita; lo que no se puede leer es un error, no un cero.
//  * Se usan solo las columnas que están en los archivos de ejemplo de la semana 05/10–11/10/2026 (tienda 626966). No se
//    inventan columnas ni reglas: el efectivo y los reintegros están marcados «pendiente de validar» hasta tener un ejemplo.
//  * Hipótesis que NO se fijan en el código: que la comisión sea 23 %, el IVA 21 % o SIRTAC 4 %. Se toman los montos de los
//    archivos; el porcentaje es solo un dato informativo.
//  * La verdad de lo que se cobra es el «Total liquidado» del estado de cuenta. Si el neto calculado no coincide, no se confirma.

// ── Dinero en centavos ───────────────────────────────────────────────────────
// «10.000,00» → 1000000 · «-4.870,25» → -487025 · «0,00» → 0 · vacío → 0. Devuelve null si no es un importe.
const MONTO_AR_RE = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/;

export function parsearMontoAR(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = v.trim().replace(/^ARS\s*/i, "").replace(/\s+/g, "");
  if (s === "") return 0;
  if (!MONTO_AR_RE.test(s)) return null;
  const negativo = s.startsWith("-");
  const [entera, dec = ""] = s.replace("-", "").replace(/\./g, "").split(",");
  const centavos = Number(entera) * 100 + Number(dec.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) ? (negativo ? -centavos : centavos) : null;
}

export const aPesos = (centavos: number): number => centavos / 100;
export const aCentavos = (pesos: number): number => Math.round(pesos * 100);

// ── CSV ──────────────────────────────────────────────────────────────────────
// Separador coma, campos entre comillas (con «""» como comilla escapada), saltos de línea dentro de comillas, UTF-8 con BOM.
export function parsearCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const filas: string[][] = [];
  let fila: string[] = [], celda = "", entre = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entre) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else entre = false; }
      else celda += c;
    } else if (c === '"') entre = true;
    else if (c === ",") { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      fila.push(celda); celda = "";
      if (fila.length > 1 || fila[0] !== "") filas.push(fila);
      fila = [];
    } else celda += c;
  }
  if (celda !== "" || fila.length > 0) { fila.push(celda); if (fila.length > 1 || fila[0] !== "") filas.push(fila); }
  return filas;
}

// «2026-10-05 07:49» (hora argentina, sin huso) → ISO con -03:00. null si vacío o ilegible.
export function fechaHoraPeya(v: string | null | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// AAAA-MM-DD en hora argentina de un instante ISO.
export function diaAR(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export interface PedidoPeya {
  nro_pedido:          string;
  tienda_id:           string;
  local_nombre:        string | null;
  estado:              string;          // «entregado», «cancelado»… en minúsculas, como lo dice el portal
  forma_pago:          string | null;
  fecha_pedido:        string | null;   // ISO -03:00 (un cancelado puede no traerla)
  entregado_en:        string | null;
  cancelado_en:        string | null;
  motivo_rechazo:      string | null;
  responsable_rechazo: string | null;
  // Importes en CENTAVOS
  total_parcial:       number;          // venta bruta
  impuesto:            number;
  comision_pago_linea: number;
  cargo_plus:          number;          // CSV: columna «Descuento financiado por usted» (en realidad es el cargo por pedidos con Plus)
  comision:            number;
  gastos_operativos:   number;          // en un cancelado, el cargo por cancelar
  ingreso_estimado:    number;          // neto del pedido (un cancelado va en negativo)
  importe_pago:        number;
  monto_adeudado:      number;
  efectivo_cobrado:    number;
  articulos:           string | null;
  // Del Excel (si se cargó)
  metodo_pago:         string | null;
  cobrado_por:         string | null;
}

// Nombres EXACTOS de las columnas del CSV de pedidos (Portal → Pedidos → «Descargar informe»).
const CSV = {
  local: "Nombre del local", nro: "Nro de pedido", tienda: "ID de tienda", forma: "Forma de pago", estado: "Estado del pedido",
  fecha: "Fecha del pedido", entregado: "Entregado el", cancelado: "Cancelado el", motivo: "Motivo de rechazo", resp: "Responsable del rechazo",
  total: "Total parcial", impuesto: "Impuesto", comPagoLinea: "Comisión por pago en línea",
  // OJO: esta columna se llama «Descuento financiado por usted» pero contiene el CARGO POR PEDIDOS CON PLUS (coincide pedido por
  // pedido con «Cargo por Pedidos con Plus» del Excel del estado de cuenta). Se guarda como cargo_plus.
  plus: "Descuento financiado por usted",
  comision: "Comisión", gastosOp: "Gastos operativos", ingreso: "Ingreso estimado", importePago: "Importe de pago",
  adeudado: "Monto adeudado a PedidosYa", efectivo: "Monto en efectivo ya cobrado por el local", articulos: "Artículos del pedido",
} as const;

const CSV_REQUERIDAS = [CSV.nro, CSV.tienda, CSV.estado, CSV.total, CSV.impuesto, CSV.comPagoLinea, CSV.plus, CSV.comision, CSV.ingreso] as const;

export interface LecturaPedidos { pedidos: PedidoPeya[]; errores: string[]; advertencias: string[] }

export function leerCsvPedidos(texto: string): LecturaPedidos {
  const filas = parsearCsv(texto);
  const salida: LecturaPedidos = { pedidos: [], errores: [], advertencias: [] };
  if (filas.length < 2) return { ...salida, errores: ["El CSV no tiene pedidos."] };

  const col = new Map<string, number>();
  filas[0].forEach((h, i) => { const n = h.trim(); if (!col.has(n)) col.set(n, i); });
  const faltan = CSV_REQUERIDAS.filter((c) => !col.has(c));
  if (faltan.length > 0) {
    return { ...salida, errores: [`No parece el CSV de pedidos de PedidosYa: faltan las columnas ${faltan.map((c) => `«${c}»`).join(", ")}.`] };
  }
  const celda = (f: string[], c: string) => (col.has(c) ? (f[col.get(c) as number] ?? "").trim() : "");
  const vistos = new Set<string>();

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const donde = `Fila ${i + 1}`;
    const nro = celda(f, CSV.nro);
    if (!nro) { salida.errores.push(`${donde}: sin número de pedido.`); continue; }
    if (!/^\d{4,20}$/.test(nro)) { salida.errores.push(`${donde}: número de pedido inválido («${nro.slice(0, 20)}»).`); continue; }
    const tienda = celda(f, CSV.tienda);
    if (!tienda) { salida.errores.push(`${donde} (pedido ${nro}): sin ID de tienda.`); continue; }
    if (vistos.has(`${tienda}|${nro}`)) { salida.advertencias.push(`El pedido ${nro} está repetido en el archivo: se toma una sola vez.`); continue; }
    vistos.add(`${tienda}|${nro}`);

    const monto = (c: string): number | null => parsearMontoAR(celda(f, c));
    const valores = {
      total_parcial: monto(CSV.total), impuesto: monto(CSV.impuesto), comision_pago_linea: monto(CSV.comPagoLinea), cargo_plus: monto(CSV.plus),
      comision: monto(CSV.comision), gastos_operativos: monto(CSV.gastosOp), ingreso_estimado: monto(CSV.ingreso),
      importe_pago: monto(CSV.importePago), monto_adeudado: monto(CSV.adeudado), efectivo_cobrado: monto(CSV.efectivo),
    };
    const malo = (Object.entries(valores).find(([, v]) => v === null)?.[0]) as string | undefined;
    if (malo) { salida.errores.push(`${donde} (pedido ${nro}): importe ilegible en «${malo.replace(/_/g, " ")}».`); continue; }

    const estado = celda(f, CSV.estado).toLowerCase();
    if (estado !== "entregado" && estado !== "cancelado") {
      salida.advertencias.push(`El pedido ${nro} tiene un estado que no conocía («${estado || "vacío"}»): se guarda tal cual y no suma como venta.`);
    }
    salida.pedidos.push({
      nro_pedido: nro, tienda_id: tienda, local_nombre: celda(f, CSV.local) || null, estado,
      forma_pago: celda(f, CSV.forma) || null,
      fecha_pedido: fechaHoraPeya(celda(f, CSV.fecha)), entregado_en: fechaHoraPeya(celda(f, CSV.entregado)), cancelado_en: fechaHoraPeya(celda(f, CSV.cancelado)),
      motivo_rechazo: celda(f, CSV.motivo) || null, responsable_rechazo: celda(f, CSV.resp) || null,
      ...(valores as Record<keyof typeof valores, number>),
      articulos: celda(f, CSV.articulos).slice(0, 500) || null,
      metodo_pago: null, cobrado_por: null,
    });
  }
  if (salida.pedidos.length === 0 && salida.errores.length === 0) salida.errores.push("El CSV no tiene pedidos.");
  return salida;
}

// ── Excel del estado de cuenta ───────────────────────────────────────────────
// El archivo se llama .xls pero es un .xlsx por dentro: quien lo abre (el navegador) lo detecta por contenido y entrega las hojas
// como grillas de celdas. Acá solo se interpretan.
export type Celda = string | number | boolean | Date | null | undefined;
export interface HojaExcel { nombre: string; filas: Celda[][] }

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function centavosDeCelda(v: Celda): number | null {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v === "string") {
    const t = v.trim();
    // El Excel guarda números como número; si llegara texto con coma decimal se parsea como importe argentino.
    return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : parsearMontoAR(t);
  }
  return null;
}
const textoDeCelda = (v: Celda): string => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v).trim());

export interface PedidoExcel {
  nro_pedido: string; sucursal: string; fecha: string | null;          // AAAA-MM-DD
  monto_bruto: number; venta_neta: number; servicio_pct: string | null; servicio_monto: number; cargo_plus: number;
  metodo_pago: string | null; cobrado_por: string | null; cobrado_por_local: number;
}
export interface CancelacionExcel { nro_pedido: string; motivo: string | null; monto_pedido: number; comision: number; monto_final: number }
export interface LecturaExcel {
  pedidos: PedidoExcel[]; cancelaciones: CancelacionExcel[]; errores: string[];
  totales: { venta_neta: number; servicio: number; plus: number; cancelaciones: number };   // centavos
}

function fechaDMA(v: Celda): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const m = textoDeCelda(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

function indicesDe(cabecera: Celda[], requeridas: string[]): { idx: Map<string, number>; faltan: string[] } {
  const idx = new Map<string, number>();
  cabecera.forEach((h, i) => { const n = sinAcentos(textoDeCelda(h)); if (n && !idx.has(n)) idx.set(n, i); });
  return { idx, faltan: requeridas.filter((r) => !idx.has(r)) };
}

export function leerExcelEstadoCuenta(hojas: HojaExcel[]): LecturaExcel {
  const vacio: LecturaExcel = { pedidos: [], cancelaciones: [], errores: [], totales: { venta_neta: 0, servicio: 0, plus: 0, cancelaciones: 0 } };
  const lista = hojas.find((h) => sinAcentos(h.nombre) === "lista de pedidos");
  if (!lista) return { ...vacio, errores: ["No parece el Excel del estado de cuenta de PedidosYa: falta la hoja «Lista de Pedidos»."] };

  const REQ = ["numero de pedido", "monto de venta neta ($)", "servicio ventas pedidoya ($)", "cargo por pedidos con plus"];
  const { idx, faltan } = indicesDe(lista.filas[0] ?? [], REQ);
  if (faltan.length > 0) return { ...vacio, errores: [`En «Lista de Pedidos» faltan las columnas: ${faltan.join(", ")}.`] };
  const g = (f: Celda[], n: string): Celda => (idx.has(n) ? f[idx.get(n) as number] : null);

  const salida: LecturaExcel = { ...vacio, pedidos: [], cancelaciones: [], errores: [] };
  for (let i = 1; i < lista.filas.length; i++) {
    const f = lista.filas[i];
    if (f.every((c) => c === null || c === undefined || c === "")) continue;
    const nro = textoDeCelda(g(f, "numero de pedido"));
    if (!nro) continue;
    const neta = centavosDeCelda(g(f, "monto de venta neta ($)")), servicio = centavosDeCelda(g(f, "servicio ventas pedidoya ($)"));
    const plus = centavosDeCelda(g(f, "cargo por pedidos con plus")), bruto = centavosDeCelda(g(f, "monto bruto de la venta"));
    const local = centavosDeCelda(g(f, "monto venta + envio cobrado por el local"));
    if (neta === null || servicio === null || plus === null || bruto === null || local === null) {
      salida.errores.push(`Excel, fila ${i + 1} (pedido ${nro}): importe ilegible.`);
      continue;
    }
    salida.pedidos.push({
      nro_pedido: nro, sucursal: textoDeCelda(g(f, "sucursal")), fecha: fechaDMA(g(f, "fecha de pedido")),
      monto_bruto: bruto, venta_neta: neta, servicio_pct: textoDeCelda(g(f, "servicio ventas pedidosya (%)")) || null, servicio_monto: servicio, cargo_plus: plus,
      metodo_pago: textoDeCelda(g(f, "metodo de pago")) || null, cobrado_por: textoDeCelda(g(f, "cobrado por")) || null, cobrado_por_local: local,
    });
    salida.totales.venta_neta += neta; salida.totales.servicio += servicio; salida.totales.plus += plus;
  }

  const hojaCanc = hojas.find((h) => sinAcentos(h.nombre) === "cargos por cancelaciones");
  if (hojaCanc && hojaCanc.filas.length > 1) {
    const { idx: ic, faltan: fc } = indicesDe(hojaCanc.filas[0], ["numero de pedido", "comision peya", "monto final"]);
    if (fc.length > 0) salida.errores.push(`En «Cargos por cancelaciones» faltan las columnas: ${fc.join(", ")}.`);
    else {
      const gc = (f: Celda[], n: string): Celda => (ic.has(n) ? f[ic.get(n) as number] : null);
      for (let i = 1; i < hojaCanc.filas.length; i++) {
        const f = hojaCanc.filas[i];
        const nro = textoDeCelda(gc(f, "numero de pedido"));
        if (!nro) continue;
        const monto = centavosDeCelda(gc(f, "monto del pedido")), com = centavosDeCelda(gc(f, "comision peya")), fin = centavosDeCelda(gc(f, "monto final"));
        if (monto === null || com === null || fin === null) { salida.errores.push(`Excel, cancelaciones, fila ${i + 1}: importe ilegible.`); continue; }
        salida.cancelaciones.push({ nro_pedido: nro, motivo: textoDeCelda(gc(f, "motivo")) || null, monto_pedido: monto, comision: com, monto_final: fin });
        salida.totales.cancelaciones += Math.abs(fin);
      }
    }
  }
  return salida;
}

// Pasa al pedido del CSV lo que solo trae el Excel (método de pago y quién cobró).
export function completarConExcel(pedidos: PedidoPeya[], excel: LecturaExcel): PedidoPeya[] {
  const porNro = new Map(excel.pedidos.map((p) => [p.nro_pedido, p]));
  return pedidos.map((p) => {
    const x = porNro.get(p.nro_pedido);
    return x ? { ...p, metodo_pago: x.metodo_pago, cobrado_por: x.cobrado_por } : p;
  });
}

// ── Estado de cuenta (PDF o formulario) ──────────────────────────────────────
// Lo que NO viene en el CSV ni en el Excel. Importes en centavos, con el signo con que aparecen en el estado de cuenta
// (un descuento es negativo). `null` = no se informó.
export interface EstadoCuentaPeya {
  periodo_desde:        string;          // AAAA-MM-DD
  periodo_hasta:        string;
  total_liquidado:      number;
  publicidad:           number;          // «Publicidad dentro de la aplicación» (sin IVA)
  iva_comisiones:       number;          // «Impuesto en comisiones - IVA» (incluye el IVA de la publicidad)
  retenciones_sirtac:   number;
  reintegros:           number;
  ajustes:              number;          // «Ajustes de liquidación»
  saldo_anterior:       number;          // «Saldo pendiente liquidación anterior»
  fecha_pago_procesado: string | null;   // «el día dd/mm/aaaa procesamos el pago»
  cuenta_destino:       string | null;   // «PSP PEYA terminada en 8313»
  ajustes_nota:         string | null;
}

// ── Cierre de la cuenta ──────────────────────────────────────────────────────
export interface Verificacion { id: string; etiqueta: string; esperado: number | null; obtenido: number | null; ok: boolean; detalle?: string }

export interface ResultadoCierre {
  entregados:       number;
  cancelados:       number;
  ventas_netas:     number;     // Σ «Total parcial» de los entregados
  servicio_ventas:  number;     // Σ comisión
  servicio_linea:   number;     // Σ comisión por pago en línea
  cargo_plus:       number;
  cargos_cancelacion: number;   // positivo: lo que se descuenta por los cancelados (con IVA)
  impuestos:        number;     // Σ impuesto de todos los pedidos
  ingreso_estimado: number;     // Σ ingreso estimado (todas las filas)
  iva_publicidad:   number | null;   // iva_comisiones + Σ impuesto (negativo); null sin estado de cuenta
  neto_calculado:   number | null;
  diferencia:       number | null;   // neto_calculado − total_liquidado
  verificaciones:   Verificacion[];
  hayErrores:       boolean;         // alguna verificación en rojo
  cierra:           boolean;         // hay estado de cuenta y la diferencia es exactamente 0 y nada en rojo
  informativo: { servicio_pct: number | null; iva_publicidad_pct: number | null };   // porcentajes observados, NO reglas
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function cerrarLiquidacion(pedidos: PedidoPeya[], excel: LecturaExcel | null, estado: EstadoCuentaPeya | null): ResultadoCierre {
  const entregados = pedidos.filter((p) => p.estado === "entregado");
  const cancelados = pedidos.filter((p) => p.estado === "cancelado");

  const ventas = sum(entregados, (p) => p.total_parcial);
  const servicio = sum(entregados, (p) => p.comision);
  const linea = sum(entregados, (p) => p.comision_pago_linea);
  const plus = sum(entregados, (p) => p.cargo_plus);
  const cancel = Math.abs(sum(cancelados, (p) => p.ingreso_estimado));
  const impuestos = sum(pedidos, (p) => p.impuesto);
  const ingreso = sum(pedidos, (p) => p.ingreso_estimado);

  const v: Verificacion[] = [];
  const igual = (id: string, etiqueta: string, esperado: number, obtenido: number, detalle?: string) =>
    v.push({ id, etiqueta, esperado, obtenido, ok: esperado === obtenido, detalle });

  if (excel) {
    igual("ventas", "Ventas netas: CSV contra Excel", excel.totales.venta_neta, ventas);
    igual("servicio", "Comisión por ventas: CSV contra Excel", excel.totales.servicio, servicio);
    igual("plus", "Cargo por pedidos con Plus: CSV contra Excel", excel.totales.plus, plus);
    const csv = new Set(entregados.map((p) => p.nro_pedido)), xls = new Set(excel.pedidos.map((p) => p.nro_pedido));
    const soloCsv = [...csv].filter((n) => !xls.has(n)), soloXls = [...xls].filter((n) => !csv.has(n));
    v.push({
      id: "pedidos", etiqueta: "Los mismos pedidos entregados en el CSV y en el Excel", esperado: xls.size, obtenido: csv.size,
      ok: soloCsv.length === 0 && soloXls.length === 0,
      detalle: soloCsv.length + soloXls.length === 0 ? undefined : [
        soloCsv.length ? `solo en el CSV: ${soloCsv.join(", ")}` : "", soloXls.length ? `solo en el Excel: ${soloXls.join(", ")}` : "",
      ].filter(Boolean).join(" · "),
    });
    const cargoCancelCsv = sum(cancelados, (p) => p.gastos_operativos);
    if (excel.cancelaciones.length > 0 || cargoCancelCsv > 0) {
      igual("cancelaciones", "Cargos por cancelaciones (sin IVA): CSV contra Excel", sum(excel.cancelaciones, (c) => Math.abs(c.monto_final)), cargoCancelCsv);
    }
  }

  let ivaPub: number | null = null, neto: number | null = null, dif: number | null = null;
  const informativo = { servicio_pct: ventas > 0 ? (servicio / ventas) * 100 : null, iva_publicidad_pct: null as number | null };
  if (estado) {
    ivaPub = estado.iva_comisiones + impuestos;       // iva_comisiones es negativo; Σ impuesto de los pedidos, positivo
    neto = ingreso + estado.publicidad + ivaPub + estado.retenciones_sirtac + estado.reintegros + estado.ajustes + estado.saldo_anterior;
    dif = neto - estado.total_liquidado;
    if (estado.publicidad !== 0) informativo.iva_publicidad_pct = (ivaPub / estado.publicidad) * 100;
    v.push({ id: "neto", etiqueta: "Neto calculado contra «Total liquidado» del estado de cuenta", esperado: estado.total_liquidado, obtenido: neto, ok: dif === 0 });
    if (estado.publicidad === 0 && ivaPub !== 0) {
      v.push({ id: "iva", etiqueta: "IVA sin publicidad que lo explique", esperado: 0, obtenido: ivaPub, ok: false,
        detalle: "«Impuesto en comisiones - IVA» no coincide con la suma de los impuestos de los pedidos y no hay publicidad. Revisá los importes cargados." });
    }
  }
  const hayErrores = v.some((x) => !x.ok);
  return {
    entregados: entregados.length, cancelados: cancelados.length, ventas_netas: ventas, servicio_ventas: servicio, servicio_linea: linea,
    cargo_plus: plus, cargos_cancelacion: cancel, impuestos, ingreso_estimado: ingreso, iva_publicidad: ivaPub, neto_calculado: neto, diferencia: dif,
    verificaciones: v, hayErrores, cierra: estado !== null && dif === 0 && !hayErrores, informativo,
  };
}

// ── Fechas de cobro ──────────────────────────────────────────────────────────
// Suma días HÁBILES (lunes a viernes). El sistema no maneja feriados: «hasta 72 hs hábiles» es una cota estimada.
export function sumarDiasHabiles(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  let falta = dias;
  while (falta > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) falta--;
  }
  return d.toISOString().slice(0, 10);
}
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

export const HORAS_ACREDITACION = 72;   // «la acreditación puede demorar hasta 72 hs hábiles» = 3 días hábiles

export interface PlazoCobro {
  fecha_pago_procesado:     string | null;   // la que dice el estado de cuenta (confirmada)
  fecha_pago_estimada:      string | null;   // si no hay estado de cuenta: fin de período + el plazo de la última liquidación
  fecha_acreditacion_hasta: string | null;   // fecha de pago (o estimada) + 72 hs hábiles
  plazo_dias:               number | null;   // fin de período → pago
  alerta: string | null;                     // cambió el plazo de cobro
  confirmado: boolean;
}

export function calcularPlazoCobro(p: {
  periodo_hasta: string;
  fecha_pago_procesado: string | null;
  anterior: { periodo_hasta: string; fecha_pago_procesado: string | null } | null;   // la última liquidación con fecha de pago confirmada
}): PlazoCobro {
  const plazoAnterior = p.anterior?.fecha_pago_procesado ? diasEntre(p.anterior.periodo_hasta, p.anterior.fecha_pago_procesado) : null;
  if (p.fecha_pago_procesado) {
    const plazo = diasEntre(p.periodo_hasta, p.fecha_pago_procesado);
    return {
      fecha_pago_procesado: p.fecha_pago_procesado, fecha_pago_estimada: null,
      fecha_acreditacion_hasta: sumarDiasHabiles(p.fecha_pago_procesado, HORAS_ACREDITACION / 24), plazo_dias: plazo,
      alerta: plazoAnterior !== null && plazoAnterior !== plazo ? `Cambió el plazo de cobro: ahora ${plazo} días después de cerrar el período (la semana anterior fueron ${plazoAnterior}).` : null,
      confirmado: true,
    };
  }
  if (plazoAnterior === null) {
    return { fecha_pago_procesado: null, fecha_pago_estimada: null, fecha_acreditacion_hasta: null, plazo_dias: null, alerta: null, confirmado: false };
  }
  const estimada = sumarDias(p.periodo_hasta, plazoAnterior);
  return {
    fecha_pago_procesado: null, fecha_pago_estimada: estimada, fecha_acreditacion_hasta: sumarDiasHabiles(estimada, HORAS_ACREDITACION / 24),
    plazo_dias: plazoAnterior, alerta: null, confirmado: false,
  };
}

// ── Cruce con las ventas del sistema ─────────────────────────────────────────
// El sistema NO guarda el número de pedido de PedidosYa (y se decidió no pedírselo al kiosco): se cruza por día + importe exacto
// + hora cercana. El kiosco suele cargar la venta un rato después (hasta ~1,5 h en la semana de ejemplo), por eso se elige, entre las
// ventas del mismo importe, la más cercana en el tiempo, una sola vez cada una. Lo dudoso queda marcado para resolver a mano.
export interface VentaSistema { id: string; creado_en: string; total: number; canal: string }   // total en centavos (suma de los productos)

export type EstadoCruce = "conciliado" | "sin_venta" | "importe_distinto" | "efectivo_pendiente" | "no_aplica";
export interface CruceFila {
  nro_pedido: string; estado: EstadoCruce; movimiento_id: string | null; diferencia: number | null;   // pedido − venta, en centavos
}
export interface ResultadoCruce { filas: CruceFila[]; ventasSinPeya: VentaSistema[] }

export const esPedidoEnEfectivo = (p: Pick<PedidoPeya, "forma_pago" | "efectivo_cobrado" | "monto_adeudado" | "estado" | "cobrado_por">): boolean =>
  p.estado === "entregado" && (p.efectivo_cobrado > 0 || p.monto_adeudado > 0 || /efectivo/i.test(p.forma_pago ?? "") || /local/i.test(p.cobrado_por ?? ""));

const TOLERANCIA_IMPORTE_DISTINTO_MS = 3 * 3600_000;

export function cruzarConVentas(pedidos: PedidoPeya[], ventas: VentaSistema[]): ResultadoCruce {
  const entregados = pedidos.filter((p) => p.estado === "entregado" && p.fecha_pedido);
  const libres = new Set(ventas.map((v) => v.id));
  const porId = new Map(ventas.map((v) => [v.id, v]));
  const resultado = new Map<string, CruceFila>();

  // 1) Mismo importe exacto, mismo día (o el siguiente: se carga después de medianoche), la más cercana en el tiempo.
  const pares: { nro: string; venta: string; dist: number }[] = [];
  for (const p of entregados) {
    const t = Date.parse(p.fecha_pedido as string), dia = diaAR(p.fecha_pedido as string);
    for (const v of ventas) {
      if (v.total !== p.total_parcial) continue;
      const dv = diaAR(v.creado_en);
      if (dv !== dia && dv !== sumarDias(dia, 1)) continue;
      pares.push({ nro: p.nro_pedido, venta: v.id, dist: Math.abs(Date.parse(v.creado_en) - t) });
    }
  }
  pares.sort((a, b) => a.dist - b.dist || a.nro.localeCompare(b.nro) || a.venta.localeCompare(b.venta));
  const pedidoYaCruzado = new Set<string>();
  for (const par of pares) {
    if (pedidoYaCruzado.has(par.nro) || !libres.has(par.venta)) continue;
    pedidoYaCruzado.add(par.nro);
    libres.delete(par.venta);
    resultado.set(par.nro, { nro_pedido: par.nro, estado: "conciliado", movimiento_id: par.venta, diferencia: 0 });
  }

  // 2) Lo que quedó sin cruzar: ¿hay una venta cercana en el tiempo con otro importe?
  for (const p of entregados) {
    if (resultado.has(p.nro_pedido)) continue;
    const t = Date.parse(p.fecha_pedido as string);
    const candidatas = [...libres].map((id) => porId.get(id) as VentaSistema)
      .filter((v) => Math.abs(Date.parse(v.creado_en) - t) <= TOLERANCIA_IMPORTE_DISTINTO_MS)
      .sort((a, b) => Math.abs(Date.parse(a.creado_en) - t) - Math.abs(Date.parse(b.creado_en) - t));
    const v = candidatas[0];
    if (v) {
      libres.delete(v.id);
      resultado.set(p.nro_pedido, { nro_pedido: p.nro_pedido, estado: "importe_distinto", movimiento_id: v.id, diferencia: p.total_parcial - v.total });
    } else {
      resultado.set(p.nro_pedido, { nro_pedido: p.nro_pedido, estado: "sin_venta", movimiento_id: null, diferencia: null });
    }
  }

  // Los pedidos en efectivo se cruzan igual, pero lo que significan para la plata queda «pendiente de validar»: no hay ejemplo.
  const filas: CruceFila[] = pedidos.map((p) => {
    if (p.estado !== "entregado") return { nro_pedido: p.nro_pedido, estado: "no_aplica" as const, movimiento_id: null, diferencia: null };
    const c = resultado.get(p.nro_pedido) ?? { nro_pedido: p.nro_pedido, estado: "sin_venta" as const, movimiento_id: null, diferencia: null };
    return esPedidoEnEfectivo(p) ? { ...c, estado: "efectivo_pendiente" as const } : c;
  });
  return { filas, ventasSinPeya: [...libres].map((id) => porId.get(id) as VentaSistema) };
}

// ── Validación en el servidor ────────────────────────────────────────────────
// Nada de lo que manda el navegador se confía: se revalida todo y se recalcula el cierre en el servidor.
export const MAX_PEDIDOS_POR_LIQUIDACION = 2000;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
// Calendario estricto: Date.parse acepta «2026-02-30» y lo corre al 2 de marzo.
const esFecha = (f: unknown): f is string => {
  if (typeof f !== "string" || !FECHA_RE.test(f)) return false;
  const [a, m, d] = f.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const esCentavos = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) < 1e12;
const txt = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && v.length <= max ? v : undefined;     // undefined = inválido
};

export function validarPedidos(entrada: unknown): { valor: PedidoPeya[] } | { error: string } {
  if (!Array.isArray(entrada) || entrada.length === 0) return { error: "No hay pedidos para guardar." };
  if (entrada.length > MAX_PEDIDOS_POR_LIQUIDACION) return { error: `Demasiados pedidos en una liquidación (máximo ${MAX_PEDIDOS_POR_LIQUIDACION}).` };
  const salida: PedidoPeya[] = [], vistos = new Set<string>();
  for (const [i, raw] of entrada.entries()) {
    const p = raw as Record<string, unknown> | null;
    const donde = `Pedido ${i + 1}`;
    if (!p || typeof p !== "object") return { error: `${donde}: formato inválido.` };
    if (typeof p.nro_pedido !== "string" || !/^\d{4,20}$/.test(p.nro_pedido)) return { error: `${donde}: número de pedido inválido.` };
    if (typeof p.tienda_id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(p.tienda_id)) return { error: `${donde}: ID de tienda inválido.` };
    if (vistos.has(`${p.tienda_id}|${p.nro_pedido}`)) return { error: `${donde}: pedido repetido (${p.nro_pedido}).` };
    vistos.add(`${p.tienda_id}|${p.nro_pedido}`);
    if (typeof p.estado !== "string" || p.estado.length === 0 || p.estado.length > 40) return { error: `${donde}: estado inválido.` };
    for (const k of ["total_parcial", "impuesto", "comision_pago_linea", "cargo_plus", "comision", "gastos_operativos", "ingreso_estimado", "importe_pago", "monto_adeudado", "efectivo_cobrado"] as const) {
      if (!esCentavos(p[k])) return { error: `${donde}: importe inválido (${k}).` };
    }
    for (const k of ["fecha_pedido", "entregado_en", "cancelado_en"] as const) {
      if (p[k] !== null && p[k] !== undefined && (typeof p[k] !== "string" || Number.isNaN(Date.parse(p[k] as string)))) return { error: `${donde}: fecha inválida (${k}).` };
    }
    const t = { local_nombre: txt(p.local_nombre, 120), forma_pago: txt(p.forma_pago, 60), motivo_rechazo: txt(p.motivo_rechazo, 120),
      responsable_rechazo: txt(p.responsable_rechazo, 60), articulos: txt(p.articulos, 500), metodo_pago: txt(p.metodo_pago, 80), cobrado_por: txt(p.cobrado_por, 60) };
    if (Object.values(t).some((x) => x === undefined)) return { error: `${donde}: algún texto es demasiado largo.` };
    salida.push({
      ...(p as unknown as PedidoPeya), ...(t as Record<string, string | null>),
      fecha_pedido: (p.fecha_pedido as string | null) ?? null, entregado_en: (p.entregado_en as string | null) ?? null, cancelado_en: (p.cancelado_en as string | null) ?? null,
    });
  }
  return { valor: salida };
}

export function validarEstadoCuenta(entrada: unknown): { valor: EstadoCuentaPeya } | { error: string } {
  const e = entrada as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return { error: "Falta el estado de cuenta." };
  if (!esFecha(e.periodo_desde) || !esFecha(e.periodo_hasta)) return { error: "El período del estado de cuenta no es válido." };
  if (e.periodo_hasta < e.periodo_desde) return { error: "El período termina antes de empezar." };
  for (const k of ["total_liquidado", "publicidad", "iva_comisiones", "retenciones_sirtac", "reintegros", "ajustes", "saldo_anterior"] as const) {
    if (!esCentavos(e[k])) return { error: `Importe inválido en el estado de cuenta (${k}).` };
  }
  if (e.fecha_pago_procesado !== null && e.fecha_pago_procesado !== undefined && !esFecha(e.fecha_pago_procesado)) return { error: "La fecha de pago no es válida." };
  const cuenta = txt(e.cuenta_destino, 60), nota = txt(e.ajustes_nota, 200);
  if (cuenta === undefined || nota === undefined) return { error: "Algún texto del estado de cuenta es demasiado largo." };
  return {
    valor: {
      periodo_desde: e.periodo_desde, periodo_hasta: e.periodo_hasta,
      total_liquidado: e.total_liquidado as number, publicidad: e.publicidad as number, iva_comisiones: e.iva_comisiones as number,
      retenciones_sirtac: e.retenciones_sirtac as number, reintegros: e.reintegros as number, ajustes: e.ajustes as number, saldo_anterior: e.saldo_anterior as number,
      fecha_pago_procesado: (e.fecha_pago_procesado as string | null | undefined) ?? null, cuenta_destino: cuenta, ajustes_nota: nota,
    },
  };
}

// Los datos del Excel que viajan al servidor: solo los totales y los números de pedido, que es lo que hace falta para verificar.
export interface ResumenExcel {
  totales: LecturaExcel["totales"];
  nros_entregados: string[];
  cancelaciones: { nro_pedido: string; monto_final: number }[];
}
export function resumirExcel(x: LecturaExcel): ResumenExcel {
  return { totales: x.totales, nros_entregados: x.pedidos.map((p) => p.nro_pedido), cancelaciones: x.cancelaciones.map((c) => ({ nro_pedido: c.nro_pedido, monto_final: c.monto_final })) };
}
export function validarResumenExcel(e: unknown): { valor: LecturaExcel } | { error: string } {
  const r = e as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return { error: "Falta el resumen del Excel." };
  const t = r.totales as Record<string, unknown> | null;
  if (!t || !esCentavos(t.venta_neta) || !esCentavos(t.servicio) || !esCentavos(t.plus) || !esCentavos(t.cancelaciones)) return { error: "Los totales del Excel no son válidos." };
  if (!Array.isArray(r.nros_entregados) || r.nros_entregados.length > MAX_PEDIDOS_POR_LIQUIDACION || r.nros_entregados.some((n) => typeof n !== "string" || !/^\d{4,20}$/.test(n))) return { error: "Los pedidos del Excel no son válidos." };
  if (!Array.isArray(r.cancelaciones) || r.cancelaciones.length > MAX_PEDIDOS_POR_LIQUIDACION) return { error: "Las cancelaciones del Excel no son válidas." };
  const canc: CancelacionExcel[] = [];
  for (const c of r.cancelaciones as Record<string, unknown>[]) {
    if (!c || typeof c.nro_pedido !== "string" || !esCentavos(c.monto_final)) return { error: "Las cancelaciones del Excel no son válidas." };
    canc.push({ nro_pedido: c.nro_pedido, motivo: null, monto_pedido: 0, comision: 0, monto_final: c.monto_final as number });
  }
  return {
    valor: {
      pedidos: (r.nros_entregados as string[]).map((n) => ({ nro_pedido: n, sucursal: "", fecha: null, monto_bruto: 0, venta_neta: 0, servicio_pct: null, servicio_monto: 0, cargo_plus: 0, metodo_pago: null, cobrado_por: null, cobrado_por_local: 0 })),
      cancelaciones: canc, errores: [], totales: { venta_neta: t.venta_neta as number, servicio: t.servicio as number, plus: t.plus as number, cancelaciones: t.cancelaciones as number },
    },
  };
}
