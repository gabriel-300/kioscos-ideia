import { describe, it, expect } from "vitest";
import { coordenadasValidas, redondearCoordenada, urlMapa } from "@/lib/pedidos/ubicacion";

describe("ubicación de entrega", () => {
  it("acepta un punto real (Posadas)", () => {
    expect(coordenadasValidas(-27.3671, -55.8961)).toBe(true);
  });
  it("rechaza fuera de rango, no numéricos y 0,0 (GPS caído)", () => {
    expect(coordenadasValidas(91, 0)).toBe(false);
    expect(coordenadasValidas(0, 181)).toBe(false);
    expect(coordenadasValidas(Number.NaN, 10)).toBe(false);
    expect(coordenadasValidas("-27", "-55")).toBe(false);
    expect(coordenadasValidas(null, null)).toBe(false);
    expect(coordenadasValidas(0, 0)).toBe(false);
  });
  it("redondea a 6 decimales", () => {
    expect(redondearCoordenada(-27.36712345678)).toBe(-27.367123);
  });
  it("el enlace abre Google Maps en ese punto", () => {
    expect(urlMapa(-27.3671, -55.8961)).toBe("https://www.google.com/maps/search/?api=1&query=-27.3671,-55.8961");
  });
});
