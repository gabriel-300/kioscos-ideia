import { describe, it, expect } from "vitest";
import { sugerirLocalMasCercano, verificarAlcance, type LocalCerca } from "@/lib/pedidos/alcance-envio";

// Puntos reales de Posadas: UNAM (campus, ruta 12) y Costanera.
const UNAM = { lat: -27.43542, lng: -55.887476 };
const COSTANERA = { lat: -27.378595, lng: -55.887861 };
const locales: LocalCerca[] = [
  { id: "unam", slug: "unam", nombre: "Angiru Food UNAM", latitud: UNAM.lat, longitud: UNAM.lng },
  { id: "costanera", slug: "costanera", nombre: "Angiru Food Costanera", latitud: COSTANERA.lat, longitud: COSTANERA.lng },
];

describe("verificarAlcance (envío)", () => {
  it("dentro del radio de la zona, pasa", () => {
    expect(verificarAlcance({ lat: -27.4360, lng: -55.8880 }, UNAM, 1.5, "Campus UNAM")).toEqual({ ok: true });
  });
  it("fuera del radio, rechaza con un mensaje claro (distancia y alcance)", () => {
    const r = verificarAlcance(COSTANERA, UNAM, 1.5, "Campus UNAM");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.km).toBeGreaterThan(6);
      expect(r.mensaje).toMatch(/Esa ubicación está a 6,\d km del local/);
      expect(r.mensaje).toMatch(/"Campus UNAM" llega hasta 1,5 km/);
      expect(r.mensaje).toMatch(/pedí para retirar/);
    }
  });
  it("sin radio cargado, o sin coordenadas del local, no hay nada que medir y pasa", () => {
    expect(verificarAlcance(COSTANERA, UNAM, null, "Z")).toEqual({ ok: true });
    expect(verificarAlcance(COSTANERA, null, 1.5, "Z")).toEqual({ ok: true });
    expect(verificarAlcance(COSTANERA, UNAM, 0, "Z")).toEqual({ ok: true });
    expect(verificarAlcance(COSTANERA, UNAM, -2, "Z")).toEqual({ ok: true });
  });
  it("un punto inválido no se juzga (lo rechaza otra validación)", () => {
    expect(verificarAlcance({ lat: Number.NaN, lng: 0 }, UNAM, 1.5, "Z")).toEqual({ ok: true });
  });
  it("justo en el límite pasa", () => {
    expect(verificarAlcance(UNAM, UNAM, 0.1, "Z")).toEqual({ ok: true });
  });
});

describe("sugerirLocalMasCercano", () => {
  it("si el cliente está junto a la Costanera y eligió la UNAM, sugiere la Costanera", () => {
    const s = sugerirLocalMasCercano({ lat: -27.3790, lng: -55.8880 }, "unam", locales);
    expect(s?.local.id).toBe("costanera");
    expect(s!.km).toBeLessThan(0.5);
    expect(s!.kmActual).toBeGreaterThan(6);
  });
  it("si ya eligió el más cercano, no sugiere nada", () => {
    expect(sugerirLocalMasCercano({ lat: -27.3790, lng: -55.8880 }, "costanera", locales)).toBeNull();
  });
  it("si la diferencia es chica (menos del margen), no molesta", () => {
    // equidistante entre los dos: la diferencia es casi cero
    const medio = { lat: (UNAM.lat + COSTANERA.lat) / 2, lng: -55.8877 };
    expect(sugerirLocalMasCercano(medio, "unam", locales)).toBeNull();
    expect(sugerirLocalMasCercano(medio, "costanera", locales)).toBeNull();
  });
  it("un solo local, un local sin coordenadas o un punto inválido: no sugiere", () => {
    expect(sugerirLocalMasCercano(COSTANERA, "unam", [locales[0]])).toBeNull();
    expect(sugerirLocalMasCercano(COSTANERA, "unam", [locales[0], { ...locales[1], latitud: null, longitud: null }])).toBeNull();
    expect(sugerirLocalMasCercano({ lat: Number.NaN, lng: 0 }, "unam", locales)).toBeNull();
    expect(sugerirLocalMasCercano(COSTANERA, "no-existe", locales)).toBeNull();
  });
});
