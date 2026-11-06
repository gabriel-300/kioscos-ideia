// QR obligatorio de los comprobantes electrónicos (RG 4291). El QR lleva a la página de ARCA donde
// cualquiera verifica que el comprobante existe. Especificación: https://www.afip.gob.ar/fe/qr/especificaciones.asp

export type DatosQr = {
  fecha: string;         // yyyy-mm-dd
  cuit: string;          // emisor
  puntoVenta: number;
  tipoCmp: number;       // 6 = Factura B, 8 = Nota de crédito B
  numero: number;
  importe: number;
  docTipo: number;       // 99 consumidor final
  docNro: string;
  cae: string;
};

export function urlQrArca(d: DatosQr): string {
  const json = {
    ver: 1,
    fecha: d.fecha,
    cuit: Number(d.cuit),
    ptoVta: d.puntoVenta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.numero,
    importe: Math.round(d.importe * 100) / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: d.docTipo,
    nroDocRec: Number(d.docNro),
    tipoCodAut: "E",
    codAut: Number(d.cae),
  };
  const b64 = typeof btoa === "function"
    ? btoa(unescape(encodeURIComponent(JSON.stringify(json))))
    : Buffer.from(JSON.stringify(json)).toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
}
