// Importación del reporte de COBROS de Mercado Pago (Excel que baja el administrativo del panel de MP).
//
// Cómo está repartido el trabajo:
//   * El navegador abre el .xlsx y lo convierte en una grilla de celdas (components/importar-mp.tsx). Ahí se queda el archivo
//     completo: nombres, mails y documentos de los clientes NUNCA viajan al servidor.
//   * `leerReporteCobros` (este archivo, función pura) elige las columnas que hacen falta y arma filas normalizadas.
//   * El servidor vuelve a validar todo con `validarCobros` (no se confía en lo que manda el navegador) y recién ahí guarda.
//
// Las columnas se buscan por el código técnico que MP pone entre paréntesis en cada encabezado ("(operation_id)"), no por
// la posición ni por el texto en castellano: MP cambia el orden y las traducciones, pero esos códigos son la API.

export const MAX_FILAS_IMPORTACION = 5000;

// Fila normalizada: es lo único que se guarda de cada cobro.
export interface CobroMpEntrada {
  operation_id:       string;          // Nº de operación de Mercado Pago (único)
  fecha_cobro:        string;          // ISO con -03:00
  fecha_acreditacion: string | null;
  fecha_liberacion:   string | null;
  monto_bruto:        number;
  tarifa:             number;          // comisión de MP, siempre positiva
  monto_neto:         number;
  monto_devuelto:     number;
  estado:             string;          // approved, refunded, charged_back, in_process…
  estado_detalle:     string | null;
  tipo_operacion:     string;          // regular_payment, account_fund, partition_transfer…
  medio_pago:         string | null;   // account_money, bank_transfer, debit_card…
  descripcion:        string | null;   // "reason" del pago (no es dato personal)
  external_reference: string | null;   // la referencia que genera nuestro QR
  caja_externa:       string | null;   // external_id de la caja: así se sabe de qué local es
}

export type Celda = string | number | boolean | Date | null | undefined;

const REQUERIDAS = ["operation_id", "date_created", "status", "operation_type", "transaction_amount", "net_received_amount"] as const;

// Estados que no son plata: no se guardan (el rechazo por saldo insuficiente no movió nada).
const ESTADOS_SIN_PLATA = new Set(["rejected", "cancelled", "pending", "authorized"]);

function codigoDeEncabezado(h: Celda): string | null {
  if (typeof h !== "string") return null;
  const m = h.match(/\(([a-z0-9_]+)\)\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

function texto(v: Celda): string | null {
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return s === "" ? null : s;
}

function numero(v: Celda): number | null {
  if (v === null || v === undefined || v === "") return 0;       // celda vacía = 0 (ej. monto devuelto)
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

// MP exporta "13/10/2026 21:02:27" en hora argentina. Se guarda con el huso explícito (-03:00, Argentina no tiene horario de verano).
export function fechaMp(v: Celda): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
    const p = (x: string, n = 2) => x.padStart(n, "0");
    const iso = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se)}-03:00`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  const t = Date.parse(s);          // ya viene ISO
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface LecturaReporte {
  filas:      CobroMpEntrada[];
  ignoradas:  number;      // rechazadas o sin plata
  errores:    string[];    // problemas por fila (máximo 10 mostrados)
  desde:      string | null;   // primer y último día (AAAA-MM-DD, hora argentina) del archivo
  hasta:      string | null;
}

// `grilla`: primera fila = encabezados. Devuelve error global en `errores` si no parece un reporte de cobros de MP.
export function leerReporteCobros(grilla: Celda[][]): LecturaReporte {
  const vacio: LecturaReporte = { filas: [], ignoradas: 0, errores: [], desde: null, hasta: null };
  if (grilla.length < 2) return { ...vacio, errores: ["El archivo no tiene filas de cobros."] };

  const col = new Map<string, number>();
  grilla[0].forEach((h, i) => { const c = codigoDeEncabezado(h); if (c && !col.has(c)) col.set(c, i); });
  const faltan = REQUERIDAS.filter((c) => !col.has(c));
  if (faltan.length > 0) {
    return { ...vacio, errores: [`No parece el reporte de cobros de Mercado Pago (faltan las columnas: ${faltan.join(", ")}).`] };
  }
  const at = (fila: Celda[], c: string): Celda => (col.has(c) ? fila[col.get(c)!] : null);

  const resultado: LecturaReporte = { ...vacio };
  const vistos = new Set<string>();
  const dias: string[] = [];

  for (let i = 1; i < grilla.length; i++) {
    const fila = grilla[i];
    if (fila.every((c) => c === null || c === undefined || c === "")) continue;   // fila vacía
    const nro = i + 1;                                                           // número de fila en Excel
    const operation_id = texto(at(fila, "operation_id"));
    if (!operation_id) { resultado.errores.push(`Fila ${nro}: sin número de operación.`); continue; }
    if (vistos.has(operation_id)) continue;                                      // repetida dentro del archivo
    vistos.add(operation_id);

    const estado = (texto(at(fila, "status")) ?? "").toLowerCase();
    if (ESTADOS_SIN_PLATA.has(estado)) { resultado.ignoradas++; continue; }

    const fecha_cobro = fechaMp(at(fila, "date_created"));
    const bruto   = numero(at(fila, "transaction_amount"));
    const neto    = numero(at(fila, "net_received_amount"));
    const tarifa  = numero(at(fila, "mercadopago_fee"));
    const devuelto = numero(at(fila, "amount_refunded"));
    if (!fecha_cobro || bruto === null || neto === null || tarifa === null || devuelto === null) {
      resultado.errores.push(`Fila ${nro} (operación ${operation_id}): fecha o importe ilegible.`);
      continue;
    }

    resultado.filas.push({
      operation_id,
      fecha_cobro,
      fecha_acreditacion: fechaMp(at(fila, "date_approved")),
      fecha_liberacion:   fechaMp(at(fila, "date_released")),
      monto_bruto:    redondear2(bruto),
      tarifa:         redondear2(Math.abs(tarifa)),
      monto_neto:     redondear2(neto),
      monto_devuelto: redondear2(Math.abs(devuelto)),
      estado,
      estado_detalle: texto(at(fila, "status_detail")),
      tipo_operacion: (texto(at(fila, "operation_type")) ?? "desconocido").toLowerCase(),
      medio_pago:     texto(at(fila, "payment_type")),
      descripcion:    texto(at(fila, "reason")),
      external_reference: texto(at(fila, "external_reference")),
      caja_externa:   texto(at(fila, "external_id")),
    });
    dias.push(diaArgentino(fecha_cobro));
  }

  dias.sort();
  resultado.desde = dias[0] ?? null;
  resultado.hasta = dias[dias.length - 1] ?? null;
  return resultado;
}

// AAAA-MM-DD en hora argentina de un instante ISO.
export function diaArgentino(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

// ── Validación en el servidor ────────────────────────────────────────────────
const LIMITE_TEXTO = 300;
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

function esFechaIso(v: unknown): v is string {
  return typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
}
function esImporte(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9;
}
function textoOpcional(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > LIMITE_TEXTO) return undefined;     // undefined = inválido
  return v.trim() === "" ? null : v;
}

export function validarCobros(entrada: unknown): { valor: CobroMpEntrada[] } | { error: string } {
  if (!Array.isArray(entrada)) return { error: "El archivo no llegó bien. Probá de nuevo." };
  if (entrada.length === 0) return { error: "No hay cobros para importar." };
  if (entrada.length > MAX_FILAS_IMPORTACION) {
    return { error: `El archivo tiene ${entrada.length} cobros; el máximo por importación es ${MAX_FILAS_IMPORTACION}. Bajalo por períodos más cortos.` };
  }
  const salida: CobroMpEntrada[] = [];
  const ids = new Set<string>();
  for (const [i, r] of entrada.entries()) {
    const f = r as Record<string, unknown> | null;
    const donde = `Cobro ${i + 1}`;
    if (!f || typeof f !== "object") return { error: `${donde}: formato inválido.` };
    if (typeof f.operation_id !== "string" || !ID_OK.test(f.operation_id)) return { error: `${donde}: número de operación inválido.` };
    if (ids.has(f.operation_id)) return { error: `${donde}: operación repetida (${f.operation_id}).` };
    ids.add(f.operation_id);
    if (!esFechaIso(f.fecha_cobro)) return { error: `${donde}: fecha inválida.` };
    for (const k of ["fecha_acreditacion", "fecha_liberacion"] as const) {
      if (f[k] !== null && f[k] !== undefined && !esFechaIso(f[k])) return { error: `${donde}: ${k} inválida.` };
    }
    for (const k of ["monto_bruto", "tarifa", "monto_neto", "monto_devuelto"] as const) {
      if (!esImporte(f[k])) return { error: `${donde}: importe inválido (${k}).` };
    }
    if (typeof f.estado !== "string" || f.estado.length === 0 || f.estado.length > 40) return { error: `${donde}: estado inválido.` };
    if (typeof f.tipo_operacion !== "string" || f.tipo_operacion.length === 0 || f.tipo_operacion.length > 60) return { error: `${donde}: tipo de operación inválido.` };

    const estado_detalle = textoOpcional(f.estado_detalle);
    const medio_pago     = textoOpcional(f.medio_pago);
    const descripcion    = textoOpcional(f.descripcion);
    const external_reference = textoOpcional(f.external_reference);
    const caja_externa   = textoOpcional(f.caja_externa);
    if ([estado_detalle, medio_pago, descripcion, external_reference, caja_externa].some((x) => x === undefined)) {
      return { error: `${donde}: algún texto es demasiado largo o inválido.` };
    }

    salida.push({
      operation_id: f.operation_id,
      fecha_cobro: new Date(f.fecha_cobro as string).toISOString(),
      fecha_acreditacion: f.fecha_acreditacion ? new Date(f.fecha_acreditacion as string).toISOString() : null,
      fecha_liberacion:   f.fecha_liberacion   ? new Date(f.fecha_liberacion as string).toISOString()   : null,
      monto_bruto: f.monto_bruto as number, tarifa: Math.abs(f.tarifa as number),
      monto_neto: f.monto_neto as number, monto_devuelto: Math.abs(f.monto_devuelto as number),
      estado: (f.estado as string).toLowerCase(), estado_detalle: estado_detalle as string | null,
      tipo_operacion: (f.tipo_operacion as string).toLowerCase(), medio_pago: medio_pago as string | null,
      descripcion: descripcion as string | null, external_reference: external_reference as string | null,
      caja_externa: caja_externa as string | null,
    });
  }
  return { valor: salida };
}

// ── Clasificación de lo que no es una venta de caja ──────────────────────────
export const CLASIFICACIONES = [
  { valor: "transferencia_propia", etiqueta: "Traspaso entre cuentas propias" },
  { valor: "aporte_socio",         etiqueta: "Aporte de un socio" },
  { valor: "otro_ingreso",         etiqueta: "Otro ingreso" },
  { valor: "no_es_ingreso",        etiqueta: "No es un ingreso (movimiento interno de MP)" },
] as const;
export type Clasificacion = (typeof CLASIFICACIONES)[number]["valor"];
export const etiquetaClasificacion = (v: string | null) => CLASIFICACIONES.find((c) => c.valor === v)?.etiqueta ?? "Sin clasificar";
export const esClasificacion = (v: unknown): v is Clasificacion => CLASIFICACIONES.some((c) => c.valor === v);

// ¿Es un cobro de caja (venta por QR) o hay que preguntar qué es? Lo decide el tipo de operación y si se sabe de qué local es.
export function claseDeCobro(c: Pick<CobroMpEntrada, "tipo_operacion">, sucursalId: string | null): "cobro" | "a_clasificar" {
  return c.tipo_operacion === "regular_payment" && sucursalId ? "cobro" : "a_clasificar";
}

// ── Resumen y cruce con las ventas del sistema ───────────────────────────────
export interface CobroGuardado {
  operation_id: string; sucursal_id: string | null; fecha_cobro: string; fecha_liberacion: string | null;
  monto_bruto: number; tarifa: number; monto_neto: number; monto_devuelto: number;
  estado: string; clase: "cobro" | "a_clasificar"; clasificacion: string | null; external_reference: string | null;
}

export interface TotalesCobros { cobros: number; bruto: number; tarifa: number; neto: number; devuelto: number; aLiberar: number }
const CERO: TotalesCobros = { cobros: 0, bruto: 0, tarifa: 0, neto: 0, devuelto: 0, aLiberar: 0 };

// Solo cuentan los cobros de caja aprobados; lo que está "a clasificar" se muestra aparte.
export function resumirCobros(cobros: CobroGuardado[], ahoraMs: number = Date.now()): { total: TotalesCobros; porSucursal: Map<string, TotalesCobros> } {
  const total: TotalesCobros = { ...CERO };
  const porSucursal = new Map<string, TotalesCobros>();
  for (const c of cobros) {
    if (c.clase !== "cobro" || c.estado !== "approved") continue;
    const t = porSucursal.get(c.sucursal_id ?? "") ?? { ...CERO };
    for (const dest of [t, total]) {
      dest.cobros += 1;
      dest.bruto  += c.monto_bruto;
      dest.tarifa += c.tarifa;
      dest.neto   += c.monto_neto;
      dest.devuelto += c.monto_devuelto;
      if (c.fecha_liberacion && Date.parse(c.fecha_liberacion) > ahoraMs) dest.aLiberar += c.monto_neto;
    }
    porSucursal.set(c.sucursal_id ?? "", t);
  }
  return { total, porSucursal };
}

export interface OrdenQr {
  external_reference: string; mp_payment_id: string | null; estado: string; monto: number; paid_at: string | null;
  movimiento_id: string | null; sucursal_id: string;
}

export interface CruceCobros {
  mpSinSistema:     CobroGuardado[];   // MP cobró y el sistema no tiene esa orden QR
  mpSinVenta:       { cobro: CobroGuardado; orden: OrdenQr }[];   // la orden existe pero no quedó atada a una venta
  distintoMonto:    { cobro: CobroGuardado; orden: OrdenQr }[];
  sistemaSinMp:     OrdenQr[];         // el sistema dice pagado y MP no lo informa (solo dentro de lo importado)
}

// `rangos`: días (AAAA-MM-DD) cubiertos por las importaciones; solo ahí se puede afirmar que MP "no tiene" una orden.
export function cruzarConSistema(cobros: CobroGuardado[], ordenes: OrdenQr[], rangos: { desde: string; hasta: string }[]): CruceCobros {
  const porOperacion = new Map<string, OrdenQr>();
  const porReferencia = new Map<string, OrdenQr>();
  for (const o of ordenes) {
    if (o.mp_payment_id) porOperacion.set(o.mp_payment_id, o);
    porReferencia.set(o.external_reference, o);
  }
  const res: CruceCobros = { mpSinSistema: [], mpSinVenta: [], distintoMonto: [], sistemaSinMp: [] };
  const operaciones = new Set<string>();
  const referencias = new Set<string>();

  for (const c of cobros) {
    if (c.clase !== "cobro" || c.estado !== "approved") continue;
    operaciones.add(c.operation_id);
    if (c.external_reference) referencias.add(c.external_reference);
    const o = porOperacion.get(c.operation_id) ?? (c.external_reference ? porReferencia.get(c.external_reference) : undefined);
    if (!o || o.estado !== "pagado") { res.mpSinSistema.push(c); continue; }
    if (Math.abs(o.monto - c.monto_bruto) > 0.01) res.distintoMonto.push({ cobro: c, orden: o });
    if (!o.movimiento_id) res.mpSinVenta.push({ cobro: c, orden: o });
  }

  const cubierto = (dia: string) => rangos.some((r) => dia >= r.desde && dia <= r.hasta);
  for (const o of ordenes) {
    if (o.estado !== "pagado" || !o.paid_at) continue;
    if (!cubierto(diaArgentino(o.paid_at))) continue;
    const hay = (o.mp_payment_id && operaciones.has(o.mp_payment_id)) || referencias.has(o.external_reference);
    if (!hay) res.sistemaSinMp.push(o);
  }
  return res;
}
