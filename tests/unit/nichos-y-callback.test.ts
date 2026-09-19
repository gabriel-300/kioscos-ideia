import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

// H-07: un encargado no puede habilitar Cta. Corriente ni fijar el límite de un contacto
// (control solo de admin) mandando campos de más. H-24: /auth/callback no redirige a otros sitios.

const h = vi.hoisted(() => ({ session: { userId: "u1", role: "encargado" }, admin: null as any, verifyError: null as any, verifyCalls: [] as any[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireStaff: async () => h.session,
  requireAdmin: async () => {
    if (h.session.role !== "admin") throw new Error("Sin permisos de administrador");
    return h.session;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => h.admin,
  createClient: async () => ({ auth: { verifyOtp: async (a: any) => { h.verifyCalls.push(a); return { error: h.verifyError }; } } }),
}));

import { actualizarContacto, actualizarCtaCorrienteContacto } from "@/app/(admin)/admin/nichos/actions";
import { GET as callback } from "@/app/auth/callback/route";

function montar(role: string, encargadoDe = "u1") {
  h.session = { userId: "u1", role };
  const f = fakeAdmin((q: Q) => (q.table === "sucursales" ? { data: { encargado_user_id: encargadoDe } } : { data: null }));
  h.admin = f.admin;
  return f;
}
const updateDe = (f: ReturnType<typeof montar>) => f.calls.find((c) => c.table === "contactos_crm" && c.op === "update")!;

describe("nichos: actualizarContacto solo toca los campos permitidos", () => {
  it("descarta habilitado_cta_corriente, limite_credito, sucursal_id y cualquier campo extra", async () => {
    const f = montar("encargado");
    await actualizarContacto("c1", "suc-1", {
      estado: "en_atencion", notas: "llamar mañana",
      habilitado_cta_corriente: true, limite_credito: 500000, sucursal_id: "otra-suc", created_by: "yo", atendido_por: "otro",
    } as any);
    const u = updateDe(f);
    expect(u.payload).toEqual({ estado: "en_atencion", notas: "llamar mañana", atendido_por: "u1" });
    expect(eqDe(u, "id")).toBe("c1");
    expect(eqDe(u, "sucursal_id")).toBe("suc-1");
  });

  it("acepta los cuatro campos legítimos", async () => {
    const f = montar("admin");
    await actualizarContacto("c1", "suc-1", { estado: "convertido", convertido_pedido: true, monto: 1500, notas: null });
    expect(updateDe(f).payload).toMatchObject({ estado: "convertido", convertido_pedido: true, monto: 1500, notas: null });
  });

  it("estado inválido, vendedor y encargado de otra sucursal se rechazan sin escribir", async () => {
    let f = montar("encargado");
    await expect(actualizarContacto("c1", "suc-1", { estado: "hackeado" as any })).rejects.toThrow("Estado inválido");
    expect(f.calls.some((c) => c.op === "update")).toBe(false);
    f = montar("vendedor");
    await expect(actualizarContacto("c1", "suc-1", { notas: "x" })).rejects.toThrow(/CRM de nichos/);
    f = montar("encargado", "otro-encargado");
    await expect(actualizarContacto("c1", "suc-1", { notas: "x" })).rejects.toThrow(/permisos/);
    expect(f.calls.some((c) => c.op === "update")).toBe(false);
  });
});

describe("nichos: habilitar Cta. Corriente es solo del admin", () => {
  it("un encargado no puede; el admin sí", async () => {
    let f = montar("encargado");
    await expect(actualizarCtaCorrienteContacto("c1", "suc-1", { habilitado_cta_corriente: true, limite_credito: 1000 })).rejects.toThrow(/administrador/);
    expect(f.calls.some((c) => c.op === "update")).toBe(false);
    f = montar("admin");
    await actualizarCtaCorrienteContacto("c1", "suc-1", { habilitado_cta_corriente: true, limite_credito: 1000 });
    expect(updateDe(f).payload).toEqual({ habilitado_cta_corriente: true, limite_credito: 1000 });
  });
});

describe("/auth/callback: destino interno solamente", () => {
  beforeEach(() => { h.verifyError = null; h.verifyCalls = []; });
  const ir = async (qs: string) => {
    const res = await callback(new Request(`https://app.test/auth/callback?token_hash=abc&type=recovery${qs}`));
    return res.headers.get("location");
  };

  it("sin next va a /auth/set-password", async () => {
    expect(await ir("")).toBe("https://app.test/auth/set-password");
  });
  it("una ruta interna se respeta", async () => {
    expect(await ir("&next=/admin/dashboard")).toBe("https://app.test/admin/dashboard");
  });
  it("no redirige a otro sitio: @host, //host, /\\host y URLs absolutas caen al destino por defecto", async () => {
    for (const next of ["@sitio-malo.com", "//sitio-malo.com", "/\\sitio-malo.com", "https://sitio-malo.com", "javascript:alert(1)"]) {
      const loc = await ir("&next=" + encodeURIComponent(next));
      expect(loc, next).toBe("https://app.test/auth/set-password");
    }
  });
  it("token inválido va al login con el error", async () => {
    h.verifyError = { message: "expired" };
    expect(await ir("&next=/admin")).toBe("https://app.test/login?error=link-invalido");
  });
  it("sin token_hash no verifica nada", async () => {
    const res = await callback(new Request("https://app.test/auth/callback"));
    expect(res.headers.get("location")).toBe("https://app.test/login?error=link-invalido");
    expect(h.verifyCalls).toHaveLength(0);
  });
});
