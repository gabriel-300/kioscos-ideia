import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/arca/emitir", () => ({ emitirFacturaDeVenta: vi.fn(), emitirNotaCreditoPorAnulacion: vi.fn() }));
vi.mock("@/lib/arca/venta-factura", () => ({
  comoComprobanteVenta: vi.fn(async (_db: unknown, c: Record<string, unknown>) => ({ ...c, emisor: { cuit: "30719673623", razon_social: "ALS S.A.S." } })),
}));

import { facturarVentaAutomaticaEsperando } from "@/lib/arca/disparar";
import { emitirFacturaDeVenta } from "@/lib/arca/emitir";

const comprobante = { id: "c1", movimiento_id: "m1", cbte_tipo: 6, punto_venta: 2, numero: 1, estado: "emitido", cae: "86451460506151" };
const emitir = vi.mocked(emitirFacturaDeVenta);
const demora = <T,>(ms: number, valor: T) => new Promise<T>((res) => setTimeout(() => res(valor), ms));

beforeEach(() => { emitir.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("facturarVentaAutomaticaEsperando", () => {
  it("si ARCA responde a tiempo devuelve la factura lista para imprimir", async () => {
    emitir.mockResolvedValue({ ok: true, comprobante } as never);
    const r = await facturarVentaAutomaticaEsperando("m1", "u1", 500);
    expect(r.factura).toMatchObject({ numero: 1, cae: "86451460506151", emisor: { razon_social: "ALS S.A.S." } });
    expect(r.facturaError).toBeUndefined();
    expect(emitir).toHaveBeenCalledWith(expect.anything(), "m1", { origen: "automatico", userId: "u1" });
  });

  it("si ARCA tarda más que la espera, no devuelve nada (la venta sigue) y la emisión continúa sola", async () => {
    let terminada = false;
    emitir.mockImplementation(async () => { await demora(120, null); terminada = true; return { ok: true, comprobante } as never; });
    const t0 = Date.now();
    const r = await facturarVentaAutomaticaEsperando("m1", null, 30);
    expect(Date.now() - t0).toBeLessThan(110);   // volvió sin esperar a ARCA
    expect(r).toEqual({});
    expect(terminada).toBe(false);
    await demora(200, null);
    expect(terminada).toBe(true);                // el trabajo no se perdió
  });

  it("un rechazo o falla de ARCA dentro de la espera se informa para que el cajero lo vea", async () => {
    emitir.mockResolvedValue({ ok: false, error: "10015: Factura B a consumidor final supera el tope", pendiente: false } as never);
    const r = await facturarVentaAutomaticaEsperando("m1", "u1", 500);
    expect(r.factura).toBeUndefined();
    expect(r.facturaError).toMatch(/10015/);
  });

  it("si la venta no corresponde facturarla (sucursal apagada, etc.) no avisa nada", async () => {
    emitir.mockResolvedValue({ ok: false, error: "Esta sucursal no tiene la facturación activada.", noCorresponde: true } as never);
    expect(await facturarVentaAutomaticaEsperando("m1", "u1", 500)).toEqual({});
  });

  it("una excepción inesperada no tira abajo la venta", async () => {
    emitir.mockRejectedValue(new Error("boom"));
    expect(await facturarVentaAutomaticaEsperando("m1", "u1", 500)).toEqual({});
  });
});
