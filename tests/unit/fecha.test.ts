import { describe, it, expect } from "vitest";
import { fechaHoyAR, horaNumAR, diaSemanaIdxAR, primerDiaMesAR } from "@/lib/fecha";

// El negocio opera en UTC-3 pero Cloudflare Workers y la base corren en UTC:
// entre las 21:00 y las 23:59 de Argentina el reloj UTC ya está en "mañana".
describe("fecha (zona horaria Argentina)", () => {
  it("21:00 AR (00:00Z) todavía es el día anterior en Argentina", () => {
    expect(fechaHoyAR(new Date("2026-09-19T00:00:00Z"))).toBe("2026-09-18");
  });
  it("23:59 AR (02:59Z) sigue siendo el día anterior", () => {
    expect(fechaHoyAR(new Date("2026-09-19T02:59:00Z"))).toBe("2026-09-18");
  });
  it("00:00 AR (03:00Z) ya es el día nuevo", () => {
    expect(fechaHoyAR(new Date("2026-09-19T03:00:00Z"))).toBe("2026-09-19");
  });
  it("cruce de mes y de año", () => {
    expect(fechaHoyAR(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09-30");
    expect(fechaHoyAR(new Date("2027-01-01T02:00:00Z"))).toBe("2026-12-31");
  });
  it("primerDiaMesAR usa el calendario argentino, no el UTC", () => {
    expect(primerDiaMesAR(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09-01");
  });
  it("horaNumAR devuelve 0 (no 24) a medianoche", () => {
    expect(horaNumAR(new Date("2026-09-19T03:00:00Z"))).toBe(0);
    expect(horaNumAR(new Date("2026-09-19T15:30:00Z"))).toBe(12);
  });
  it("diaSemanaIdxAR: 0=domingo y respeta el corrimiento de día", () => {
    expect(diaSemanaIdxAR(new Date("2026-09-20T12:00:00Z"))).toBe(0); // domingo
    expect(diaSemanaIdxAR(new Date("2026-09-21T01:00:00Z"))).toBe(0); // lunes 01Z = domingo 22h AR
    expect(diaSemanaIdxAR(new Date("2026-09-21T03:00:00Z"))).toBe(1); // lunes 00h AR
  });
});
