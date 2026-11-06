// Tipos de comprobante de ARCA que usa el sistema. Lógica pura; es la única fuente de estos códigos.
//
//   1  Factura A                       3  Nota de crédito A
//   6  Factura B                       8  Nota de crédito B
//  51  Factura A con leyenda «Operación sujeta a retención»
//  53  Nota de crédito A con la misma leyenda
//
// El 51 es lo que ARCA deja emitir a un Responsable Inscripto al que todavía no le habilitó la Factura A común
// (le rechaza el código 1 con «10000: no autorizado a emitir comprobantes clase A»). El cliente que lo recibe
// retiene (IVA y Ganancias). Los códigos y sus nombres salen de FEParamGetTiposCbte de ARCA.

export const FACTURA_A = 1;
export const NOTA_CREDITO_A = 3;
export const FACTURA_B = 6;
export const NOTA_CREDITO_B = 8;
export const FACTURA_A_RET = 51;
export const NOTA_CREDITO_A_RET = 53;

/** Las facturas (no las notas de crédito). */
export const TIPOS_FACTURA: number[] = [FACTURA_A, FACTURA_B, FACTURA_A_RET];

export const esFactura = (tipo: number) => TIPOS_FACTURA.includes(tipo);
export const esNotaDeCredito = (tipo: number) => tipo === NOTA_CREDITO_A || tipo === NOTA_CREDITO_B || tipo === NOTA_CREDITO_A_RET;
export const conRetencion = (tipo: number) => tipo === FACTURA_A_RET || tipo === NOTA_CREDITO_A_RET;

/** Letra del comprobante: las dos clases A (común y con retención) son «A». */
export const letraDe = (tipo: number): "A" | "B" =>
  tipo === FACTURA_A || tipo === NOTA_CREDITO_A || tipo === FACTURA_A_RET || tipo === NOTA_CREDITO_A_RET ? "A" : "B";

/** Nota de crédito que anula una factura. */
export function tipoNotaDe(factura: number): number {
  if (factura === FACTURA_A) return NOTA_CREDITO_A;
  if (factura === FACTURA_A_RET) return NOTA_CREDITO_A_RET;
  return NOTA_CREDITO_B;
}

/** Factura que anula una nota de crédito (para el comprobante asociado). */
export function tipoFacturaDe(nota: number): number {
  if (nota === NOTA_CREDITO_A) return FACTURA_A;
  if (nota === NOTA_CREDITO_A_RET) return FACTURA_A_RET;
  return FACTURA_B;
}

/** Tipo de factura a emitir. La A sale con retención si el emisor lo tiene configurado así. */
export function tipoDeFacturaAEmitir(letra: "A" | "B", emisorConRetencion: boolean): number {
  if (letra === "B") return FACTURA_B;
  return emisorConRetencion ? FACTURA_A_RET : FACTURA_A;
}

const NOMBRES: Record<number, string> = {
  [FACTURA_A]: "Factura A", [NOTA_CREDITO_A]: "Nota de crédito A",
  [FACTURA_B]: "Factura B", [NOTA_CREDITO_B]: "Nota de crédito B",
  [FACTURA_A_RET]: "Factura A (sujeta a retención)", [NOTA_CREDITO_A_RET]: "Nota de crédito A (sujeta a retención)",
};
export const nombreDeTipo = (tipo: number) => NOMBRES[tipo] ?? `Comprobante ${tipo}`;
