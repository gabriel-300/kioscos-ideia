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
