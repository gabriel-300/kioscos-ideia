// Horario de atención de pedidos online (sucursales.horario_pedidos). Puro,
// sin dependencias de servidor ni de Next -- se usa tanto en el Server
// Component (para el primer render) como en el cliente (para que el estado
// "abierto/cerrado" se actualice solo mientras la página está abierta).
//
// Argentina no usa horario de verano (UTC-3 todo el año), por eso alcanza con
// restar 3 horas fijas en vez de depender de Intl/zonas horarias.

export type TramoHorario = { dia: number; abre: string; cierra: string }; // dia: 0 = domingo

export type EstadoHorario = {
  abierto: boolean;
  hoyTexto: string | null;        // "Hoy 8:00 – 00:30" / "Hoy cerrado" / null si no hay horario cargado
  proximaApertura: string | null; // "hoy a las 8:00" / "mañana a las 8:00" / "el lunes a las 8:00"
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

// "08:00" -> "8:00", pero la madrugada se deja como "00:30" (así lo pide el diseño).
function formatear(hhmm: string): string {
  const [h, m] = hhmm.split(":");
  const hora = parseInt(h, 10);
  return `${hora === 0 ? "00" : hora}:${m ?? "00"}`;
}

export function normalizarHorario(raw: unknown): TramoHorario[] | null {
  if (!Array.isArray(raw)) return null;
  const tramos = raw.filter(
    (t): t is TramoHorario =>
      !!t && typeof t === "object" &&
      Number.isInteger((t as TramoHorario).dia) && (t as TramoHorario).dia >= 0 && (t as TramoHorario).dia <= 6 &&
      /^\d{1,2}:\d{2}$/.test((t as TramoHorario).abre) && /^\d{1,2}:\d{2}$/.test((t as TramoHorario).cierra)
  );
  return tramos.length > 0 ? tramos : null;
}

export function estadoHorario(horario: TramoHorario[] | null, ahora: Date = new Date()): EstadoHorario {
  if (!horario || horario.length === 0) return { abierto: true, hoyTexto: null, proximaApertura: null };

  const local = new Date(ahora.getTime() - 3 * 60 * 60 * 1000);
  const hoy = local.getUTCDay();
  const ayer = (hoy + 6) % 7;
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();

  const tramosHoy = horario.filter((t) => t.dia === hoy);
  const tramosAyer = horario.filter((t) => t.dia === ayer);

  let abierto = false;
  for (const t of tramosHoy) {
    const a = aMinutos(t.abre), c = aMinutos(t.cierra);
    if (c > a ? minutos >= a && minutos < c : minutos >= a) abierto = true; // cruza medianoche: abierto hasta el final del día
  }
  for (const t of tramosAyer) {
    const a = aMinutos(t.abre), c = aMinutos(t.cierra);
    if (c <= a && minutos < c) abierto = true; // el tramo de ayer que cruzó la medianoche
  }

  const hoyTexto = tramosHoy.length === 0
    ? "Hoy cerrado"
    : "Hoy " + tramosHoy
        .slice()
        .sort((x, y) => aMinutos(x.abre) - aMinutos(y.abre))
        .map((t) => `${formatear(t.abre)} – ${formatear(t.cierra)}`)
        .join(" y ");

  let proximaApertura: string | null = null;
  if (!abierto) {
    for (let offset = 0; offset <= 7 && !proximaApertura; offset++) {
      const dia = (hoy + offset) % 7;
      const candidatos = horario
        .filter((t) => t.dia === dia && (offset > 0 || aMinutos(t.abre) > minutos))
        .sort((x, y) => aMinutos(x.abre) - aMinutos(y.abre));
      if (candidatos.length > 0) {
        const cuando = offset === 0 ? "hoy" : offset === 1 ? "mañana" : `el ${DIAS[dia]}`;
        proximaApertura = `${cuando} a las ${formatear(candidatos[0].abre)}`;
      }
    }
  }

  return { abierto, hoyTexto, proximaApertura };
}
