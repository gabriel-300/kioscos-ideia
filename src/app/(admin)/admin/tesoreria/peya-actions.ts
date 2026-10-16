"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial } from "@/lib/tesoreria/historial";
import { fechaHoyAR } from "@/lib/fecha";
import {
  aPesos, calcularPlazoCobro, cerrarLiquidacion, cruzarConVentas, diaAR, validarEstadoCuenta, validarPedidos, validarResumenExcel,
  type EstadoCruce, type EstadoCuentaPeya, type LecturaExcel, type PedidoPeya, type PlazoCobro, type ResultadoCierre,
} from "@/lib/tesoreria/peya";
import {
  cargarLiquidacionPeya, cargarLiquidacionPorPeriodo, cargarLiquidacionPrevia, cargarPedidosDeLiquidacion, cargarTiendasPeya, cargarVentasParaCruce, type LiquidacionPeya,
} from "@/lib/tesoreria/peya-consultas";

// Mismas convenciones que actions.ts: devuelven { error } en vez de lanzar, escribe solo el servidor (service_role) y cada acción
// verifica el permiso acá (cargar = administrativo de Tesorería). Nada de lo que manda el navegador se confía: se vuelve a validar y a
// calcular todo (peya.ts es puro y es el mismo código que usa la pantalla para la vista previa).
type Resultado = { error?: string };

const SIN_PERMISO   = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 108 de la base de datos";

// Tablas nuevas que todavía no están en src/types/database.ts (ese archivo se regenera aparte): se castean como en el resto del repo.
type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const esTablaFaltante = (m: string) => /peya_(liquidaciones|pedidos|archivos)/.test(m) && /does not exist|schema cache|no existe/i.test(m);
const TROZO = 500;
const pesos = (c: number | null | undefined): number | null => (c === null || c === undefined ? null : aPesos(c));
const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

async function exigirCargar() {
  const permisos = await permisosTesoreria();
  return permisos?.puedeCargar ? permisos : null;
}

// ── Archivos originales (depósito privado «peya») ────────────────────────────
const TIPOS_ARCHIVO = {
  csv:   { ext: "csv",  mime: "text/csv" },
  excel: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pdf:   { ext: "pdf",  mime: "application/pdf" },
} as const;
type TipoArchivo = keyof typeof TIPOS_ARCHIVO;
const PATH_ARCHIVO_RE = /^\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(csv|xlsx|pdf)$/;
const MAX_BYTES_ARCHIVO = 2 * 1024 * 1024;

export async function crearUrlSubidaPeya(tipo: string): Promise<{ error: string } | { path: string; token: string; mime: string }> {
  if (!(await exigirCargar())) return { error: SIN_PERMISO };
  if (!(tipo in TIPOS_ARCHIVO)) return { error: "Tipo de archivo inválido" };
  const t = TIPOS_ARCHIVO[tipo as TipoArchivo];
  const path = `${fechaHoyAR().slice(0, 7)}/${crypto.randomUUID()}.${t.ext}`;
  const { data, error } = await createAdminClient().storage.from("peya").createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "No se pudo preparar la subida" };
  return { path, token: data.token, mime: t.mime };
}

export async function urlArchivoPeya(archivoId: string): Promise<{ error: string } | { url: string }> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeVer) return { error: "Sin permisos" };
  const admin: Admin = createAdminClient();
  const { data } = await admin.from("peya_archivos").select("path").eq("id", archivoId).maybeSingle();
  if (!data?.path) return { error: "No se encontró el archivo" };
  const { data: firmada, error } = await admin.storage.from("peya").createSignedUrl(data.path, 120);
  if (error || !firmada) return { error: error?.message ?? "No se pudo abrir el archivo" };
  return { url: firmada.signedUrl };
}

interface ArchivoEntrada { tipo: string; nombre: string; path: string; bytes: number }
function validarArchivos(a: unknown): { valor: { tipo: TipoArchivo; nombre: string; path: string; bytes: number }[] } | { error: string } {
  if (a === undefined || a === null) return { valor: [] };
  if (!Array.isArray(a) || a.length > 5) return { error: "Los archivos adjuntos no son válidos." };
  const salida: { tipo: TipoArchivo; nombre: string; path: string; bytes: number }[] = [];
  for (const x of a as ArchivoEntrada[]) {
    if (!x || !(x.tipo in TIPOS_ARCHIVO)) return { error: "Tipo de archivo adjunto inválido." };
    if (typeof x.path !== "string" || !PATH_ARCHIVO_RE.test(x.path)) return { error: "La ruta de un archivo adjunto no es válida." };
    if (typeof x.nombre !== "string" || x.nombre.length === 0 || x.nombre.length > 200) return { error: "El nombre de un archivo adjunto no es válido." };
    if (!Number.isSafeInteger(x.bytes) || x.bytes < 0 || x.bytes > MAX_BYTES_ARCHIVO) return { error: "Un archivo adjunto es demasiado grande (máximo 2 MB)." };
    salida.push({ tipo: x.tipo as TipoArchivo, nombre: x.nombre, path: x.path, bytes: x.bytes });
  }
  return { valor: salida };
}

// ── Lo común a la vista previa y al guardado ─────────────────────────────────
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function periodoValido(p: unknown): { desde: string; hasta: string } | null {
  const x = p as { desde?: unknown; hasta?: unknown } | null;
  if (!x || typeof x.desde !== "string" || typeof x.hasta !== "string" || !FECHA_RE.test(x.desde) || !FECHA_RE.test(x.hasta) || x.hasta < x.desde) return null;
  return { desde: x.desde, hasta: x.hasta };
}

interface Preparado {
  pedidos: PedidoPeya[]; excel: LecturaExcel | null; estado: EstadoCuentaPeya | null; periodo: { desde: string; hasta: string };
  tiendaId: string; sucursalId: string; localNombre: string;
}

async function preparar(entrada: { pedidos: unknown; excel?: unknown; estado?: unknown; periodo?: unknown }, admin: Admin): Promise<{ error: string } | Preparado> {
  const ped = validarPedidos(entrada.pedidos);
  if ("error" in ped) return { error: ped.error };

  let excel: LecturaExcel | null = null;
  if (entrada.excel) { const e = validarResumenExcel(entrada.excel); if ("error" in e) return { error: e.error }; excel = e.valor; }
  let estado: EstadoCuentaPeya | null = null;
  if (entrada.estado) { const e = validarEstadoCuenta(entrada.estado); if ("error" in e) return { error: e.error }; estado = e.valor; }

  const periodo = estado ? { desde: estado.periodo_desde, hasta: estado.periodo_hasta } : periodoValido(entrada.periodo);
  if (!periodo) return { error: "Indicá el período de la liquidación (desde y hasta)." };

  const tiendas = new Set(ped.valor.map((p) => p.tienda_id));
  if (tiendas.size !== 1) return { error: `El CSV tiene pedidos de ${tiendas.size} tiendas. Bajalo de a una tienda por vez (una liquidación por tienda).` };
  const tiendaId = [...tiendas][0];
  const local = (await cargarTiendasPeya(admin)).get(tiendaId);
  if (!local) return { error: `La tienda ${tiendaId} de PedidosYa todavía no está asignada a un local. Asignala primero.` };

  return {
    // El método de pago y quién cobró (que solo trae el Excel) ya vienen completados desde el navegador; el servidor no los pisa.
    pedidos: ped.valor, excel, estado, periodo, tiendaId, sucursalId: local.sucursal_id, localNombre: local.nombre,
  };
}

export interface VistaPreviaPeya {
  error?: string;
  tienda?: { id: string; local: string };
  cruce?: { nro_pedido: string; estado: EstadoCruce; movimiento_id: string | null; diferencia: number | null }[];
  ventasSinPeya?: { id: string; creado_en: string; total: number; canal: string }[];
  plazo?: PlazoCobro;
  existente?: { estado: string; periodo_desde: string; periodo_hasta: string } | null;
  cierre?: ResultadoCierre;
  advertencias?: string[];
}

// Lo que necesita la pantalla antes de confirmar: el cruce con las ventas del kiosco y el plazo de cobro (necesitan la base). El cierre
// de la cuenta también se devuelve para que lo que se ve y lo que se guarda salgan del mismo código.
export async function previsualizarPeya(entrada: { pedidos: unknown; excel?: unknown; estado?: unknown; periodo?: unknown }): Promise<VistaPreviaPeya> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeVer) return { error: "Sin permisos" };
  const admin: Admin = createAdminClient();
  try {
    const p = await preparar(entrada, admin);
    if ("error" in p) return { error: p.error };

    const [ventas, previa, existente] = await Promise.all([
      cargarVentasParaCruce(admin, p.sucursalId, p.periodo.desde, p.periodo.hasta),
      cargarLiquidacionPrevia(admin, p.tiendaId, p.periodo.hasta),
      cargarLiquidacionPorPeriodo(admin, p.tiendaId, p.periodo.desde, p.periodo.hasta),
    ]);
    const cruce = cruzarConVentas(p.pedidos, ventas);
    const cierre = cerrarLiquidacion(p.pedidos, p.excel, p.estado);
    const plazo = calcularPlazoCobro({ periodo_hasta: p.periodo.hasta, fecha_pago_procesado: p.estado?.fecha_pago_procesado ?? null, anterior: previa });

    const advertencias: string[] = [];
    const fuera = p.pedidos.filter((x) => x.estado === "entregado" && x.fecha_pedido && (diaAR(x.fecha_pedido) < p.periodo.desde || diaAR(x.fecha_pedido) > p.periodo.hasta));
    if (fuera.length > 0) advertencias.push(`${fuera.length} pedido(s) entregado(s) tienen fecha fuera del período ${p.periodo.desde} al ${p.periodo.hasta}: revisá que sean los archivos de la misma semana.`);
    if (existente) advertencias.push(`Ya hay una liquidación ${existente.estado} de este período: al guardar se actualiza, no se duplica.`);

    // Solo las ventas sin cruzar dentro del período (el margen de un día es para poder cruzar, no para reclamar).
    const ventasSinPeya = cruce.ventasSinPeya.filter((v) => { const d = diaAR(v.creado_en); return d >= p.periodo.desde && d <= p.periodo.hasta; });
    return {
      tienda: { id: p.tiendaId, local: p.localNombre }, cruce: cruce.filas, ventasSinPeya, plazo, cierre, advertencias,
      existente: existente ? { estado: existente.estado, periodo_desde: existente.periodo_desde, periodo_hasta: existente.periodo_hasta } : null,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: esTablaFaltante(m) ? SIN_MIGRACION : m };
  }
}

// ── Guardar la liquidación ───────────────────────────────────────────────────
export interface GuardarPeyaEntrada {
  pedidos: unknown;
  excel: unknown | null;            // solo totales y números de pedido (peya.ts → resumirExcel)
  estado: unknown | null;           // estado de cuenta (PDF o formulario); null = liquidación estimada
  periodo: { desde: string; hasta: string };
  archivos: unknown;
}
export interface ResultadoGuardarPeya extends Resultado { id?: string; estado?: string; diferencia?: number | null }

export async function guardarLiquidacionPeya(entrada: GuardarPeyaEntrada): Promise<ResultadoGuardarPeya> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  const admin: Admin = createAdminClient();

  try {
    const archivos = validarArchivos(entrada.archivos);
    if ("error" in archivos) return { error: archivos.error };
    const p = await preparar(entrada, admin);
    if ("error" in p) return { error: p.error };

    // La verdad es el estado de cuenta: si la cuenta no cierra a $0,00 no se confirma. Y si hay Excel, lo que dice debe coincidir con el CSV.
    const cierre = cerrarLiquidacion(p.pedidos, p.excel, p.estado);
    if (cierre.hayErrores) {
      const mal = cierre.verificaciones.filter((v) => !v.ok).map((v) => v.etiqueta + (v.detalle ? ` (${v.detalle})` : "")).join("; ");
      const dif = cierre.diferencia !== null && cierre.diferencia !== 0 ? ` Diferencia: ${AR.format(aPesos(cierre.diferencia))}.` : "";
      return { error: `La cuenta no cierra, no se guarda: ${mal}.${dif}`, diferencia: cierre.diferencia === null ? null : aPesos(cierre.diferencia) };
    }

    const existente = await cargarLiquidacionPorPeriodo(admin, p.tiendaId, p.periodo.desde, p.periodo.hasta);
    if (existente && (existente.estado === "acreditado" || existente.estado === "conciliado")) {
      return { error: "Esa liquidación ya está acreditada: no se puede volver a importar." };
    }
    if (existente?.estado === "confirmado" && !p.estado) {
      return { error: "Esa liquidación ya está confirmada con su estado de cuenta: para actualizarla cargá otra vez el estado de cuenta." };
    }

    const [ventas, previa] = await Promise.all([
      cargarVentasParaCruce(admin, p.sucursalId, p.periodo.desde, p.periodo.hasta),
      cargarLiquidacionPrevia(admin, p.tiendaId, p.periodo.hasta),
    ]);
    // Reimportar (por ejemplo para confirmar con el estado de cuenta una semana que estaba estimada) NO deshace lo que ya se cruzó: los pedidos que
    // ya tienen una venta (sea automática o hecha a mano) la conservan, y esas ventas salen del pozo para no cruzarse dos veces.
    const previos = existente ? await cargarPedidosDeLiquidacion(admin, existente.id) : [];
    const fijos = new Map(previos.filter((x) => x.movimiento_id).map((x) => [x.nro_pedido, x]));
    const ventasFijas = new Set([...fijos.values()].map((x) => x.movimiento_id as string));
    const sueltos = p.pedidos.filter((x) => !fijos.has(x.nro_pedido));
    const nuevo = cruzarConVentas(sueltos, ventas.filter((v) => !ventasFijas.has(v.id)));
    const cruce = {
      ...nuevo,
      filas: p.pedidos.map((x) => {
        const f = fijos.get(x.nro_pedido);
        return f
          ? { nro_pedido: x.nro_pedido, estado: f.conciliacion as EstadoCruce, movimiento_id: f.movimiento_id, diferencia: f.diferencia_importe === null ? null : Math.round(f.diferencia_importe * 100) }
          : (nuevo.filas.find((y) => y.nro_pedido === x.nro_pedido) as typeof nuevo.filas[number]);
      }),
    };
    const plazo = calcularPlazoCobro({ periodo_hasta: p.periodo.hasta, fecha_pago_procesado: p.estado?.fecha_pago_procesado ?? null, anterior: previa });
    const e = p.estado;
    const ahora = new Date().toISOString();

    const fila = {
      tienda_id: p.tiendaId, sucursal_id: p.sucursalId, periodo_desde: p.periodo.desde, periodo_hasta: p.periodo.hasta,
      estado: e ? "confirmado" : "estimado",
      pedidos_entregados: cierre.entregados, pedidos_cancelados: cierre.cancelados,
      ventas_netas: aPesos(cierre.ventas_netas), servicio_ventas: aPesos(cierre.servicio_ventas), servicio_pago_linea: aPesos(cierre.servicio_linea),
      cargo_plus: aPesos(cierre.cargo_plus), cargos_cancelacion: aPesos(cierre.cargos_cancelacion), impuestos_pedidos: aPesos(cierre.impuestos), ingreso_estimado: aPesos(cierre.ingreso_estimado),
      publicidad: pesos(e?.publicidad), iva_comisiones: pesos(e?.iva_comisiones), retenciones_sirtac: pesos(e?.retenciones_sirtac), reintegros: pesos(e?.reintegros),
      ajustes: pesos(e?.ajustes), saldo_anterior: pesos(e?.saldo_anterior), ajustes_nota: e?.ajustes_nota ?? null,
      total_liquidado: pesos(e?.total_liquidado), neto_calculado: pesos(cierre.neto_calculado), diferencia: pesos(cierre.diferencia),
      fecha_pago_procesado: plazo.fecha_pago_procesado, fecha_pago_estimada: plazo.fecha_pago_estimada, fecha_acreditacion_hasta: plazo.fecha_acreditacion_hasta,
      cuenta_destino: e?.cuenta_destino ?? null, alerta_plazo: plazo.alerta,
      confirmada_por: e ? permisos.userId : null, confirmada_en: e ? ahora : null,
      updated_by: permisos.userId, updated_at: ahora,
      ...(existente ? {} : { created_by: permisos.userId }),
    };
    const { data: liq, error: errLiq } = await admin.from("peya_liquidaciones")
      .upsert(fila, { onConflict: "tienda_id,periodo_desde,periodo_hasta" }).select("id").single();
    if (errLiq || !liq) return { error: esTablaFaltante(errLiq?.message ?? "") ? SIN_MIGRACION : (errLiq?.message ?? "No se pudo guardar la liquidación") };

    const porNro = new Map(cruce.filas.map((f) => [f.nro_pedido, f]));
    const filasPedidos = p.pedidos.map((x) => {
      const c = porNro.get(x.nro_pedido);
      return {
        liquidacion_id: liq.id, tienda_id: x.tienda_id, nro_pedido: x.nro_pedido, estado: x.estado, forma_pago: x.forma_pago,
        fecha_pedido: x.fecha_pedido, entregado_en: x.entregado_en, cancelado_en: x.cancelado_en, motivo_rechazo: x.motivo_rechazo, responsable_rechazo: x.responsable_rechazo,
        total_parcial: aPesos(x.total_parcial), impuesto: aPesos(x.impuesto), comision_pago_linea: aPesos(x.comision_pago_linea), cargo_plus: aPesos(x.cargo_plus),
        comision: aPesos(x.comision), gastos_operativos: aPesos(x.gastos_operativos), ingreso_estimado: aPesos(x.ingreso_estimado), importe_pago: aPesos(x.importe_pago),
        monto_adeudado: aPesos(x.monto_adeudado), efectivo_cobrado: aPesos(x.efectivo_cobrado), metodo_pago: x.metodo_pago, cobrado_por: x.cobrado_por, articulos: x.articulos,
        movimiento_id: c?.movimiento_id ?? null, conciliacion: c?.estado ?? "sin_revisar", diferencia_importe: pesos(c?.diferencia ?? null), updated_at: ahora,
      };
    });
    for (let i = 0; i < filasPedidos.length; i += TROZO) {
      const { error } = await admin.from("peya_pedidos").upsert(filasPedidos.slice(i, i + TROZO), { onConflict: "tienda_id,nro_pedido" });
      if (error) return { error: `Se guardó la liquidación pero falló la carga de pedidos: ${error.message}. Volvé a subir los mismos archivos para completarla.` };
    }
    if (archivos.valor.length > 0) {
      await admin.from("peya_archivos").insert(archivos.valor.map((a) => ({
        liquidacion_id: liq.id, tipo: a.tipo, nombre: a.nombre, path: a.path, bytes: a.bytes, subido_por: permisos.userId,
      })));
    }

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: e ? "peya_liquidacion_confirmada" : "peya_liquidacion_importada", entidad_id: liq.id,
      detalle: {
        local: p.localNombre, desde: p.periodo.desde, hasta: p.periodo.hasta, pedidos: p.pedidos.length, estado: fila.estado,
        total_liquidado: pesos(e?.total_liquidado), diferencia: pesos(cierre.diferencia), reimportada: !!existente,
      },
    });
    revalidatePath("/admin/tesoreria");
    if (historial.error) return { id: liq.id, estado: fila.estado, error: "La liquidación se guardó, pero no quedó anotada en el historial. Avisale al administrador del sistema." };
    return { id: liq.id, estado: fila.estado, diferencia: pesos(cierre.diferencia) };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: esTablaFaltante(m) ? SIN_MIGRACION : m };
  }
}

// ── Acreditación: cuando la plata de la PeYa Wallet entra a Mercado Pago ─────
export interface CandidatoAcreditacion { operation_id: string; fecha: string; monto: number; igual: boolean }

// Movimientos de Mercado Pago sin clasificar que podrían ser este pago: la semana pasa de la PeYa Wallet a Mercado Pago.
export async function candidatosAcreditacionMp(liquidacionId: string): Promise<{ error?: string; candidatos?: CandidatoAcreditacion[] }> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeVer) return { error: "Sin permisos" };
  const admin: Admin = createAdminClient();
  try {
    const liq = await cargarLiquidacionPeya(admin, liquidacionId);
    if (!liq) return { error: "No se encontró la liquidación" };
    if (liq.total_liquidado === null) return { candidatos: [] };
    const desde = liq.fecha_pago_procesado ?? liq.periodo_hasta;
    const { data, error } = await admin.from("mp_cobros")
      .select("operation_id, fecha_cobro, monto_neto, estado, clase, clasificacion")
      .eq("clase", "a_clasificar").is("clasificacion", null).eq("estado", "approved").gte("fecha_cobro", `${desde}T00:00:00-03:00`)
      .order("fecha_cobro").limit(60);
    if (error) return { error: error.message };
    const total = Math.round(liq.total_liquidado * 100);
    const cands = ((data ?? []) as { operation_id: string; fecha_cobro: string; monto_neto: number | string }[])
      .map((c) => ({ operation_id: c.operation_id, fecha: diaAR(c.fecha_cobro), monto: Number(c.monto_neto), igual: Math.round(Number(c.monto_neto) * 100) === total }))
      .filter((c) => c.igual || Math.abs(Math.round(c.monto * 100) - total) <= Math.max(500, Math.round(total * 0.05)))
      .slice(0, 6);
    return { candidatos: cands };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function registrarAcreditacionPeya(entrada: { id: string; fecha: string; monto: number; mp_operation_id: string | null }): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  const hoy = fechaHoyAR();
  if (!FECHA_RE.test(entrada.fecha) || Number.isNaN(Date.parse(`${entrada.fecha}T12:00:00Z`))) return { error: "La fecha no es válida" };
  if (entrada.fecha > hoy) return { error: "La fecha de acreditación no puede ser futura" };
  if (typeof entrada.monto !== "number" || !Number.isFinite(entrada.monto) || entrada.monto <= 0 || entrada.monto > 1_000_000_000) return { error: "El monto no es válido" };
  const monto = Math.round(entrada.monto * 100) / 100;

  const admin: Admin = createAdminClient();
  try {
    const liq = await cargarLiquidacionPeya(admin, entrada.id);
    if (!liq) return { error: "No se encontró la liquidación" };
    if (liq.estado === "estimado" || liq.total_liquidado === null) return { error: "Primero confirmá la liquidación con el estado de cuenta: sin el «Total liquidado» no se sabe cuánto debería llegar." };
    if (entrada.fecha < liq.periodo_hasta) return { error: "La plata no puede acreditarse antes de que termine el período" };

    let mpOp: string | null = null;
    if (entrada.mp_operation_id) {
      const { data: otras } = await admin.from("peya_liquidaciones").select("id").eq("mp_operation_id", entrada.mp_operation_id).neq("id", liq.id).limit(1);
      if ((otras ?? []).length > 0) return { error: "Ese movimiento de Mercado Pago ya está asignado a otra liquidación." };
      const { data: mov } = await admin.from("mp_cobros").select("operation_id, clase, clasificacion").eq("operation_id", entrada.mp_operation_id).maybeSingle();
      if (!mov || mov.clase !== "a_clasificar") return { error: "Ese movimiento de Mercado Pago no existe o ya es una venta de caja." };
      mpOp = mov.operation_id;
      if (!mov.clasificacion) {
        // Lo que PedidosYa transfiere es plata que entra a la cuenta de Mercado Pago: se clasifica como ingreso, con la referencia.
        await admin.from("mp_cobros").update({
          clasificacion: "otro_ingreso", clasificacion_nota: `PedidosYa: liquidación del ${liq.periodo_desde} al ${liq.periodo_hasta}`,
          clasificado_por: permisos.userId, clasificado_en: new Date().toISOString(), actualizado_en: new Date().toISOString(),
        }).eq("operation_id", mov.operation_id).is("clasificacion", null);
      }
    }
    const esperado = Math.round(liq.total_liquidado * 100), llego = Math.round(monto * 100);
    const estado = mpOp && esperado === llego ? "conciliado" : "acreditado";

    const { error } = await admin.from("peya_liquidaciones").update({
      estado, fecha_acreditacion_real: entrada.fecha, monto_acreditado: monto, mp_operation_id: mpOp, updated_by: permisos.userId, updated_at: new Date().toISOString(),
    }).eq("id", liq.id).in("estado", ["confirmado", "acreditado"]);
    if (error) return { error: error.message };

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: "peya_acreditacion_registrada", entidad_id: liq.id,
      detalle: { desde: liq.periodo_desde, hasta: liq.periodo_hasta, esperado: liq.total_liquidado, acreditado: monto, diferencia: (llego - esperado) / 100, mercadopago: !!mpOp },
    });
    revalidatePath("/admin/tesoreria");
    return historial.error ? { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { error: esTablaFaltante(m) ? SIN_MIGRACION : m };
  }
}

// ── Cruce a mano: lo que el cruce automático no pudo resolver ────────────────
export async function conciliarPedidoPeya(pedidoId: string, movimientoId: string | null): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  const admin: Admin = createAdminClient();
  try {
    const { data: ped } = await admin.from("peya_pedidos").select("id, nro_pedido, liquidacion_id, total_parcial, estado").eq("id", pedidoId).maybeSingle();
    if (!ped) return { error: "No se encontró el pedido" };
    if (ped.estado !== "entregado") return { error: "Solo se cruzan los pedidos entregados" };
    const liq = await cargarLiquidacionPeya(admin, ped.liquidacion_id);
    if (!liq) return { error: "No se encontró la liquidación" };

    let conciliacion: string = "sin_venta", dif: number | null = null;
    if (movimientoId) {
      const { data: mov } = await admin.from("movimientos").select("id, sucursal_id, canal, tipo, anulado_en").eq("id", movimientoId).maybeSingle();
      if (!mov || mov.tipo !== "venta" || mov.anulado_en || !String(mov.canal).startsWith("pedido_ya") || mov.sucursal_id !== liq.sucursal_id) {
        return { error: "Esa venta no existe, está anulada o no es una venta de PedidosYa de ese local." };
      }
      const { data: usada } = await admin.from("peya_pedidos").select("id").eq("movimiento_id", movimientoId).neq("id", pedidoId).limit(1);
      if ((usada ?? []).length > 0) return { error: "Esa venta ya está cruzada con otro pedido." };
      const { data: items } = await admin.from("movimiento_items").select("subtotal").eq("movimiento_id", movimientoId);
      const total = ((items ?? []) as { subtotal: number | string }[]).reduce((s, i) => s + Math.round(Number(i.subtotal) * 100), 0);
      const pedido = Math.round(Number(ped.total_parcial) * 100);
      conciliacion = total === pedido ? "conciliado" : "importe_distinto";
      dif = (pedido - total) / 100;
    }
    const { error } = await admin.from("peya_pedidos").update({ movimiento_id: movimientoId, conciliacion, diferencia_importe: dif, updated_at: new Date().toISOString() }).eq("id", pedidoId);
    if (error) return { error: error.message };

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: "peya_conciliacion_manual", entidad_id: pedidoId,
      detalle: { pedido: ped.nro_pedido, venta: movimientoId, resultado: conciliacion },
    });
    revalidatePath("/admin/tesoreria");
    return historial.error ? { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── «Ya lo revisé»: un pedido que no cruza con ninguna venta y ya se averiguó qué pasó ──────────────────
// No cambia el pedido ni la liquidación: solo anota quién lo revisó y qué encontró, y deja de ser una alerta. Se puede volver a abrir.
export async function revisarPedidoPeya(pedidoId: string, nota: string, reabrir = false): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  const texto = (nota ?? "").trim();
  if (!reabrir && texto.length < 3) return { error: "Escribí qué averiguaste (por ejemplo: «el local se olvidó de cargarla»)" };
  if (texto.length > 200) return { error: "La nota es demasiado larga (máximo 200 caracteres)" };

  const admin: Admin = createAdminClient();
  try {
    const { data: ped } = await admin.from("peya_pedidos").select("id, nro_pedido, estado, conciliacion").eq("id", pedidoId).maybeSingle();
    if (!ped) return { error: "No se encontró el pedido" };
    if (ped.estado !== "entregado" || !["sin_venta", "importe_distinto"].includes(ped.conciliacion)) {
      return { error: "Solo se revisan los pedidos entregados que no cruzaron con una venta o tienen otro importe." };
    }
    const cambio = reabrir
      ? { revisado_en: null, revisado_por: null, revisado_nota: null }
      : { revisado_en: new Date().toISOString(), revisado_por: permisos.userId, revisado_nota: texto };
    const { error } = await admin.from("peya_pedidos").update({ ...cambio, updated_at: new Date().toISOString() }).eq("id", pedidoId);
    if (error) return { error: /revisado_/.test(error.message) ? "Falta aplicar la migración 109 de la base de datos" : error.message };

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: "peya_pedido_revisado", entidad_id: pedidoId,
      detalle: { pedido: ped.nro_pedido, conciliacion: ped.conciliacion, nota: reabrir ? null : texto, reabierto: reabrir },
      motivo: reabrir ? null : texto,
    });
    revalidatePath("/admin/tesoreria");
    return historial.error ? { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Qué local es cada tienda de PedidosYa ────────────────────────────────────
export async function asignarTiendaPeya(tiendaId: string, sucursalId: string): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  if (typeof tiendaId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(tiendaId)) return { error: "El ID de tienda no es válido" };
  const admin: Admin = createAdminClient();
  const { data: suc } = await admin.from("sucursales").select("id, nombre, pedidoya_store_id, entra_en_tesoreria").eq("id", sucursalId).maybeSingle();
  if (!suc || !suc.entra_en_tesoreria) return { error: "Ese local no existe o no entra en Tesorería" };
  if (suc.pedidoya_store_id && suc.pedidoya_store_id !== tiendaId) return { error: `${suc.nombre} ya tiene asignada otra tienda de PedidosYa (${suc.pedidoya_store_id}).` };
  const { error } = await admin.from("sucursales").update({ pedidoya_store_id: tiendaId }).eq("id", sucursalId);
  if (error) return { error: /duplicate key|unique/i.test(error.message) ? "Esa tienda ya está asignada a otro local." : error.message };
  revalidatePath("/admin/tesoreria");
  return {};
}

export type { LiquidacionPeya };
