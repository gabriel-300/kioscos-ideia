// Prueba de conexión con ARCA, SOLO LECTURA: pide (o reutiliza) el ticket de acceso, lista los puntos de venta
// habilitados y consulta el último comprobante de cada uno. No emite nada ni gasta numeración.
// Sirve para confirmar, sin riesgo, que el certificado, la relación con el servicio de facturación y la red
// desde donde corre la app (Cloudflare) funcionan, y que el punto de venta de cada sucursal es el correcto.

import { ArcaError, puntosDeVenta, ultimoAutorizado, type Ambiente } from "./cliente";
import { obtenerTicket } from "./ticket";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type EmisorAProbar = { id: string; cuit: string; razon_social: string; ambiente: Ambiente };
export type SucursalAProbar = { nombre: string; arca_emisor_id: string | null; arca_punto_venta: number | null; arca_modo: string };

export type PuntoVentaProbado = {
  nro: number; emision: string; bloqueado: boolean; baja: boolean;
  ultimaFacturaB: number | null; ultimaFacturaA: number | null; ultimaFacturaARet: number | null; error?: string;
};

export type PruebaEmisor = {
  emisorId: string; razonSocial: string; cuit: string; ambiente: Ambiente;
  ticket: { ok: boolean; ms: number; vence?: string; error?: string };
  puntosVenta: PuntoVentaProbado[];
  errorPuntosVenta?: string;
  sucursales: { nombre: string; puntoVenta: number | null; estado: "ok" | "no_habilitado" | "bloqueado" | "sin_punto"; detalle: string }[];
};

const mensaje = (e: unknown) => (e instanceof ArcaError || e instanceof Error ? e.message : String(e));

export async function probarEmisor(db: Db, emisor: EmisorAProbar, sucursales: SucursalAProbar[]): Promise<PruebaEmisor> {
  const base: PruebaEmisor = {
    emisorId: emisor.id, razonSocial: emisor.razon_social, cuit: emisor.cuit, ambiente: emisor.ambiente,
    ticket: { ok: false, ms: 0 }, puntosVenta: [], sucursales: [],
  };

  const t0 = Date.now();
  let ticket;
  try {
    ticket = await obtenerTicket(db, emisor.ambiente);
    base.ticket = { ok: true, ms: Date.now() - t0, vence: ticket.expiraEn.toISOString() };
  } catch (e) {
    base.ticket = { ok: false, ms: Date.now() - t0, error: mensaje(e) };
    return base; // sin ticket no se puede seguir
  }

  const auth = { ticket, cuit: emisor.cuit };
  try {
    const pvs = await puntosDeVenta(emisor.ambiente, auth);
    for (const pv of pvs) {
      const p: PuntoVentaProbado = { nro: pv.nro, emision: pv.emision, bloqueado: pv.bloqueado, baja: pv.baja, ultimaFacturaB: null, ultimaFacturaA: null, ultimaFacturaARet: null };
      if (!pv.bloqueado && !pv.baja) {
        try { p.ultimaFacturaB = await ultimoAutorizado(emisor.ambiente, auth, pv.nro, 6); } catch (e) { p.error = mensaje(e); }
        try { p.ultimaFacturaA = await ultimoAutorizado(emisor.ambiente, auth, pv.nro, 1); } catch (e) { p.error = p.error ?? mensaje(e); }
        try { p.ultimaFacturaARet = await ultimoAutorizado(emisor.ambiente, auth, pv.nro, 51); } catch (e) { p.error = p.error ?? mensaje(e); }
      }
      base.puntosVenta.push(p);
    }
  } catch (e) {
    base.errorPuntosVenta = mensaje(e);
  }

  // ¿El punto de venta que tiene cargado cada sucursal sirve para facturar?
  for (const s of sucursales.filter((x) => x.arca_emisor_id === emisor.id)) {
    if (!s.arca_punto_venta) {
      base.sucursales.push({ nombre: s.nombre, puntoVenta: null, estado: "sin_punto", detalle: "No tiene punto de venta cargado." });
      continue;
    }
    const pv = base.puntosVenta.find((p) => p.nro === s.arca_punto_venta);
    if (!pv) {
      base.sucursales.push({ nombre: s.nombre, puntoVenta: s.arca_punto_venta, estado: "no_habilitado",
        detalle: base.errorPuntosVenta ? "No se pudo verificar (ARCA no respondió la lista de puntos de venta)." : "ARCA no lo tiene habilitado para facturar por sistema (¿es de «Factura en línea»?)." });
    } else if (pv.bloqueado || pv.baja) {
      base.sucursales.push({ nombre: s.nombre, puntoVenta: pv.nro, estado: "bloqueado", detalle: pv.baja ? "Está dado de baja en ARCA." : "Está bloqueado en ARCA." });
    } else {
      base.sucursales.push({ nombre: s.nombre, puntoVenta: pv.nro, estado: "ok", detalle: `Habilitado (${pv.emision}).` });
    }
  }
  return base;
}
