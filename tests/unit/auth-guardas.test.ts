import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// Las guardas de rol y de sucursal son lo único que protege a las Server
// Actions (createAdminClient no aplica RLS). Se prueba la matriz completa.

const h = vi.hoisted(() => ({ user: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  createAdminClient: () => ({}),
}));

import { requireAdmin, requireStaff, requireRepartidor } from "@/lib/auth/require-role";
import { requireSucursalAccess, resolverSucursalConcesionario } from "@/lib/auth/sucursal-access";
import { obtenerTenedorActual } from "@/lib/auth/turno-actual";

const conRol = (role: string | undefined, id = "u1") => { h.user = { id, app_metadata: role ? { role } : {} }; };
beforeEach(() => { h.user = null; });

describe("requireAdmin", () => {
  it("sin sesión lanza 'No autenticado'", async () => {
    await expect(requireAdmin()).rejects.toThrow("No autenticado");
  });
  it("solo el rol admin pasa", async () => {
    conRol("admin", "adm");
    await expect(requireAdmin()).resolves.toEqual({ userId: "adm" });
    for (const r of ["encargado", "vendedor", "concesionario", "repartidor", undefined, "customer_b2c"]) {
      conRol(r as string | undefined);
      await expect(requireAdmin()).rejects.toThrow(/permisos/);
    }
  });
  it("el rol se lee de app_metadata (server), no de user_metadata (editable por el usuario)", async () => {
    h.user = { id: "u1", app_metadata: {}, user_metadata: { role: "admin" } };
    await expect(requireAdmin()).rejects.toThrow(/permisos/);
  });
});

describe("requireStaff", () => {
  it("deja pasar admin, encargado, vendedor y concesionario y devuelve el rol", async () => {
    for (const r of ["admin", "encargado", "vendedor", "concesionario"]) {
      conRol(r, "x");
      await expect(requireStaff()).resolves.toEqual({ userId: "x", role: r });
    }
  });
  it("NO deja pasar al repartidor (a propósito) ni a roles desconocidos o vacíos", async () => {
    for (const r of ["repartidor", "customer_b2c", "admin_enminutas", "ADMIN", undefined]) {
      conRol(r as string | undefined);
      await expect(requireStaff()).rejects.toThrow("Sin permisos");
    }
  });
  it("sin sesión lanza 'No autenticado'", async () => {
    await expect(requireStaff()).rejects.toThrow("No autenticado");
  });
});

describe("requireRepartidor", () => {
  it("pasan el repartidor y el admin (supervisión); el resto no", async () => {
    for (const r of ["repartidor", "admin"]) {
      conRol(r);
      await expect(requireRepartidor()).resolves.toMatchObject({ role: r });
    }
    for (const r of ["vendedor", "encargado", "concesionario", undefined]) {
      conRol(r as string | undefined);
      await expect(requireRepartidor()).rejects.toThrow("Sin permisos");
    }
  });
});

describe("requireSucursalAccess", () => {
  const SUC = "suc-1";
  function admin(e: { encargado?: string | null; vendedorEn?: boolean } = {}) {
    return fakeAdmin((q: Q) => {
      if (q.table === "sucursales") return { data: e.encargado === undefined ? null : { encargado_user_id: e.encargado } };
      if (q.table === "profile_sucursales") return { data: e.vendedorEn ? { id: "ps" } : null };
    }).admin;
  }

  it("admin accede a cualquier sucursal", async () => {
    expect(await requireSucursalAccess(admin(), "a", "admin", SUC)).toBeNull();
  });
  it("encargado y concesionario: solo la sucursal donde son encargado_user_id", async () => {
    for (const role of ["encargado", "concesionario"]) {
      expect(await requireSucursalAccess(admin({ encargado: "yo" }), "yo", role, SUC)).toBeNull();
      expect(await requireSucursalAccess(admin({ encargado: "otro" }), "yo", role, SUC)).toMatch(/permisos/);
      expect(await requireSucursalAccess(admin({ encargado: null }), "yo", role, SUC)).toMatch(/permisos/);
      expect(await requireSucursalAccess(admin({}), "yo", role, "no-existe")).toMatch(/permisos/);
    }
  });
  it("vendedor: solo las sucursales de profile_sucursales", async () => {
    expect(await requireSucursalAccess(admin({ vendedorEn: true }), "v", "vendedor", SUC)).toBeNull();
    expect(await requireSucursalAccess(admin({ vendedorEn: false }), "v", "vendedor", SUC)).toMatch(/permisos/);
  });
  it("consulta profile_sucursales por el usuario Y la sucursal pedidos", async () => {
    const f = fakeAdmin(() => ({ data: { id: "ps" } }));
    await requireSucursalAccess(f.admin, "v-1", "vendedor", SUC);
    const q = f.calls.find((c) => c.table === "profile_sucursales")!;
    expect(q.filters).toEqual(expect.arrayContaining([{ op: "eq", col: "profile_id", val: "v-1" }, { op: "eq", col: "sucursal_id", val: SUC }]));
  });

  // Hallazgo de la auditoría: la guarda solo conoce 4 roles; cualquier otro (repartidor, un rol nuevo) pasa
  // con `null` = "permitido". Hoy lo frena requireStaff() antes, pero la guarda debería negar por defecto.
  it.fails("rechaza un rol desconocido (negar por defecto)", async () => {
    expect(await requireSucursalAccess(admin({ encargado: "yo" }), "yo", "repartidor", SUC)).toMatch(/permisos/);
  });
});

describe("resolverSucursalConcesionario", () => {
  it("devuelve la única sucursal del concesionario, o null si no tiene", async () => {
    expect(await resolverSucursalConcesionario(fakeAdmin(() => ({ data: { id: "villa" } })).admin, "c")).toBe("villa");
    expect(await resolverSucursalConcesionario(fakeAdmin(() => ({ data: null })).admin, "c")).toBeNull();
  });
});

describe("obtenerTenedorActual", () => {
  it("es quien recibió el último traspaso; sin traspasos, quien abrió la caja", async () => {
    expect(await obtenerTenedorActual(fakeAdmin(() => ({ data: { recibido_por: "recibe" } })).admin, "a1", "abrio")).toBe("recibe");
    expect(await obtenerTenedorActual(fakeAdmin(() => ({ data: null })).admin, "a1", "abrio")).toBe("abrio");
    expect(await obtenerTenedorActual(fakeAdmin(() => ({ data: null })).admin, "a1", null)).toBeNull();
  });
});
