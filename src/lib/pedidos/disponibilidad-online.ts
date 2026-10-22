import type { createAdminClient } from "@/lib/supabase/server";
import { estadoHorario, normalizarHorario, type TramoHorario } from "./horario";

// Cuándo se pueden pedir envíos y pedidos online: el horario de envíos (aparte del del local) y las pausas
// temporales que el personal prende desde Tenteo con un motivo (migración 122). Puro, salvo la lectura de la
// base, que es "mejor esfuerzo": sin la migración o si falla, no hay horario propio ni pausas y todo sigue
// como antes.

type Admin = ReturnType<typeof createAdminClient>;

export type Pausa = { motivo: string | null; desde: string; hasta: string | null; por: string | null };
export type PausasOnline = { envios: Pausa | null; pedidos: Pausa | null };
export type DisponibilidadOnline = { horarioEnvios: TramoHorario[] | null; pausas: PausasOnline };

export const SIN_PAUSAS: PausasOnline = { envios: null, pedidos: null };
export const DISPONIBILIDAD_NORMAL: DisponibilidadOnline = { horarioEnvios: null, pausas: SIN_PAUSAS };
export const MAX_MOTIVO = 80;

export function normalizarPausa(crudo: unknown): Pausa | null {
  if (!crudo || typeof crudo !== "object") return null;
  const p = crudo as Record<string, unknown>;
  const desde = typeof p.desde === "string" && Number.isFinite(Date.parse(p.desde)) ? p.desde : null;
  if (!desde) return null;
  const hasta = typeof p.hasta === "string" && Number.isFinite(Date.parse(p.hasta)) ? p.hasta : null;
  const motivo = typeof p.motivo === "string" ? p.motivo.replace(/\s+/g, " ").trim().slice(0, MAX_MOTIVO) : "";
  return { motivo: motivo || null, desde, hasta, por: typeof p.por === "string" ? p.por : null };
}

export function normalizarPausas(crudo: unknown): PausasOnline {
  const o = crudo && typeof crudo === "object" ? (crudo as Record<string, unknown>) : {};
  return { envios: normalizarPausa(o.envios), pedidos: normalizarPausa(o.pedidos) };
}

export function normalizarDisponibilidad(horarioEnvios: unknown, pausas: unknown): DisponibilidadOnline {
  return { horarioEnvios: normalizarHorario(horarioEnvios), pausas: normalizarPausas(pausas) };
}

export async function leerDisponibilidadOnline(admin: Admin, sucursalId: string): Promise<DisponibilidadOnline> {
  try {
    const { data, error } = await (admin as any).from("sucursales").select("horario_envios, pausas_online").eq("id", sucursalId).single();
    if (error || !data) return DISPONIBILIDAD_NORMAL;
    return normalizarDisponibilidad(data.horario_envios, data.pausas_online);
  } catch {
    return DISPONIBILIDAD_NORMAL;
  }
}

// Una pausa sigue en pie si no tiene fin ("hasta que la reactiven") o si el fin todavía no llegó.
export function pausaVigente(p: Pausa | null, ahora: Date = new Date()): p is Pausa {
  return !!p && (p.hasta === null || Date.parse(p.hasta) > ahora.getTime());
}

export type EstadoPedidosOnline = { pausado: boolean; motivo: string | null; hasta: string | null };

export function estadoPedidos(d: DisponibilidadOnline, ahora: Date = new Date()): EstadoPedidosOnline {
  const p = d.pausas.pedidos;
  return pausaVigente(p, ahora) ? { pausado: true, motivo: p.motivo, hasta: p.hasta } : { pausado: false, motivo: null, hasta: null };
}

export type RazonEnvio = "pausa_pedidos" | "pausa_envios" | "fuera_de_horario";
export type EstadoEnvio = {
  disponible: boolean;
  razon:      RazonEnvio | null;
  mensaje:    string | null;  // lo que se le muestra al cliente cuando no hay envío
  etiqueta:   string | null;  // texto corto para el cartel de la cabecera (ej. "Envíos hoy 18:00 – 21:00")
};

// ¿Hay envío ahora? Orden: pausa de todos los pedidos > pausa de envíos > horario de envíos (si tiene uno propio).
// El horario del local (abierto/cerrado) lo controla aparte quien llama: acá solo lo propio del envío.
export function estadoEnvios(d: DisponibilidadOnline, ahora: Date = new Date()): EstadoEnvio {
  const pedidos = estadoPedidos(d, ahora);
  if (pedidos.pausado) {
    return { disponible: false, razon: "pausa_pedidos", mensaje: `Por ahora no estamos tomando pedidos${pedidos.motivo ? `: ${pedidos.motivo}` : ""}`, etiqueta: "Pedidos en pausa" };
  }

  const pausa = d.pausas.envios;
  if (pausaVigente(pausa, ahora)) {
    return {
      disponible: false,
      razon:      "pausa_envios",
      mensaje:    `Envío suspendido por ahora${pausa.motivo ? `: ${pausa.motivo}` : ""}. Podés retirar en el local.`,
      etiqueta:   `Envío suspendido${pausa.motivo ? `: ${pausa.motivo}` : ""}`,
    };
  }

  if (d.horarioEnvios) {
    const h = estadoHorario(d.horarioEnvios, ahora);
    if (!h.abierto) {
      return {
        disponible: false,
        razon:      "fuera_de_horario",
        mensaje:    `Ahora no hacemos envíos${h.proximaApertura ? `; vuelven ${h.proximaApertura}` : ""}. Podés retirar en el local.`,
        etiqueta:   h.hoyTexto ? h.hoyTexto.replace(/^Hoy/, "Envíos hoy") : "Envíos fuera de horario",
      };
    }
    return { disponible: true, razon: null, mensaje: null, etiqueta: h.hoyTexto ? h.hoyTexto.replace(/^Hoy/, "Envíos hoy") : null };
  }

  return { disponible: true, razon: null, mensaje: null, etiqueta: null };
}

// Para guardar una pausa nueva: cuándo termina según la duración elegida (null = hasta que la reactiven).
export function armarPausa(motivo: string, minutos: number | null, por: string | null, ahora: Date = new Date()): Pausa {
  return {
    motivo: motivo.replace(/\s+/g, " ").trim().slice(0, MAX_MOTIVO) || null,
    desde:  ahora.toISOString(),
    hasta:  minutos && minutos > 0 ? new Date(ahora.getTime() + minutos * 60_000).toISOString() : null,
    por,
  };
}

export const DURACIONES_PAUSA: { minutos: number | null; texto: string }[] = [
  { minutos: 30,   texto: "30 minutos" },
  { minutos: 60,   texto: "1 hora" },
  { minutos: 120,  texto: "2 horas" },
  { minutos: 240,  texto: "4 horas" },
  { minutos: null, texto: "Hasta que lo reactive" },
];

export const MOTIVOS_PAUSA_ENVIOS = ["Sin repartidor", "Lluvia fuerte", "Mucha demanda", "Problema con la moto"];
export const MOTIVOS_PAUSA_PEDIDOS = ["Mucha demanda", "Se nos terminó el producto", "Cerramos antes", "Problema en el local"];
