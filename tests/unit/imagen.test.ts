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

import { validarImagen, formatearPeso, REQUISITOS_IMAGEN } from "@/lib/imagen";

describe("validarImagen (regla de subida de imágenes)", () => {
  const ok = { tipo: "image/jpeg", bytes: 200 * 1024, ancho: 1000, alto: 1000 };

  it("acepta una imagen dentro de la regla", () => {
    expect(validarImagen(ok)).toEqual({ ok: true });
    expect(validarImagen({ ...ok, tipo: "image/png" })).toEqual({ ok: true });
    expect(validarImagen({ ...ok, tipo: "image/webp", ancho: 400, alto: 900 })).toEqual({ ok: true });
  });

  it("el caso real que agotó la cuota: un PNG de 2 MB se rechaza por peso", () => {
    const r = validarImagen({ tipo: "image/png", bytes: 2_194_310, ancho: 1200, alto: 1200 });
    expect(r).toEqual({ ok: false, motivos: ["Pesa 2,1 MB y el máximo es 1,0 MB."] });
  });

  it("el límite es exacto: 1 MB pasa, 1 MB + 1 byte no", () => {
    expect(validarImagen({ ...ok, bytes: REQUISITOS_IMAGEN.pesoMaxBytes }).ok).toBe(true);
    expect(validarImagen({ ...ok, bytes: REQUISITOS_IMAGEN.pesoMaxBytes + 1 }).ok).toBe(false);
  });

  it("rechaza formatos que no son JPG, PNG o WebP (GIF, SVG, HEIC, vacío)", () => {
    for (const tipo of ["image/gif", "image/svg+xml", "image/heic", "application/pdf", ""]) {
      const r = validarImagen({ ...ok, tipo });
      expect(r.ok, tipo).toBe(false);
    }
  });

  it("rechaza imágenes muy chicas: el lado más chico tiene que tener al menos 400 px", () => {
    expect(validarImagen({ ...ok, ancho: 399, alto: 2000 }).ok).toBe(false);
    expect(validarImagen({ ...ok, ancho: 2000, alto: 399 }).ok).toBe(false);
    expect(validarImagen({ ...ok, ancho: 400, alto: 400 }).ok).toBe(true);
  });

  it("junta TODOS los motivos, para mostrarlos de una vez en la ventana", () => {
    const r = validarImagen({ tipo: "image/gif", bytes: 5 * 1024 * 1024, ancho: 100, alto: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivos).toHaveLength(3);
  });
});

describe("formatearPeso", () => {
  it("usa KB por debajo de 1 MB y MB con coma decimal por encima", () => {
    expect(formatearPeso(300 * 1024)).toBe("300 KB");
    expect(formatearPeso(100)).toBe("1 KB");
    expect(formatearPeso(1024 * 1024)).toBe("1,0 MB");
    expect(formatearPeso(2_194_310)).toBe("2,1 MB");
  });
});
