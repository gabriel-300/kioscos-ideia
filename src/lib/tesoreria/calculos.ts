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
}): { efectivo: number; sobres: number; salidas: number } {
  const sobres  = redondearMoneda(p.sobresRecibidos.reduce((s, c) => s + montoSobre(c), 0));
  const salidas = redondearMoneda(p.egresos.filter((e) => e.origen === "efectivo_tesoreria").reduce((s, e) => s + e.monto, 0));
  return { efectivo: redondearMoneda(p.efectivoInicial + sobres - salidas), sobres, salidas };
}
