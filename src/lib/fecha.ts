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
