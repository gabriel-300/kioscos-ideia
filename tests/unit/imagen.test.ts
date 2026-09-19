import { describe, it, expect } from "vitest";
import { escalarA, LADO_MAX_PX } from "@/lib/imagen";

// La parte pura de la reducción de imágenes (la codificación usa canvas y solo corre en el navegador).
describe("escalarA", () => {
  it("no toca una imagen que ya entra en el máximo, y nunca agranda", () => {
    expect(escalarA(800, 600)).toEqual({ ancho: 800, alto: 600 });
    expect(escalarA(LADO_MAX_PX, LADO_MAX_PX)).toEqual({ ancho: LADO_MAX_PX, alto: LADO_MAX_PX });
    expect(escalarA(50, 40)).toEqual({ ancho: 50, alto: 40 });
  });

  it("reduce el lado mayor al máximo manteniendo la proporción", () => {
    expect(escalarA(4000, 3000)).toEqual({ ancho: 1000, alto: 750 });
    expect(escalarA(3000, 4000)).toEqual({ ancho: 750, alto: 1000 });
    expect(escalarA(2000, 2000, 500)).toEqual({ ancho: 500, alto: 500 });
  });

  it("nunca devuelve un lado en cero (imágenes muy alargadas)", () => {
    expect(escalarA(20000, 3)).toEqual({ ancho: 1000, alto: 1 });
  });

  it("propiedad: el resultado siempre entra en el máximo y conserva la proporción (±1 px)", () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 200; n++) {
      const a = 1 + Math.floor(rnd() * 8000);
      const b = 1 + Math.floor(rnd() * 8000);
      const r = escalarA(a, b);
      expect(Math.max(r.ancho, r.alto)).toBeLessThanOrEqual(LADO_MAX_PX);
      // La proporción solo se compara cuando el lado menor escalado tiene >= 50 px: con menos, el redondeo a
      // píxel entero mueve la proporción más de 1% y no es un defecto.
      if (Math.max(a, b) > LADO_MAX_PX && Math.min(a, b) * LADO_MAX_PX / Math.max(a, b) >= 50) {
        expect(Math.abs(r.ancho / r.alto - a / b) / (a / b)).toBeLessThan(0.02);
      }
    }
  });
});
