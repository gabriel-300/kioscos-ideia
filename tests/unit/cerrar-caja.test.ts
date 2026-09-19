import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

// cerrarCaja es donde se cuadra la plata del turno. Para encargado, vendedor y
// concesionario el servidor IGNORA los totales del cliente y los recalcula desde
// los movimientos del turno (auditoría 08/08: antes se podía fabricar una
// diferencia en cero para esconder un faltante). Se prueba con el doble en
// memoria de Supabase. `it.fails` = hallazgo abierto (hoy no queda ninguno acá).

const h = vi.hoisted(() => ({ session: { userId: "u1", role: "encargado" }, admin: null as any }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireStaff: async () => h.session }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin, createClient: async () => ({}) }));

import { cerrarCaja } from "@/app/(admin)/admin/sucursales/[id]/cierre-actions";

const SUC = "suc-1";
type Venta = {
  canal: string | null;
  pago_billetera?: number | null; pago_tarjeta?: number | null; pago_transferencia?: number | null;
  movimiento_items: { subtotal: number | null }[];
};
type Esc = {
  role?: string; userId?: string;
  encargadoDe?: string;
  vendedorEnSucursal?: boolean;
  auditoriaObligatoria?: boolean;
  auditoriaHecha?: boolean;
  apertura?: { id: string; created_at: string; created_by: string | null; fondo_inicial: number } | null;
  recibidoPorTraspaso?: string | null;
  ventas?: Venta[];
  rpcError?: string;
};

function montar(e: Esc = {}) {
  h.session = { userId: e.userId ?? "u1", role: e.role ?? "encargado" };
  const f = fakeAdmin(
    (q: Q) => {
      switch (q.table) {
        case "sucursales": return { data: { encargado_user_id: e.encargadoDe ?? h.session.userId, auditoria_obligatoria: !!e.auditoriaObligatoria } };
        case "profile_sucursales": return { data: e.vendedorEnSucursal === false ? null : { id: "ps" } };
        case "aperturas_caja": return { data: e.apertura === undefined ? APERTURA : e.apertura };
        case "auditorias_stock": return { data: e.auditoriaHecha ? { id: "aud1" } : null };
        case "traspasos_caja": return { data: e.recibidoPorTraspaso ? { recibido_por: e.recibidoPorTraspaso } : null };
        case "movimientos": return { data: e.ventas ?? [] };
        default: return { data: null };
      }
    },
    (name) => (name === "cerrar_caja" ? (e.rpcError ? { error: { message: e.rpcError } } : { data: "cierre-1" }) : { data: null }),
  );
  h.admin = f.admin;
  return { ...f, args: () => f.rpcCalls.find((c) => c.name === "cerrar_caja")?.args };
}

const APERTURA = { id: "a1", created_at: "2026-09-19T09:00:00Z", created_by: "u1", fondo_inicial: 5000 };
const datos = (extra: Record<string, unknown> = {}) => ({
  sucursal_id: SUC, fecha: "2026-09-19", fondo_inicial: 0, total_ventas: 1, efectivo_declarado: 7000,
  billetera_declarada: 1, tarjeta_declarada: 1, transferencia_declarada: 1, notas: null, fondo_siguiente: 3000,
  total_fiado: 1, total_plataforma: 1, ...extra,
});
const venta = (canal: string | null, subtotales: number[], pagos: Partial<Venta> = {}): Venta => ({
  canal, movimiento_items: subtotales.map((subtotal) => ({ subtotal })), ...pagos,
});

beforeEach(() => { h.session = { userId: "u1", role: "encargado" }; });

describe("cerrarCaja -- los totales los recalcula el servidor", () => {
  const ventas = [
    venta("consumidor_final", [400, 600], { pago_billetera: 100, pago_tarjeta: 50, pago_transferencia: 25 }),
    venta("cuenta_corriente", [300]),
    venta("pedido_ya_plataforma", [200]),
    venta("pedido_ya_efectivo", [150]),
  ];

  it("encargado: pisa los totales que manda el cliente con la suma real de los movimientos del turno", async () => {
    const t = montar({ role: "encargado", ventas });
    const r = await cerrarCaja(datos({ total_ventas: 1, billetera_declarada: 1, total_fiado: 1, total_plataforma: 1 }));
    expect(r).toEqual({});
    expect(t.args()).toMatchObject({
      p_total_ventas: 1150,          // consumidor_final 1000 + pedido_ya_efectivo 150 (sin fiado ni plataforma)
      p_total_fiado: 300,
      p_total_plataforma: 200,
      p_billetera_declarada: 100,
      p_tarjeta_declarada: 50,
      p_transferencia_declarada: 25,
      p_efectivo_declarado: 7000,    // lo único que declara la persona: el efectivo contado
    });
  });

  it("vendedor y concesionario también se recalculan; el creador sale de la sesión", async () => {
    let t = montar({ role: "vendedor", userId: "u1", ventas });
    await cerrarCaja(datos());
    expect(t.args()).toMatchObject({ p_total_ventas: 1150, p_created_by: "u1" });
    t = montar({ role: "concesionario", ventas });
    await cerrarCaja(datos());
    expect(t.args().p_total_ventas).toBe(1150);
  });

  it("el fondo inicial es el de la apertura registrada, no el que manda el cliente (esconder un faltante)", async () => {
    const t = montar({ ventas });
    await cerrarCaja(datos({ fondo_inicial: 0 }));
    expect(t.args().p_fondo_inicial).toBe(5000);
  });

  it("admin: se usan los números del cliente tal cual y no se consultan las ventas", async () => {
    const t = montar({ role: "admin", ventas });
    await cerrarCaja(datos({ fondo_inicial: 123, total_ventas: 9999, billetera_declarada: 77 }));
    expect(t.args()).toMatchObject({ p_fondo_inicial: 123, p_total_ventas: 9999, p_billetera_declarada: 77 });
    expect(t.calls.some((c) => c.table === "movimientos")).toBe(false);
  });

  it("solo cuentan ventas vigentes de ESA sucursal desde la apertura del turno", async () => {
    const t = montar({ ventas });
    await cerrarCaja(datos());
    const q = t.calls.find((c) => c.table === "movimientos")!;
    expect(eqDe(q, "sucursal_id")).toBe(SUC);
    expect(eqDe(q, "tipo")).toBe("venta");
    expect(q.filters).toContainEqual({ op: "is", col: "anulado_en", val: null });
    expect(q.filters).toContainEqual({ op: "gte", col: "created_at", val: APERTURA.created_at });
  });

  it("sin apertura registrada cae al filtro por fecha", async () => {
    const t = montar({ apertura: null, ventas });
    await cerrarCaja(datos({ fondo_inicial: 800 }));
    const q = t.calls.find((c) => c.table === "movimientos")!;
    expect(eqDe(q, "fecha")).toBe("2026-09-19");
    expect(t.args().p_fondo_inicial).toBe(800);
  });

  it("ventas con subtotal o pagos null no rompen la suma", async () => {
    const t = montar({ ventas: [{ canal: null, pago_billetera: null, movimiento_items: [{ subtotal: null }, { subtotal: 100 }] }] });
    await cerrarCaja(datos());
    expect(t.args()).toMatchObject({ p_total_ventas: 100, p_billetera_declarada: 0 });
  });

  // Latente: la suma en JS no se redondea. Con subtotales de 2 decimales (ej. 0.1 + 0.2) el total queda con
  // resto de float y el RPC calcula la diferencia contra ese número: un turno cuadrado al centavo podría pedir nota.
  // En la base hay 0 cierres con ese problema (203 revisados), por eso es un riesgo latente y no un bug vivo.
  it("el total de ventas se pasa al RPC redondeado a centavos", async () => {
    const t = montar({ ventas: [venta("consumidor_final", [0.1, 0.2])] });
    await cerrarCaja(datos());
    expect(t.args().p_total_ventas).toBe(0.3);
  });
});

describe("cerrarCaja -- quién puede cerrar", () => {
  it("un vendedor no puede cerrar la caja que tiene otra persona", async () => {
    const t = montar({ role: "vendedor", userId: "v1", apertura: { ...APERTURA, created_by: "otra" } });
    expect((await cerrarCaja(datos())).error).toMatch(/otra persona/);
    expect(t.args()).toBeUndefined();
  });

  it("puede cerrar quien abrió el turno o quien lo recibió por traspaso", async () => {
    let t = montar({ role: "vendedor", userId: "v1", apertura: { ...APERTURA, created_by: "v1" } });
    expect((await cerrarCaja(datos())).error).toBeUndefined();
    t = montar({ role: "vendedor", userId: "v1", apertura: { ...APERTURA, created_by: "otra" }, recibidoPorTraspaso: "v1" });
    expect((await cerrarCaja(datos())).error).toBeUndefined();
    expect(t.args()).toBeDefined();
  });

  it("un encargado ajeno o un vendedor sin esa sucursal no cierran", async () => {
    let t = montar({ role: "encargado", userId: "enc-A", encargadoDe: "enc-B" });
    expect((await cerrarCaja(datos())).error).toMatch(/permisos/);
    t = montar({ role: "vendedor", vendedorEnSucursal: false });
    expect((await cerrarCaja(datos())).error).toMatch(/permisos/);
    expect(t.args()).toBeUndefined();
  });
});

describe("cerrarCaja -- auditoría de stock obligatoria", () => {
  it("con auditoría obligatoria y sin auditar el turno, no cierra", async () => {
    const t = montar({ auditoriaObligatoria: true, auditoriaHecha: false });
    expect((await cerrarCaja(datos())).error).toMatch(/auditoría de stock/);
    expect(t.args()).toBeUndefined();
  });

  it("con auditoría hecha, o sin la obligación (UNAM, Villa Sarita), cierra", async () => {
    let t = montar({ auditoriaObligatoria: true, auditoriaHecha: true });
    expect((await cerrarCaja(datos())).error).toBeUndefined();
    t = montar({ auditoriaObligatoria: false, auditoriaHecha: false });
    expect((await cerrarCaja(datos())).error).toBeUndefined();
    expect(t.args()).toBeDefined();
  });

  it("la auditoría se busca por el id de la apertura de ESTE turno", async () => {
    const t = montar({ auditoriaObligatoria: true, auditoriaHecha: true });
    await cerrarCaja(datos());
    const q = t.calls.find((c) => c.table === "auditorias_stock")!;
    expect(eqDe(q, "apertura_id")).toBe("a1");
  });
});

describe("cerrarCaja -- errores del RPC", () => {
  it("devuelve el mensaje de la base (diferencia sin nota, caja ya cerrada) sin lanzar", async () => {
    montar({ rpcError: "Hay una diferencia de caja -- contá qué pasó en las notas antes de cerrar" });
    expect(await cerrarCaja(datos())).toEqual({ error: "Hay una diferencia de caja -- contá qué pasó en las notas antes de cerrar" });
  });
});
