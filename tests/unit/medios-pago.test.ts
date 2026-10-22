import { describe, it, expect } from "vitest";
import { aceptaEfectivoOnline, leerEfectivoOnline } from "@/lib/pedidos/medios-pago";
import { fakeAdmin } from "../helpers/fake-supabase";

describe("aceptaEfectivoOnline", () => {
  it("solo con la sucursal habilitada Y un cliente que ingresó", () => {
    expect(aceptaEfectivoOnline(true, true)).toBe(true);
    expect(aceptaEfectivoOnline(true, false)).toBe(false);
    expect(aceptaEfectivoOnline(false, true)).toBe(false);
    expect(aceptaEfectivoOnline(false, false)).toBe(false);
  });
});

describe("leerEfectivoOnline", () => {
  it("true solo si la columna vale true", async () => {
    expect(await leerEfectivoOnline(fakeAdmin(() => ({ data: { efectivo_online: true } })).admin, "s")).toBe(true);
    expect(await leerEfectivoOnline(fakeAdmin(() => ({ data: { efectivo_online: false } })).admin, "s")).toBe(false);
  });
  it("sin la migración (la columna no existe) no hay efectivo y no se rompe", async () => {
    expect(await leerEfectivoOnline(fakeAdmin(() => ({ error: { message: "column efectivo_online does not exist" } })).admin, "s")).toBe(false);
  });
});
