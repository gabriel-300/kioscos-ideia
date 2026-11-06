import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/arca/ticket", () => ({ obtenerTicket: vi.fn() }));
vi.mock("@/lib/arca/cliente", async (original) => {
  const real = await original<typeof import("@/lib/arca/cliente")>();
  return { ...real, puntosDeVenta: vi.fn(), ultimoAutorizado: vi.fn() };
});

import { probarEmisor, type EmisorAProbar, type SucursalAProbar } from "@/lib/arca/probar";
import { ArcaError, puntosDeVenta, ultimoAutorizado } from "@/lib/arca/cliente";
import { obtenerTicket } from "@/lib/arca/ticket";

const emisor: EmisorAProbar = { id: "e1", cuit: "30719673623", razon_social: "ALS S.A.S.", ambiente: "produccion" };
const suc = (nombre: string, pv: number | null, emisorId: string | null = "e1"): SucursalAProbar =>
  ({ nombre, arca_emisor_id: emisorId, arca_punto_venta: pv, arca_modo: "digital" });
const ticket = { token: "t", sign: "s", expiraEn: new Date("2026-11-07T05:00:00Z") };

beforeEach(() => {
  vi.mocked(obtenerTicket).mockReset();
  vi.mocked(puntosDeVenta).mockReset();
  vi.mocked(ultimoAutorizado).mockReset();
});

describe("probarEmisor (solo lectura)", () => {
  it("sin ticket de acceso corta ahí y no consulta nada más", async () => {
    vi.mocked(obtenerTicket).mockRejectedValue(new ArcaError("Faltan los secrets ARCA_CRT_PROD y ARCA_KEY_PROD", false));
    const r = await probarEmisor({}, emisor, [suc("Costanera", 2)]);
    expect(r.ticket.ok).toBe(false);
    expect(r.ticket.error).toMatch(/ARCA_CRT_PROD/);
    expect(puntosDeVenta).not.toHaveBeenCalled();
    expect(r.sucursales).toEqual([]);
  });

  it("caso sano: lista los puntos de venta con su último número y valida el de cada sucursal del emisor", async () => {
    vi.mocked(obtenerTicket).mockResolvedValue(ticket);
    vi.mocked(puntosDeVenta).mockResolvedValue([
      { nro: 2, emision: "CAE - Ri Iva", bloqueado: false, baja: false },
      { nro: 3, emision: "CAE - Ri Iva", bloqueado: false, baja: false },
    ]);
    vi.mocked(ultimoAutorizado).mockImplementation(async (_a, _au, pv, tipo) => (tipo === 6 ? pv * 10 : 0));
    const r = await probarEmisor({}, emisor, [
      suc("Costanera", 2), suc("UNAM", 3), suc("Local con el 1", 1), suc("Sin punto", null),
      suc("De otro emisor", 2, "otro"), suc("Sin emisor", 2, null),
    ]);
    expect(r.ticket.ok).toBe(true);
    expect(r.ticket.vence).toBe("2026-11-07T05:00:00.000Z");
    expect(r.puntosVenta.map((p) => [p.nro, p.ultimaFacturaB, p.ultimaFacturaA])).toEqual([[2, 20, 0], [3, 30, 0]]);
    expect(r.sucursales.map((s) => [s.nombre, s.estado])).toEqual([
      ["Costanera", "ok"], ["UNAM", "ok"], ["Local con el 1", "no_habilitado"], ["Sin punto", "sin_punto"],
    ]);
  });

  it("un punto bloqueado o dado de baja no se consulta y la sucursal queda marcada", async () => {
    vi.mocked(obtenerTicket).mockResolvedValue(ticket);
    vi.mocked(puntosDeVenta).mockResolvedValue([
      { nro: 2, emision: "CAE - Ri Iva", bloqueado: true, baja: false },
      { nro: 3, emision: "CAE - Ri Iva", bloqueado: false, baja: true },
    ]);
    const r = await probarEmisor({}, emisor, [suc("A", 2), suc("B", 3)]);
    expect(ultimoAutorizado).not.toHaveBeenCalled();
    expect(r.sucursales.map((s) => s.estado)).toEqual(["bloqueado", "bloqueado"]);
    expect(r.sucursales[1].detalle).toMatch(/baja/);
  });

  it("si ARCA no responde la lista de puntos de venta, lo dice y no declara 'no habilitado'", async () => {
    vi.mocked(obtenerTicket).mockResolvedValue(ticket);
    vi.mocked(puntosDeVenta).mockRejectedValue(new ArcaError("No se pudo conectar con ARCA: fetch failed", true));
    const r = await probarEmisor({}, emisor, [suc("Costanera", 2)]);
    expect(r.ticket.ok).toBe(true);
    expect(r.errorPuntosVenta).toMatch(/fetch failed/);
    expect(r.sucursales[0].detalle).toMatch(/No se pudo verificar/);
  });

  it("un error al consultar un punto de venta se informa en ese punto y no tira abajo el resto", async () => {
    vi.mocked(obtenerTicket).mockResolvedValue(ticket);
    vi.mocked(puntosDeVenta).mockResolvedValue([
      { nro: 2, emision: "CAE - Ri Iva", bloqueado: false, baja: false },
      { nro: 3, emision: "CAE - Ri Iva", bloqueado: false, baja: false },
    ]);
    vi.mocked(ultimoAutorizado).mockImplementation(async (_a, _au, pv) => {
      if (pv === 2) throw new ArcaError("602: sin resultados", false);
      return 7;
    });
    const r = await probarEmisor({}, emisor, []);
    expect(r.puntosVenta[0].error).toMatch(/602/);
    expect(r.puntosVenta[1].ultimaFacturaB).toBe(7);
  });
});
