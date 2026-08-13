const TZ = "America/Argentina/Buenos_Aires";

export function fmtFecha(
  date: string | Date,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(date).toLocaleString("es-AR", { timeZone: TZ, ...opts });
}

export function fmtFechaSolo(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-AR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

export function fmtFechaLarga(date: string | Date): string {
  return new Date(date).toLocaleDateString("es-AR", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

export function fmtFechaHora(date: string | Date): string {
  return new Date(date).toLocaleString("es-AR", {
    timeZone: TZ, day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtHora(date: string | Date): string {
  return new Date(date).toLocaleString("es-AR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
}

/** Retorna la fecha actual en zona Argentina */
export function ahoraAR(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

/**
 * Fecha de "hoy" (o de cualquier instante) en formato YYYY-MM-DD, según el
 * calendario de Argentina — NO usar `new Date().toISOString().slice(0, 10)`
 * para esto: toISOString() siempre da la fecha en UTC, así que entre las
 * 21:00 y las 23:59 hora Argentina ya cae en el día siguiente en UTC,
 * guardando/filtrando movimientos con la fecha equivocada.
 */
export function fechaHoyAR(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
}

/** Primer día del mes de `date` (o de hoy), en formato YYYY-MM-DD, según Argentina. */
export function primerDiaMesAR(date: Date = new Date()): string {
  return `${fechaHoyAR(date).slice(0, 7)}-01`;
}

/**
 * Hora del día (0-23) de cualquier instante según el calendario de Argentina --
 * mismo motivo que fechaHoyAR: el runtime de Cloudflare Workers corre en UTC,
 * así que `date.getHours()` da la hora de Londres, no la de Argentina.
 */
export function horaNumAR(date: Date = new Date()): number {
  // hourCycle "h23" explícito -- con hour12:false algunos motores igual
  // devuelven "24" para la medianoche en vez de "0" (h11/h12 de fondo).
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(date));
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;

/**
 * Día de la semana de "hoy" (o de cualquier instante) según el calendario de
 * Argentina, sin acentos ('lunes'..'domingo') -- mismos valores que el check
 * de products.dia_pedido. Se resuelve vía weekday en inglés (en-US) para no
 * depender de parsear nombres localizados con acentos.
 */
export function diaSemanaHoyAR(date: Date = new Date()): typeof DIAS_SEMANA[number] {
  return DIAS_SEMANA[diaSemanaIdxAR(date)];
}

/** Índice de día de semana (0=domingo..6=sábado) de cualquier instante, según Argentina. */
export function diaSemanaIdxAR(date: Date = new Date()): number {
  const en = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(en);
  return idx === -1 ? 0 : idx;
}
