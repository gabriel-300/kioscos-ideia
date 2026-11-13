import { describe, expect, it } from "vitest";
import { armarTicketHtml, esFacturaCbte, letraCbte, nroCbte, type ComprobanteVenta } from "@/lib/arca/ticket-html";

const base = { lineas: [{ nombre: "Agua <500>", cantidad: 1, precio: 1210, subtotal: 1210 }], total: 1210, fecha: "2026-11-06", id: "ABCD1234", sucursalNombre: "Angiru Food Costanera" };
const emisor = { cuit: "30719673623", razon_social: "ALS S.A.S.", domicilio: "Av. Marconi", ingresos_brutos: "123-456", inicio_actividades: "2020-03-01" };
const factura = (extra: Partial<ComprobanteVenta> = {}): ComprobanteVenta => ({
  movimiento_id: "m1", cbte_tipo: 6, punto_venta: 2, numero: 15, fecha: "2026-11-06", estado: "emitido", cae: "86441048506846", cae_vto: "2026-11-16",
  doc_tipo: 99, doc_nro: "0", imp_total: 1210, imp_neto: 1000, imp_iva: 210, ambiente: "produccion", error: null,
  iva: [{ alicuota: 21, base: 1000, importe: 210 }], cond_iva_receptor: 5, emisor, ...extra,
});

describe("armarTicketHtml", () => {
  it("sin factura: comprobante interno, sin CAE ni QR, y escapa el HTML de los nombres", () => {
    const h = armarTicketHtml(base);
    expect(h).toContain("ANGIRU FOOD");
    expect(h).toContain("Este comprobante no tiene validez fiscal");
    expect(h).toContain("Agua &lt;500>");
    expect(h).not.toContain("CAE:");
    expect(h).not.toContain("<svg");
  });

  it("Factura B: emisor, número con punto de venta, consumidor final, IVA contenido, CAE y QR", () => {
    const h = armarTicketHtml({ ...base, factura: factura() });
    expect(h).toContain("ALS S.A.S.");
    expect(h).toContain("CUIT 30719673623");
    expect(h).toContain("FACTURA B · Cód. 006");
    expect(h).toContain("N° 00002-00000015");
    expect(h).toContain("A CONSUMIDOR FINAL");
    expect(h).toContain("IVA contenido");
    expect(h).toContain("CAE: <b>86441048506846</b>");
    expect(h).toContain("Vto. CAE: 16/11/2026");
    expect(h).toContain("<svg");
    expect(h).not.toContain("Este comprobante no tiene validez fiscal");
    expect(h).not.toContain("SIN VALIDEZ FISCAL");
  });

  it("homologación: avisa que es una prueba", () => {
    expect(armarTicketHtml({ ...base, factura: factura({ ambiente: "homologacion" }) })).toContain("*** PRUEBA — SIN VALIDEZ FISCAL ***");
  });

  it("Factura A: CUIT del cliente y neto + IVA discriminados (sin el texto de la B)", () => {
    const h = armarTicketHtml({ ...base, factura: factura({ cbte_tipo: 1, doc_tipo: 80, doc_nro: "20302371866", cond_iva_receptor: 1 }) });
    expect(h).toContain("FACTURA A · Cód. 001");
    expect(h).toContain("CUIT 20302371866 · IVA Responsable Inscripto");
    expect(h).toContain("Importe neto gravado");
    expect(h).toContain("IVA 21%");
    expect(h).not.toContain("Transparencia Fiscal");
  });

  it("una factura pendiente o con error se imprime como ticket interno, no como fiscal", () => {
    const h = armarTicketHtml({ ...base, factura: factura({ estado: "pendiente", cae: null, numero: null }) });
    expect(h).toContain("ANGIRU FOOD");
    expect(h).not.toContain("FACTURA B");
  });

  it("imprimir=false no agrega el script de impresión; por defecto lo cierra bien", () => {
    expect(armarTicketHtml({ ...base, imprimir: false })).not.toContain("<script>");
    const h = armarTicketHtml(base);
    expect(h).toContain("window.print()");
    expect(h).toContain("window.close()}</script>");
  });

  it("helpers de tipo y número", () => {
    expect(esFacturaCbte({ cbte_tipo: 1 })).toBe(true);
    expect(esFacturaCbte({ cbte_tipo: 8 })).toBe(false);
    expect(letraCbte({ cbte_tipo: 3 })).toBe("A");
    expect(nroCbte({ punto_venta: 3, numero: null })).toBe("—");
  });
});

import { abrirTicketDespues } from "@/lib/arca/ticket-html";
import { afterEach, vi } from "vitest";

describe("abrirTicketDespues (ventana de impresión)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const ventana = () => ({ document: { write: vi.fn(), open: vi.fn(), close: vi.fn() }, close: vi.fn() });

  it("abre la ventana ANTES de pedir los datos y después escribe el ticket", async () => {
    const w = ventana(); const orden: string[] = [];
    vi.stubGlobal("window", { open: vi.fn(() => { orden.push("abre"); return w; }) });
    const ok = await abrirTicketDespues(async () => { orden.push("datos"); return "<html>ticket</html>"; });
    expect(ok).toBe(true);
    expect(orden).toEqual(["abre", "datos"]);
    expect(w.document.write).toHaveBeenLastCalledWith("<html>ticket</html>");
  });

  it("si no hay ticket o falla la carga, cierra la ventana y devuelve false", async () => {
    let w = ventana();
    vi.stubGlobal("window", { open: vi.fn(() => w) });
    expect(await abrirTicketDespues(async () => null)).toBe(false);
    expect(w.close).toHaveBeenCalled();
    w = ventana();
    expect(await abrirTicketDespues(async () => { throw new Error("red"); })).toBe(false);
    expect(w.close).toHaveBeenCalled();
  });

  it("si el navegador bloquea la ventana, devuelve false sin pedir los datos", async () => {
    vi.stubGlobal("window", { open: vi.fn(() => null) });
    const pedir = vi.fn(async () => "<html/>");
    expect(await abrirTicketDespues(pedir)).toBe(false);
    expect(pedir).not.toHaveBeenCalled();
  });
});

describe("Factura A con leyenda «Operación sujeta a retención» (código 51)", () => {
  const f51 = factura({ cbte_tipo: 51, doc_tipo: 80, doc_nro: "20302371866", cond_iva_receptor: 1 });

  it("el ticket lleva el código 051, la leyenda y el neto + IVA discriminados", () => {
    const h = armarTicketHtml({ ...base, factura: f51 });
    expect(h).toContain("FACTURA A · Cód. 051");
    expect(h).toContain("OPERACIÓN SUJETA A RETENCIÓN");
    expect(h).toContain("Importe neto gravado");
    expect(h).toContain("CUIT 20302371866 · IVA Responsable Inscripto");
    expect(h).not.toContain("Transparencia Fiscal");
  });

  it("la Factura A común y la B NO llevan la leyenda", () => {
    expect(armarTicketHtml({ ...base, factura: factura({ cbte_tipo: 1, doc_tipo: 80, doc_nro: "20302371866", cond_iva_receptor: 1 }) })).not.toContain("SUJETA A RETENCIÓN");
    expect(armarTicketHtml({ ...base, factura: factura() })).not.toContain("SUJETA A RETENCIÓN");
  });

  it("la 51 se reconoce como factura y como clase A al imprimir", () => {
    expect(esFacturaCbte({ cbte_tipo: 51 })).toBe(true);
    expect(esFacturaCbte({ cbte_tipo: 53 })).toBe(false);
    expect(letraCbte({ cbte_tipo: 51 })).toBe("A");
  });
});

import { esReimpresion, MINUTOS_PARA_COPIA } from "@/lib/arca/ticket-html";

describe("COPIA en las reimpresiones", () => {
  const ahora = Date.parse("2026-11-06T20:00:00Z");
  const hace = (min: number) => new Date(ahora - min * 60_000).toISOString();

  it("el ticket marcado como copia lleva «COPIA — REIMPRESIÓN»; el original no", () => {
    expect(armarTicketHtml({ ...base, factura: factura(), copia: true })).toContain("*** COPIA — REIMPRESIÓN ***");
    expect(armarTicketHtml({ ...base, factura: factura() })).not.toContain("COPIA");
    expect(armarTicketHtml({ ...base, factura: factura(), copia: false })).not.toContain("COPIA");
  });

  it("un ticket sin factura (comprobante interno) nunca lleva la marca, aunque se pida", () => {
    expect(armarTicketHtml({ ...base, copia: true })).not.toContain("COPIA");
  });

  it("es reimpresión pasados los minutos de gracia, no antes (el primer ticket de una factura que tardó sale como original)", () => {
    expect(MINUTOS_PARA_COPIA).toBe(10);
    expect(esReimpresion(hace(2), ahora)).toBe(false);
    expect(esReimpresion(hace(10), ahora)).toBe(false);
    expect(esReimpresion(hace(11), ahora)).toBe(true);
    expect(esReimpresion(hace(60 * 24), ahora)).toBe(true);
  });

  it("sin fecha de emisión o con una fecha inválida no se marca como copia", () => {
    expect(esReimpresion(null, ahora)).toBe(false);
    expect(esReimpresion(undefined, ahora)).toBe(false);
    expect(esReimpresion("no es una fecha", ahora)).toBe(false);
  });
});

describe("ticket fiscal a un cliente exento conocido", () => {
  const base = {
    movimiento_id: "m", cbte_tipo: 6, punto_venta: 3, numero: 192, fecha: "2026-11-11", estado: "emitido" as const,
    cae: "86452212159705", cae_vto: "2026-11-21", doc_tipo: 80, doc_nro: "30598218095", imp_total: 29200, imp_neto: 24132.23, imp_iva: 5067.77,
    ambiente: "produccion", error: null, cond_iva_receptor: 4,
    emisor: { cuit: "30719673623", razon_social: "ALS S.A.S.", domicilio: "x", ingresos_brutos: null, inicio_actividades: null },
  };
  const arma = (extra = {}) => armarTicketHtml({ lineas: [], total: 29200, fecha: "2026-11-11", id: "09C05C86", sucursalNombre: "Angiru Food UNAM", factura: { ...base, ...extra } });
  it("imprime razón social, domicilio, condición de venta y rotula el local", () => {
    const h = arma();
    expect(h).toContain("Universidad Nacional de Misiones");
    expect(h).toContain("Ruta Nac. 12 Km 7.000");
    expect(h).toContain("Condición de venta: Contado");
    expect(h).toContain("Local: Angiru Food UNAM");
  });
  it("imprime la orden de compra solo si se cargó", () => {
    expect(arma()).not.toContain("Orden de compra");
    expect(arma({ referencia: "OC 123/26" })).toContain("Orden de compra / Expte.: <b>OC 123/26</b>");
  });
});

describe("dirección del local en el ticket fiscal", () => {
  const f = { movimiento_id: "m", cbte_tipo: 6, punto_venta: 3, numero: 1, fecha: "2026-11-11", estado: "emitido" as const, cae: "1", cae_vto: "2026-11-21", doc_tipo: 99, doc_nro: "0", imp_total: 100, imp_neto: 82.64, imp_iva: 17.36, ambiente: "produccion", error: null, emisor: { cuit: "30719673623", razon_social: "ALS S.A.S.", domicilio: "x" } };
  const arma = (local_direccion: string | null) => armarTicketHtml({ lineas: [], total: 100, fecha: "2026-11-11", id: "A", sucursalNombre: "Angiru Food UNAM", factura: { ...f, local_direccion } });
  it("la imprime debajo del nombre del local, y no inventa nada si no hay", () => {
    expect(arma("Av. Libertador 1234")).toContain("Local: Angiru Food UNAM</div><div class=\"sub\">Av. Libertador 1234");
    expect(arma(null)).not.toContain("Av. Libertador");
  });
});
