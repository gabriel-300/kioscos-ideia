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
