import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcaError, puntosDeVenta } from "@/lib/arca/cliente";

const auth = { ticket: { token: "t", sign: "s", expiraEn: new Date() }, cuit: "30719673623" };
const respuesta = (cuerpo: string) => vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, text: async () => cuerpo })));
afterEach(() => vi.unstubAllGlobals());

describe("puntosDeVenta (FEParamGetPtosVenta)", () => {
  it("lee los puntos de venta con su tipo de emisión, bloqueo y baja", async () => {
    respuesta(`<soap:Body><FEParamGetPtosVentaResponse><FEParamGetPtosVentaResult><ResultGet>
      <PtoVenta><Nro>2</Nro><EmisionTipo>CAE - Ri Iva</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta>
      <PtoVenta><Nro>3</Nro><EmisionTipo>CAE - Ri Iva</EmisionTipo><Bloqueado>S</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta>
      <PtoVenta><Nro>4</Nro><EmisionTipo>CAE - Ri Iva</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>20261101</FchBaja></PtoVenta>
    </ResultGet></FEParamGetPtosVentaResult></FEParamGetPtosVentaResponse></soap:Body>`);
    expect(await puntosDeVenta("produccion", auth)).toEqual([
      { nro: 2, emision: "CAE - Ri Iva", bloqueado: false, baja: false },
      { nro: 3, emision: "CAE - Ri Iva", bloqueado: true, baja: false },
      { nro: 4, emision: "CAE - Ri Iva", bloqueado: false, baja: true },
    ]);
  });

  it("'Sin resultados' (602) es una lista vacía, no un error (así responde la homologación)", async () => {
    respuesta(`<Errors><Err><Code>602</Code><Msg>Sin Resultados: - Metodo FEParamGetPtosVenta</Msg></Err></Errors>`);
    expect(await puntosDeVenta("homologacion", auth)).toEqual([]);
  });

  it("cualquier otro error de ARCA se informa", async () => {
    respuesta(`<Errors><Err><Code>600</Code><Msg>Validación de Token: No apareció CUIT en lista de relaciones</Msg></Err></Errors>`);
    const e = await puntosDeVenta("produccion", auth).catch((x) => x);
    expect(e).toBeInstanceOf(ArcaError);
    expect(e.message).toMatch(/600/);
  });
});
