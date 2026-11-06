import { describe, expect, it } from "vitest";
import { filtrarFacturas, numeroImpreso, type FilaFactura } from "@/lib/arca/buscar";
import type { ComprobanteVenta } from "@/lib/arca/ticket-html";

const comp = (extra: Partial<ComprobanteVenta> = {}): ComprobanteVenta => ({
  movimiento_id: "m", cbte_tipo: 6, punto_venta: 2, numero: 1, fecha: "2026-11-06", estado: "emitido", cae: "1", cae_vto: "2026-11-16",
  doc_tipo: 99, doc_nro: "0", imp_total: 8000, imp_neto: 6611.57, imp_iva: 1388.43, ambiente: "produccion", error: null, emisor: null, ...extra,
});
const fila = (id: string, c: Partial<ComprobanteVenta>, productos: string[] = ["Empanada Pollo"]): FilaFactura => ({
  movimientoId: id, fecha: "2026-11-06", creadaEn: "2026-11-06T18:00:00Z",
  lineas: productos.map((p) => ({ nombre: p, cantidad: 1, precio: 1, subtotal: 1 })), comprobante: comp(c),
});

const FACTURAS = [
  fila("a", { numero: 1, imp_total: 8000 }, ["Empanada Pollo", "Pan Miñon"]),
  fila("b", { numero: 2, imp_total: 100, doc_tipo: 96, doc_nro: "30381202" }, ["Chipa Bocadito"]),
  fila("c", { numero: 14, punto_venta: 3, imp_total: 2500.5, cbte_tipo: 51, doc_tipo: 80, doc_nro: "20302371866" }, ["Agua"]),
];

describe("filtrarFacturas", () => {
  it("sin texto devuelve todas", () => {
    expect(filtrarFacturas(FACTURAS, "")).toHaveLength(3);
    expect(filtrarFacturas(FACTURAS, "   ")).toHaveLength(3);
  });
  it("busca por número impreso, por número suelto y por punto de venta", () => {
    expect(filtrarFacturas(FACTURAS, "00002-00000001").map((f) => f.movimientoId)).toEqual(["a"]);
    expect(filtrarFacturas(FACTURAS, "0000200000001").map((f) => f.movimientoId)).toEqual(["a"]);
    expect(filtrarFacturas(FACTURAS, "pv 3").map((f) => f.movimientoId)).toEqual(["c"]);
  });
  it("busca por importe (entero, con decimales o formato argentino)", () => {
    expect(filtrarFacturas(FACTURAS, "8000").map((f) => f.movimientoId)).toEqual(["a"]);
    expect(filtrarFacturas(FACTURAS, "2500,5").map((f) => f.movimientoId)).toEqual(["c"]);
    expect(filtrarFacturas(FACTURAS, "2500.50").map((f) => f.movimientoId)).toEqual(["c"]);
  });
  it("busca por documento del cliente y por «consumidor final»", () => {
    expect(filtrarFacturas(FACTURAS, "30381202").map((f) => f.movimientoId)).toEqual(["b"]);
    expect(filtrarFacturas(FACTURAS, "20302371866").map((f) => f.movimientoId)).toEqual(["c"]);
    expect(filtrarFacturas(FACTURAS, "consumidor final").map((f) => f.movimientoId)).toEqual(["a"]);
  });
  it("busca por producto sin importar acentos ni mayúsculas, y exige todas las palabras", () => {
    expect(filtrarFacturas(FACTURAS, "MIÑON").map((f) => f.movimientoId)).toEqual(["a"]);
    expect(filtrarFacturas(FACTURAS, "minon").map((f) => f.movimientoId)).toEqual(["a"]);
    expect(filtrarFacturas(FACTURAS, "empanada 8000")).toHaveLength(1);
    expect(filtrarFacturas(FACTURAS, "empanada 100")).toHaveLength(0);
  });
  it("busca por letra y no encuentra lo que no está", () => {
    expect(filtrarFacturas(FACTURAS, "factura a").map((f) => f.movimientoId)).toEqual(["c"]);
    expect(filtrarFacturas(FACTURAS, "zzz")).toEqual([]);
  });
});

describe("numeroImpreso", () => {
  it("lo arma con ceros y vacío si no hay número", () => {
    expect(numeroImpreso({ punto_venta: 2, numero: 1 })).toBe("00002-00000001");
    expect(numeroImpreso({ punto_venta: 3, numero: null })).toBe("");
  });
});
