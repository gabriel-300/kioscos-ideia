import { describe, expect, it } from "vitest";
import {
  conRetencion, esFactura, esNotaDeCredito, FACTURA_A, FACTURA_A_RET, FACTURA_B, letraDe, nombreDeTipo,
  NOTA_CREDITO_A, NOTA_CREDITO_A_RET, NOTA_CREDITO_B, tipoDeFacturaAEmitir, tipoFacturaDe, tipoNotaDe, TIPOS_FACTURA,
} from "@/lib/arca/tipos";

describe("tipos de comprobante de ARCA", () => {
  it("los códigos son los de ARCA (FEParamGetTiposCbte)", () => {
    expect([FACTURA_A, NOTA_CREDITO_A, FACTURA_B, NOTA_CREDITO_B, FACTURA_A_RET, NOTA_CREDITO_A_RET]).toEqual([1, 3, 6, 8, 51, 53]);
  });

  it("facturas vs notas de crédito", () => {
    expect(TIPOS_FACTURA).toEqual([1, 6, 51]);
    expect([1, 6, 51].every(esFactura)).toBe(true);
    expect([3, 8, 53, 2, 52].some(esFactura)).toBe(false);
    expect([3, 8, 53].every(esNotaDeCredito)).toBe(true);
    expect([1, 6, 51].some(esNotaDeCredito)).toBe(false);
  });

  it("las dos clases A (común y con retención) son «A»; solo la 51 y la 53 llevan retención", () => {
    expect([1, 3, 51, 53].map(letraDe)).toEqual(["A", "A", "A", "A"]);
    expect([6, 8].map(letraDe)).toEqual(["B", "B"]);
    expect([51, 53].every(conRetencion)).toBe(true);
    expect([1, 3, 6, 8].some(conRetencion)).toBe(false);
  });

  it("cada factura se anula con SU nota de crédito, y la nota apunta a SU factura", () => {
    expect([1, 6, 51].map(tipoNotaDe)).toEqual([3, 8, 53]);
    expect([3, 8, 53].map(tipoFacturaDe)).toEqual([1, 6, 51]);
  });

  it("la Factura A sale con retención solo si el emisor lo tiene configurado; la B nunca", () => {
    expect(tipoDeFacturaAEmitir("A", false)).toBe(1);
    expect(tipoDeFacturaAEmitir("A", true)).toBe(51);
    expect(tipoDeFacturaAEmitir("B", true)).toBe(6);
    expect(tipoDeFacturaAEmitir("B", false)).toBe(6);
  });

  it("nombres legibles", () => {
    expect(nombreDeTipo(51)).toBe("Factura A (sujeta a retención)");
    expect(nombreDeTipo(53)).toMatch(/Nota de crédito A/);
    expect(nombreDeTipo(999)).toBe("Comprobante 999");
  });
});
