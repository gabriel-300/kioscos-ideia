import { describe, it, expect } from "vitest";
import {
  armarPausa, DISPONIBILIDAD_NORMAL, estadoEnvios, estadoPedidos, leerDisponibilidadOnline, normalizarDisponibilidad, normalizarPausa, pausaVigente,
  type DisponibilidadOnline,
} from "@/lib/pedidos/disponibilidad-online";
import { resumenHorario } from "@/lib/pedidos/horario";
import { fakeAdmin } from "../helpers/fake-supabase";

// Argentina = UTC-3 fijo. Lunes 2026-09-21.
const lunesAR = (hhmm: string) => new Date(`2026-09-21T${hhmm}:00-03:00`);
const ENVIOS_TARDE = [{ dia: 1, abre: "18:00", cierra: "21:00" }];
const con = (over: Partial<DisponibilidadOnline>): DisponibilidadOnline => ({ ...DISPONIBILIDAD_NORMAL, ...over });
const pausa = (hasta: string | null, motivo: string | null = "Sin repartidor") => ({ motivo, desde: "2026-09-21T10:00:00-03:00", hasta, por: "u1" });

describe("pausaVigente / estadoPedidos", () => {
  it("sin fin vale hasta que la reactiven; con fin, hasta ese momento", () => {
    expect(pausaVigente(pausa(null), lunesAR("12:00"))).toBe(true);
    expect(pausaVigente(pausa("2026-09-21T13:00:00-03:00"), lunesAR("12:00"))).toBe(true);
    expect(pausaVigente(pausa("2026-09-21T13:00:00-03:00"), lunesAR("13:00"))).toBe(false);
    expect(pausaVigente(null)).toBe(false);
  });
  it("pedidos pausados con su motivo", () => {
    const d = con({ pausas: { envios: null, pedidos: pausa(null, "Mucha demanda") } });
    expect(estadoPedidos(d, lunesAR("12:00"))).toEqual({ pausado: true, motivo: "Mucha demanda", hasta: null });
    expect(estadoPedidos(DISPONIBILIDAD_NORMAL).pausado).toBe(false);
  });
});

describe("estadoEnvios", () => {
  it("sin horario propio ni pausas, hay envío (sigue al local)", () => {
    expect(estadoEnvios(DISPONIBILIDAD_NORMAL, lunesAR("12:00"))).toMatchObject({ disponible: true, razon: null });
  });
  it("con horario propio: solo dentro de la franja, y avisa cuándo vuelve", () => {
    const d = con({ horarioEnvios: ENVIOS_TARDE });
    expect(estadoEnvios(d, lunesAR("19:00"))).toMatchObject({ disponible: true, etiqueta: "Envíos hoy 18:00 – 21:00" });
    const fuera = estadoEnvios(d, lunesAR("12:00"));
    expect(fuera).toMatchObject({ disponible: false, razon: "fuera_de_horario" });
    expect(fuera.mensaje).toMatch(/Ahora podés pedir para retirar en el local\. Envíos: lunes de 18 a 21\./);
    expect(fuera.mensaje).toMatch(/retirar/);
  });
  it("una pausa de envíos lo corta aunque esté en horario, y muestra el motivo", () => {
    const d = con({ horarioEnvios: ENVIOS_TARDE, pausas: { envios: pausa(null, "Lluvia fuerte"), pedidos: null } });
    const e = estadoEnvios(d, lunesAR("19:00"));
    expect(e).toMatchObject({ disponible: false, razon: "pausa_envios" });
    expect(e.mensaje).toBe("Los envíos están en pausa (Lluvia fuerte). Podés pedir para retirar en el local.");
  });
  it("la pausa vencida ya no corta nada", () => {
    const d = con({ pausas: { envios: pausa("2026-09-21T11:00:00-03:00"), pedidos: null } });
    expect(estadoEnvios(d, lunesAR("12:00")).disponible).toBe(true);
  });
  it("pausar todos los pedidos también corta el envío y manda sobre lo demás", () => {
    const d = con({ pausas: { envios: pausa(null), pedidos: pausa(null, "Cerramos antes") } });
    expect(estadoEnvios(d, lunesAR("12:00"))).toMatchObject({ disponible: false, razon: "pausa_pedidos" });
  });
});

describe("normalizar y guardar", () => {
  it("normalizarPausa descarta lo roto y limpia el motivo", () => {
    expect(normalizarPausa(null)).toBeNull();
    expect(normalizarPausa({ motivo: "x" })).toBeNull(); // sin "desde" no vale
    expect(normalizarPausa({ desde: "2026-09-21T10:00:00Z", hasta: "basura", motivo: "  Sin   repartidor  " })).toEqual({
      motivo: "Sin repartidor", desde: "2026-09-21T10:00:00Z", hasta: null, por: null,
    });
    expect(normalizarPausa({ desde: "2026-09-21T10:00:00Z", motivo: "z".repeat(200) })!.motivo).toHaveLength(80);
  });
  it("normalizarDisponibilidad: horario inválido = sin horario propio", () => {
    expect(normalizarDisponibilidad("basura", {}).horarioEnvios).toBeNull();
    expect(normalizarDisponibilidad(ENVIOS_TARDE, undefined).pausas).toEqual({ envios: null, pedidos: null });
  });
  it("armarPausa calcula el fin según la duración (null = hasta que la reactiven)", () => {
    const ahora = new Date("2026-09-21T15:00:00Z");
    expect(armarPausa("Mucha demanda", 60, "u1", ahora)).toEqual({ motivo: "Mucha demanda", desde: ahora.toISOString(), hasta: "2026-09-21T16:00:00.000Z", por: "u1" });
    expect(armarPausa("  ", null, null, ahora)).toMatchObject({ motivo: null, hasta: null });
  });
});

describe("leerDisponibilidadOnline", () => {
  it("lee el horario y las pausas de la sucursal", async () => {
    const f = fakeAdmin(() => ({ data: { horario_envios: ENVIOS_TARDE, pausas_online: { envios: pausa(null) } } }));
    const d = await leerDisponibilidadOnline(f.admin, "s1");
    expect(d.horarioEnvios).toEqual(ENVIOS_TARDE);
    expect(d.pausas.envios?.motivo).toBe("Sin repartidor");
  });
  it("sin la migración (error de columna) todo sigue normal", async () => {
    const f = fakeAdmin(() => ({ error: { message: "column horario_envios does not exist" } }));
    expect(await leerDisponibilidadOnline(f.admin, "s1")).toEqual(DISPONIBILIDAD_NORMAL);
  });
});

describe("resumenHorario", () => {
  const dias = (ds: number[], abre: string, cierra: string) => ds.map((dia) => ({ dia, abre, cierra }));
  it("lunes a viernes seguidos, mismo horario", () => {
    expect(resumenHorario(dias([1, 2, 3, 4, 5], "09:00", "13:00"))).toBe("lunes a viernes de 9 a 13");
  });
  it("todos los días, y minutos solo cuando no son :00", () => {
    expect(resumenHorario(dias([0, 1, 2, 3, 4, 5, 6], "07:00", "19:30"))).toBe("todos los días de 7 a 19:30");
  });
  it("días sueltos, turnos partidos y horarios distintos", () => {
    expect(resumenHorario(dias([2, 5], "10:00", "14:00"))).toBe("martes y viernes de 10 a 14");
    expect(resumenHorario([{ dia: 1, abre: "09:00", cierra: "13:00" }, { dia: 1, abre: "17:00", cierra: "21:00" }])).toBe("lunes de 9 a 13 y de 17 a 21");
    expect(resumenHorario([{ dia: 1, abre: "09:00", cierra: "13:00" }, { dia: 2, abre: "10:00", cierra: "14:00" }])).toBe("lunes de 9 a 13 y martes de 10 a 14");
    expect(resumenHorario(null)).toBeNull();
  });
});

describe("resumenHorario: horarios distintos por día (el caso real de la UNAM)", () => {
  const dias = (ds: number[], abre: string, cierra: string) => ds.map((dia) => ({ dia, abre, cierra }));
  it("agrupa los días seguidos con el mismo horario", () => {
    const unam = [...dias([1, 2, 3, 4], "09:00", "13:00"), ...dias([5], "09:00", "22:00")];
    expect(resumenHorario(unam)).toBe("lunes a jueves de 9 a 13 y viernes de 9 a 22");
  });
  it("tres o más tramos se separan con comas, y los días no seguidos no se juntan", () => {
    expect(resumenHorario([...dias([1, 2, 3], "08:00", "12:00"), ...dias([4], "09:00", "13:00"), ...dias([6], "10:00", "14:00")]))
      .toBe("lunes a miércoles de 8 a 12, jueves de 9 a 13 y sábado de 10 a 14");
    expect(resumenHorario([...dias([1], "09:00", "13:00"), ...dias([3], "09:00", "13:00")])).toBe("lunes y miércoles de 9 a 13");
  });
  it("con demasiados tramos distintos no hay frase corta", () => {
    const muchos = [1, 2, 3, 4, 5].map((dia, i) => ({ dia, abre: `0${i + 6}:00`, cierra: "20:00" }));
    expect(resumenHorario(muchos)).toBeNull();
  });
  it("el mensaje del cliente arranca por lo que sí puede hacer", () => {
    const unam = [...dias([1, 2, 3, 4], "09:00", "13:00"), ...dias([5], "09:00", "22:00")];
    const d = { ...DISPONIBILIDAD_NORMAL, horarioEnvios: unam };
    const lunes15 = new Date("2026-10-26T18:00:00Z"); // lunes 15:00 en Argentina: fuera del envío
    const e = estadoEnvios(d, lunes15);
    expect(e.disponible).toBe(false);
    expect(e.mensaje).toBe("Ahora podés pedir para retirar en el local. Envíos: lunes a jueves de 9 a 13 y viernes de 9 a 22.");
    expect(e.mensaje).not.toMatch(/no hacemos/i);
  });
});
