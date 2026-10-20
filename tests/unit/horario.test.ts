import { describe, it, expect } from "vitest";
import { estadoHorario, normalizarHorario, validarHorario, type TramoHorario } from "@/lib/pedidos/horario";

// Argentina = UTC-3 fijo. Lunes 2026-09-21.
const lunesAR = (hhmm: string) => new Date(`2026-09-21T${hhmm}:00-03:00`);
const martesAR = (hhmm: string) => new Date(`2026-09-22T${hhmm}:00-03:00`);

const LUN_8_a_0030: TramoHorario[] = [{ dia: 1, abre: "08:00", cierra: "00:30" }];

describe("estadoHorario", () => {
  it("sin horario cargado siempre está abierto", () => {
    expect(estadoHorario(null).abierto).toBe(true);
    expect(estadoHorario([]).abierto).toBe(true);
  });
  it("antes de abrir: cerrado y avisa cuándo abre", () => {
    const e = estadoHorario(LUN_8_a_0030, lunesAR("07:59"));
    expect(e.abierto).toBe(false);
    expect(e.proximaApertura).toBe("hoy a las 8:00");
  });
  it("dentro del horario: abierto", () => {
    expect(estadoHorario(LUN_8_a_0030, lunesAR("15:00")).abierto).toBe(true);
  });
  it("tramo que cruza medianoche: sigue abierto la madrugada del día siguiente", () => {
    expect(estadoHorario(LUN_8_a_0030, martesAR("00:15")).abierto).toBe(true);
    expect(estadoHorario(LUN_8_a_0030, martesAR("00:30")).abierto).toBe(false);
  });
  it("hoyTexto muestra 'Hoy cerrado' si no hay tramo ese día", () => {
    expect(estadoHorario(LUN_8_a_0030, martesAR("12:00")).hoyTexto).toBe("Hoy cerrado");
  });
  it("próxima apertura en otro día usa el nombre del día", () => {
    expect(estadoHorario(LUN_8_a_0030, martesAR("12:00")).proximaApertura).toBe("el lunes a las 8:00");
  });
});

describe("normalizarHorario", () => {
  it("descarta tramos inválidos y devuelve null si no queda ninguno", () => {
    expect(normalizarHorario("basura")).toBeNull();
    expect(normalizarHorario([{ dia: 9, abre: "08:00", cierra: "12:00" }])).toBeNull();
    expect(normalizarHorario([{ dia: 1, abre: "8am", cierra: "12:00" }])).toBeNull();
  });
  it("conserva los tramos válidos", () => {
    expect(normalizarHorario([{ dia: 1, abre: "08:00", cierra: "12:00" }, { dia: 99, abre: "x", cierra: "y" }])).toHaveLength(1);
  });
});

describe("turno partido (dos horarios el mismo día)", () => {
  const PARTIDO: TramoHorario[] = [
    { dia: 1, abre: "08:00", cierra: "12:00" },
    { dia: 1, abre: "16:00", cierra: "20:00" },
  ];
  it("abierto en cada turno y cerrado en el descanso del mediodía", () => {
    expect(estadoHorario(PARTIDO, lunesAR("09:00")).abierto).toBe(true);
    expect(estadoHorario(PARTIDO, lunesAR("14:00")).abierto).toBe(false);
    expect(estadoHorario(PARTIDO, lunesAR("17:00")).abierto).toBe(true);
    expect(estadoHorario(PARTIDO, lunesAR("20:00")).abierto).toBe(false);
  });
  it("en el descanso avisa que reabre a la tarde, no mañana", () => {
    expect(estadoHorario(PARTIDO, lunesAR("14:00")).proximaApertura).toBe("hoy a las 16:00");
  });
  it("hoyTexto muestra los dos turnos en orden", () => {
    expect(estadoHorario(PARTIDO, lunesAR("09:00")).hoyTexto).toBe("Hoy 8:00 – 12:00 y 16:00 – 20:00");
    expect(estadoHorario([...PARTIDO].reverse(), lunesAR("09:00")).hoyTexto).toBe("Hoy 8:00 – 12:00 y 16:00 – 20:00");
  });
  it("después del último turno la próxima apertura es otro día", () => {
    expect(estadoHorario([...PARTIDO, { dia: 2, abre: "08:00", cierra: "12:00" }], lunesAR("21:00")).proximaApertura).toBe("mañana a las 8:00");
  });
  it("el último turno puede cruzar la medianoche", () => {
    const h: TramoHorario[] = [{ dia: 1, abre: "08:00", cierra: "12:00" }, { dia: 1, abre: "18:00", cierra: "00:30" }];
    expect(estadoHorario(h, martesAR("00:15")).abierto).toBe(true);
    expect(validarHorario(h)).toBeNull();
  });
});

describe("validarHorario", () => {
  it("un horario simple o un turno partido correcto es válido", () => {
    expect(validarHorario([{ dia: 1, abre: "08:00", cierra: "20:00" }])).toBeNull();
    expect(validarHorario([{ dia: 1, abre: "08:00", cierra: "12:00" }, { dia: 1, abre: "16:00", cierra: "20:00" }])).toBeNull();
  });
  it("dos horarios que se pisan no son válidos", () => {
    expect(validarHorario([{ dia: 1, abre: "08:00", cierra: "13:00" }, { dia: 1, abre: "12:00", cierra: "20:00" }])).toMatch(/Lunes: dos horarios se pisan/);
  });
  it("solo el último horario del día puede cruzar la medianoche", () => {
    expect(validarHorario([{ dia: 3, abre: "20:00", cierra: "02:00" }, { dia: 3, abre: "21:00", cierra: "23:00" }])).toMatch(/Miércoles: solo el último/);
  });
  it("abrir y cerrar a la misma hora no es válido", () => {
    expect(validarHorario([{ dia: 0, abre: "08:00", cierra: "08:00" }])).toMatch(/Domingo: .*misma hora/);
  });
});
