import { describe, it, expect } from "vitest";
import { CADA_NOTA_S, duracionAlarmaS, FRECUENCIA_ALTA, FRECUENCIA_BAJA, NOTAS_ALARMA, patronAlarma, VIBRACION_ALARMA } from "@/lib/pedidos/alarma-sonido";

describe("alarma de pedido nuevo", () => {
  it("alterna dos tonos agudos, en orden, sin superponerse", () => {
    const notas = patronAlarma();
    expect(notas).toHaveLength(NOTAS_ALARMA);
    notas.forEach((n, i) => {
      expect(n.frecuencia).toBe(i % 2 === 0 ? FRECUENCIA_ALTA : FRECUENCIA_BAJA);
      expect(n.inicio).toBeCloseTo(i * CADA_NOTA_S, 5);
      expect(n.duracion).toBeLessThan(CADA_NOTA_S); // hay un respiro entre nota y nota
      expect(n.duracion).toBeGreaterThan(0);
    });
  });
  it("suena más de dos segundos pero no llega a cansar (menos de cuatro)", () => {
    expect(duracionAlarmaS()).toBeGreaterThan(2);
    expect(duracionAlarmaS()).toBeLessThan(4);
  });
  it("los tonos son lo bastante agudos como para oírse en un parlante chico", () => {
    expect(FRECUENCIA_BAJA).toBeGreaterThan(600);
    expect(FRECUENCIA_ALTA).toBeGreaterThan(FRECUENCIA_BAJA);
  });
  it("la vibración alterna golpe y pausa (termina en golpe)", () => {
    expect(VIBRACION_ALARMA.length % 2).toBe(1);
  });
});
