import { describe, it, expect } from "vitest";
import { personalDeSucursal } from "@/lib/pedidos/personal-sesion";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

const user = (role?: string) => ({ id: "u1", app_metadata: role ? { role } : {} });

describe("personalDeSucursal", () => {
  it("sin sesión o sin rol, no", async () => {
    const { admin } = fakeAdmin(() => ({ data: null }));
    expect(await personalDeSucursal(admin, null, "s1")).toBe(false);
    expect(await personalDeSucursal(admin, user(), "s1")).toBe(false);
  });
  it("un administrador sí", async () => {
    expect(await personalDeSucursal(fakeAdmin(() => ({ data: null })).admin, user("admin"), "s1")).toBe(true);
  });
  it("un vendedor, solo si tiene asignada esa sucursal", async () => {
    const con = fakeAdmin((q: Q) => (q.table === "profile_sucursales" ? { data: { id: "x" } } : undefined));
    const sin = fakeAdmin((q: Q) => (q.table === "profile_sucursales" ? { data: null } : undefined));
    expect(await personalDeSucursal(con.admin, user("vendedor"), "s1")).toBe(true);
    expect(await personalDeSucursal(sin.admin, user("vendedor"), "s1")).toBe(false);
  });
  it("un repartidor (o un rol que no maneja sucursales) no", async () => {
    expect(await personalDeSucursal(fakeAdmin(() => ({ data: null })).admin, user("repartidor"), "s1")).toBe(false);
  });
});
