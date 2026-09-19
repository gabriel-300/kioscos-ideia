import { describe, it, expect } from "vitest";
import { estadoHorario, normalizarHorario, type TramoHorario } from "@/lib/pedidos/horario";

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
