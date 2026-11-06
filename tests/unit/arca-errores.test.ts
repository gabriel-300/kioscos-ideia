import { describe, expect, it } from "vitest";
import { explicarErrorArca } from "@/lib/arca/errores";
import { esFacturaRechazada } from "@/lib/arca/reglas";

describe("explicarErrorArca", () => {
  const original = "10000: NO AUTORIZADO A EMITIR COMPROBANTES - LA CUIT INFORMADA NO SE ENCUENTRA AUTORIZADA A EMITIR COMPROBANTES CLASE 'A'";

  it("explica en castellano que la SAS no está habilitada para Factura A y conserva el texto de ARCA", () => {
    const t = explicarErrorArca(original);
    expect(t).toMatch(/todavía no habilita a la SAS para emitir Factura A/);
    expect(t).toMatch(/Emití una Factura B/);
    expect(t).toContain(original);          // lo que hay que mostrarle al contador
  });

  it("cualquier otro error de ARCA se devuelve tal cual", () => {
    expect(explicarErrorArca("10016: El número no es el próximo")).toBe("10016: El número no es el próximo");
    expect(explicarErrorArca("")).toBe("");
  });

  it("'NO AUTORIZADO' sin hablar de clase A no se confunde con el caso de la Factura A", () => {
    expect(explicarErrorArca("10000: NO AUTORIZADO A EMITIR COMPROBANTES - OTRO MOTIVO")).toBe("10000: NO AUTORIZADO A EMITIR COMPROBANTES - OTRO MOTIVO");
  });
});

describe("esFacturaRechazada (se puede descartar y emitir de nuevo)", () => {
  it("error y sin número: rechazada por ARCA, nunca existió", () => {
    expect(esFacturaRechazada({ estado: "error", numero: null })).toBe(true);
    expect(esFacturaRechazada({ estado: "error", numero: 0 })).toBe(true);
  });
  it("pendiente NO: un intento cortado por timeout pudo haber sido autorizado", () => {
    expect(esFacturaRechazada({ estado: "pendiente", numero: null })).toBe(false);
  });
  it("emitida NO, y nada con número se descarta nunca", () => {
    expect(esFacturaRechazada({ estado: "emitido", numero: 5 })).toBe(false);
    expect(esFacturaRechazada({ estado: "error", numero: 5 })).toBe(false);
    expect(esFacturaRechazada({ estado: "error", numero: "17" })).toBe(false);
  });
});
