// Cálculos de Tesorería. Funciones puras: reciben filas ya leídas y devuelven números. Así se prueban sin base
// (tests/unit/tesoreria.test.ts) y las pantallas solo muestran el resultado.

import { redondearMoneda } from "@/lib/pedidos/pricing";
import type { Categoria, Egreso } from "./tipos";

// ── Mes ──────────────────────────────────────────────────────────────────────
// Aritmética de calendario pura (UTC explícito): no depende de la zona horaria del servidor.
export function rangoDelMes(mes: string): { desde: string; hasta: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null;
  const [a, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimoDia).padStart(2, "0")}` };
}

export function mesAnteriorYSiguiente(mes: string): { anterior: string; siguiente: string } {
  const [a, m] = mes.split("-").map(Number);
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { anterior: f(new Date(Date.UTC(a, m - 2, 1))), siguiente: f(new Date(Date.UTC(a, m, 1))) };
}

// ── Egresos del período ──────────────────────────────────────────────────────
export interface ResumenEgresos {
  // "Salió": gasto operativo del negocio. NO incluye los retiros de socios: son reparto de plata, no un gasto, y
  // mezclarlos distorsionaría "entró menos salió".
  operativos:     number;
  retirosSocio:   number;
  conFactura:     number;   // dentro de `operativos`
  sinFactura:     number;   // dentro de `operativos`
  porCategoria:   { categoria: Categoria; monto: number }[];   // solo operativas, de mayor a menor
}

export function resumirEgresos(egresos: Pick<Egreso, "categoria" | "monto" | "comprobante">[]): ResumenEgresos {
  let operativos = 0, retirosSocio = 0, conFactura = 0, sinFactura = 0;
  const cat = new Map<Categoria, number>();
  for (const e of egresos) {
    if (e.categoria === "retiro_socio") { retirosSocio += e.monto; continue; }
    operativos += e.monto;
    if (e.comprobante === "con") conFactura += e.monto; else sinFactura += e.monto;
    cat.set(e.categoria, (cat.get(e.categoria) ?? 0) + e.monto);
  }
  return {
    operativos:   redondearMoneda(operativos),
    retirosSocio: redondearMoneda(retirosSocio),
    conFactura:   redondearMoneda(conFactura),
    sinFactura:   redondearMoneda(sinFactura),
    porCategoria: [...cat.entries()]
      .map(([categoria, monto]) => ({ categoria, monto: redondearMoneda(monto) }))
      .sort((x, y) => y.monto - x.monto),
  };
}

// ── Diferencia contra lo que cargó el kiosco ─────────────────────────────────
// El importe real es el de la factura que carga el administrativo; lo del kiosco es solo una referencia (el personal
// a veces carga mal los importes, o ni los carga). Devuelve null si el kiosco no cargó importes (no hay con qué comparar).
export function diferenciaConKiosco(montoReal: number, totalKiosco: number): number | null {
  if (!(totalKiosco > 0) || !Number.isFinite(montoReal)) return null;
  return redondearMoneda(montoReal - totalKiosco);
}

// ── Se debe ──────────────────────────────────────────────────────────────────
// Compras cargadas como pendientes de pago, agrupadas por proveedor (o, si no tiene proveedor de la lista, por lo
// que se escribió en la descripción: «lo de Mario»).
export interface Deuda { clave: string; nombre: string; monto: number; cantidad: number }

export function agruparDeuda(
  pendientes: Pick<Egreso, "proveedor_id" | "descripcion" | "monto">[],
  nombreProveedor: Map<string, string>,
): { items: Deuda[]; total: number } {
  const mapa = new Map<string, Deuda>();
  for (const p of pendientes) {
    const nombre = p.proveedor_id ? (nombreProveedor.get(p.proveedor_id) ?? "Proveedor") : p.descripcion.trim();
    const clave  = p.proveedor_id ?? `texto:${nombre.toLowerCase()}`;
    const d = mapa.get(clave) ?? { clave, nombre, monto: 0, cantidad: 0 };
    d.monto += p.monto;
    d.cantidad += 1;
    mapa.set(clave, d);
  }
  const items = [...mapa.values()]
    .map((d) => ({ ...d, monto: redondearMoneda(d.monto) }))
    .sort((a, b) => b.monto - a.monto);
  return { items, total: redondearMoneda(items.reduce((s, d) => s + d.monto, 0)) };
}

// ── Efectivo de Tesorería ────────────────────────────────────────────────────
// Es el efectivo que Damián tiene en mano: lo que ya tenía al arrancar + los sobres que recibió − lo que pagó
// en efectivo desde Tesorería. Un egreso con origen «retiro de caja» NO lo toca: esa plata salió del cajón del
// kiosco, nunca pasó por Tesorería. Transferencias y Mercado Pago tampoco son efectivo.
export interface SobreRecibido {
  efectivo_declarado:     number;
  fondo_siguiente:        number | null;
  sobre_monto_verificado: number | null;
}

// Lo que contó quien recibió el sobre, si lo verificó; si no, lo que el kiosco dejó en el sobre.
export function montoSobre(c: SobreRecibido): number {
  if (c.sobre_monto_verificado != null) return c.sobre_monto_verificado;
  if (c.fondo_siguiente == null) return 0;
  return Math.max(0, c.efectivo_declarado - c.fondo_siguiente);
}

export function efectivoDeTesoreria(p: {
  efectivoInicial: number;
  sobresRecibidos: SobreRecibido[];
  egresos:         Pick<Egreso, "origen" | "monto">[];
  // Cuenta corriente de las personas (migración 129): adelantos que salieron del efectivo de Tesorería y reposiciones que entraron.
  adelantos?:      number;
  reposiciones?:   number;
}): { efectivo: number; sobres: number; salidas: number; adelantos: number; reposiciones: number } {
  const sobres  = redondearMoneda(p.sobresRecibidos.reduce((s, c) => s + montoSobre(c), 0));
  const salidas = redondearMoneda(p.egresos.filter((e) => e.origen === "efectivo_tesoreria").reduce((s, e) => s + e.monto, 0));
  const adelantos = redondearMoneda(p.adelantos ?? 0), reposiciones = redondearMoneda(p.reposiciones ?? 0);
  return { efectivo: redondearMoneda(p.efectivoInicial + sobres + reposiciones - salidas - adelantos), sobres, salidas, adelantos, reposiciones };
}

// ── Obligaciones del mes ─────────────────────────────────────────────────────
// Lo que se paga todos los meses (sueldos, alquiler, servicios, cuotas) es la lista de gastos fijos; el pago de cada mes es un
// egreso con `gasto_fijo_id`. Una obligación está «sin registrar» mientras no tenga ningún egreso en el mes. Si se pagó en
// partes (el sueldo en dos veces) cuenta como registrada y se suma lo pagado: el estimado es una referencia, no un tope.
export interface FijoParaObligaciones {
  id: string; categoria: string; descripcion: string; monto_estimado: number; dia_vencimiento: number; sucursal_id: string | null;
}
export interface ObligacionMes {
  id: string; categoria: string; descripcion: string; sucursal_id: string | null;
  estimado:    number;
  pagado:      number;    // suma de lo registrado en el mes (0 si todavía no hay pago)
  pagos:       number;    // cuántos pagos se registraron
  registrada:  boolean;
  vencimiento: string;    // AAAA-MM-DD
  vencida:     boolean;   // sin registrar y ya pasó el día de vencimiento
}

export function obligacionesDelMes(
  fijos: FijoParaObligaciones[],
  egresosDelMes: Pick<Egreso, "gasto_fijo_id" | "monto">[],
  mes: string,
  hoy: string,
  // Fecha de arranque de Tesorería (AAAA-MM-DD): lo que vence antes ya está cerrado y no se pide registrar (como los retiros de caja).
  desde?: string,
): { items: ObligacionMes[]; pendiente: number; sinRegistrar: number; registrado: number; estimadoTotal: number } {
  const rango = rangoDelMes(mes);
  const ultimoDia = rango ? Number(rango.hasta.slice(8)) : 28;
  const pagos = new Map<string, { monto: number; cantidad: number }>();
  for (const e of egresosDelMes) {
    if (!e.gasto_fijo_id) continue;
    const p = pagos.get(e.gasto_fijo_id) ?? { monto: 0, cantidad: 0 };
    p.monto += e.monto;
    p.cantidad += 1;
    pagos.set(e.gasto_fijo_id, p);
  }
  const items = fijos.map((f): ObligacionMes => {
    const p = pagos.get(f.id);
    const dia = Math.min(Math.max(f.dia_vencimiento, 1), ultimoDia);
    const vencimiento = `${mes}-${String(dia).padStart(2, "0")}`;
    const registrada = !!p;
    return {
      id: f.id, categoria: f.categoria, descripcion: f.descripcion, sucursal_id: f.sucursal_id,
      estimado: redondearMoneda(f.monto_estimado), pagado: redondearMoneda(p?.monto ?? 0), pagos: p?.cantidad ?? 0,
      registrada, vencimiento, vencida: !registrada && hoy > vencimiento,
    };
  }).filter((i) => !desde || i.registrada || i.vencimiento >= desde)
    .sort((a, b) => (a.vencimiento === b.vencimiento ? a.descripcion.localeCompare(b.descripcion) : a.vencimiento.localeCompare(b.vencimiento)));

  const sinRegistrar = items.filter((i) => !i.registrada);
  return {
    items,
    pendiente:     redondearMoneda(sinRegistrar.reduce((s, i) => s + i.estimado, 0)),
    sinRegistrar:  sinRegistrar.length,
    registrado:    redondearMoneda(items.reduce((s, i) => s + i.pagado, 0)),
    estimadoTotal: redondearMoneda(items.reduce((s, i) => s + i.estimado, 0)),
  };
}

// «Tengo menos debo»: el efectivo en mano menos lo que se le debe a proveedores y las obligaciones del mes que todavía no se
// registraron. «Tengo» es el efectivo de Tesorería más lo disponible en Mercado Pago (sin el saldo inicial cargado vale cero). No incluye bancos.
export function tengoMenosDebo(p: { efectivo: number; mpDisponible?: number; deudaProveedores: number; obligacionesPendientes: number }): number {
  return redondearMoneda(p.efectivo + (p.mpDisponible ?? 0) - p.deudaProveedores - p.obligacionesPendientes);
}
