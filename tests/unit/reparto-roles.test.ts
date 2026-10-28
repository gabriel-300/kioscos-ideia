import { describe, it, expect } from "vitest";
import { puedeAsignarA, puedeRepartir, ROLES_QUE_REPARTEN } from "@/lib/auth/acceso";

describe("quién puede repartir", () => {
  it("repartidor, vendedor y encargado; el resto no", () => {
    expect([...ROLES_QUE_REPARTEN]).toEqual(["repartidor", "vendedor", "encargado"]);
    for (const r of ["repartidor", "vendedor", "encargado"]) expect(puedeRepartir(r), r).toBe(true);
    for (const r of ["admin", "concesionario", "cliente", "", null, undefined]) expect(puedeRepartir(r as string | null | undefined), String(r)).toBe(false);
  });
});

describe("quién puede asignar a quién", () => {
  it("el administrador y el encargado asignan a cualquiera", () => {
    expect(puedeAsignarA("admin", "a", "otro")).toBe(true);
    expect(puedeAsignarA("encargado", "e", "otro")).toBe(true);
  });
  it("un vendedor asigna a sí mismo (Yo lo llevo) y a cualquier otra persona que pueda repartir", () => {
    expect(puedeAsignarA("vendedor", "v1", "v1")).toBe(true);
    expect(puedeAsignarA("vendedor", "v1", "v2")).toBe(true);
  });
  it("concesionario, repartidor y roles desconocidos no asignan", () => {
    for (const r of ["concesionario", "repartidor", "cliente", ""]) expect(puedeAsignarA(r, "x", "x"), r).toBe(false);
  });
});
