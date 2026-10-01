import { describe, it, expect } from "vitest";
import { haversineKm, formatearDistancia, ordenarPorCercania, parsearCoordenadas, esPuntoValido } from "@/lib/geo";

const obelisco = { lat: -34.6037, lng: -58.3816 };
const plazaMayo = { lat: -34.6083, lng: -58.3712 };

describe("haversineKm", () => {
  it("mismo punto = 0", () => expect(haversineKm(obelisco, obelisco)).toBe(0));
  it("distancia conocida (Buenos Aires – Córdoba ≈ 646 km)", () => {
    const d = haversineKm({ lat: -34.6037, lng: -58.3816 }, { lat: -31.4201, lng: -64.1888 });
    expect(d).toBeGreaterThan(640);
    expect(d).toBeLessThan(655);
  });
  it("es simétrica y corta en el barrio", () => {
    expect(haversineKm(obelisco, plazaMayo)).toBeCloseTo(haversineKm(plazaMayo, obelisco), 9);
    expect(haversineKm(obelisco, plazaMayo)).toBeLessThan(2);
  });
  it("antípodas no da NaN", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeGreaterThan(20000);
  });
});

describe("formatearDistancia", () => {
  it("metros por debajo de 1 km, redondeados a 10", () => {
    expect(formatearDistancia(0.456)).toBe("460 m");
    expect(formatearDistancia(0)).toBe("0 m");
  });
  it("un decimal con coma desde 1 km", () => {
    expect(formatearDistancia(1.234)).toBe("1,2 km");
    expect(formatearDistancia(12)).toBe("12,0 km");
  });
  it("0,999 km no queda como '1000 m'", () => expect(formatearDistancia(0.999)).toBe("1,0 km"));
  it("valores inválidos devuelven vacío", () => {
    expect(formatearDistancia(NaN)).toBe("");
    expect(formatearDistancia(-1)).toBe("");
  });
});

describe("ordenarPorCercania", () => {
  const L = (id: string, latitud: number | null, longitud: number | null) => ({ id, latitud, longitud });
  it("ordena de más cerca a más lejos con la distancia", () => {
    const r = ordenarPorCercania([L("lejos", -31.42, -64.19), L("cerca", -34.608, -58.371)], obelisco);
    expect(r.map((x) => x.local.id)).toEqual(["cerca", "lejos"]);
    expect(r[0].km).toBeLessThan(r[1].km as number);
  });
  it("los que no tienen coordenadas van al final, sin distancia, en su orden", () => {
    const r = ordenarPorCercania([L("a", null, null), L("b", -34.608, -58.371), L("c", null, -58), L("d", -34.6, -58.38)], obelisco);
    expect(r.map((x) => x.local.id)).toEqual(["d", "b", "a", "c"]);
    expect(r[2].km).toBeNull();
    expect(r[3].km).toBeNull();
  });
  it("coordenadas fuera de rango cuentan como sin coordenadas", () => {
    const r = ordenarPorCercania([L("mal", 95, 10), L("bien", -34.6, -58.38)], obelisco);
    expect(r.map((x) => x.local.id)).toEqual(["bien", "mal"]);
  });
  it("empate de distancias: orden estable", () => {
    const r = ordenarPorCercania([L("x", -34.6, -58.38), L("y", -34.6, -58.38), L("z", -34.6, -58.38)], obelisco);
    expect(r.map((x) => x.local.id)).toEqual(["x", "y", "z"]);
  });
  it("mismo punto que un local: distancia 0", () => {
    expect(ordenarPorCercania([L("a", obelisco.lat, obelisco.lng)], obelisco)[0].km).toBe(0);
  });
  it("lista vacía y sin mutar la entrada", () => {
    expect(ordenarPorCercania([], obelisco)).toEqual([]);
    const entrada = [L("lejos", -31.42, -64.19), L("cerca", -34.608, -58.371)];
    ordenarPorCercania(entrada, obelisco);
    expect(entrada[0].id).toBe("lejos");
  });
});

describe("parsearCoordenadas", () => {
  it("formato de Google Maps (coma + espacio)", () => {
    expect(parsearCoordenadas("-27.366512, -55.896423")).toEqual({ ok: true, lat: -27.366512, lng: -55.896423 });
  });
  it("acepta coma sin espacio, espacio solo, punto y coma, y espacios alrededor", () => {
    for (const t of ["-27.3,-55.8", "-27.3 -55.8", "-27.3;-55.8", "  -27.3 ,  -55.8  "]) {
      expect(parsearCoordenadas(t)).toEqual({ ok: true, lat: -27.3, lng: -55.8 });
    }
  });
  it("acepta el signo menos tipográfico y el más explícito", () => {
    expect(parsearCoordenadas("−27.3, +55.8")).toEqual({ ok: true, lat: -27.3, lng: 55.8 });
  });
  it("acepta enteros y los límites exactos", () => {
    expect(parsearCoordenadas("90, -180")).toEqual({ ok: true, lat: 90, lng: -180 });
  });
  it("rechaza fuera de rango", () => {
    expect(parsearCoordenadas("91, 10")).toMatchObject({ ok: false });
    expect(parsearCoordenadas("10, 181")).toMatchObject({ ok: false });
  });
  it("rechaza basura, vacío, un solo número y tres números", () => {
    for (const t of ["", "   ", "hola", "-27.3", "1, 2, 3", "-27.3, abc", "1e5, 2", "NaN, 1", "-27,3, -55,8", "-27.3,"]) {
      expect(parsearCoordenadas(t)).toMatchObject({ ok: false });
    }
  });
  it("no revienta con null/undefined", () => {
    expect(parsearCoordenadas(null as any)).toMatchObject({ ok: false });
    expect(parsearCoordenadas(undefined as any)).toMatchObject({ ok: false });
  });
});

describe("esPuntoValido", () => {
  it("valida tipo y rango", () => {
    expect(esPuntoValido(0, 0)).toBe(true);
    expect(esPuntoValido(null, 1)).toBe(false);
    expect(esPuntoValido("1", 1)).toBe(false);
    expect(esPuntoValido(NaN, 1)).toBe(false);
    expect(esPuntoValido(-91, 1)).toBe(false);
  });
});
