// Desglose de IVA para facturación electrónica. Lógica pura, sin red ni base.
//
// El precio del sistema es FINAL (IVA incluido). Para la Factura B se separa
// hacia atrás: neto = total ÷ (1 + alícuota), IVA = total − neto. El IVA es
// siempre la DIFERENCIA, nunca neto × alícuota, para que neto + IVA dé exactamente
// el total (ARCA rechaza el comprobante si no cierra al centavo).
//
// Todo se calcula en CENTAVOS enteros: sumar floats de JS deja arrastres tipo
// 1199.9999999999998 (mismo motivo que redondearMoneda en el resto del sistema).

export type LineaIva = { subtotal: number; alicuota: number };

export type TramoIva = {
  alicuota: number;      // 0 | 10.5 | 21 | 27
  idArca: number;        // Id de alícuota en ARCA (3, 4, 5, 6)
  base: number;          // neto de ese tramo, en pesos
  importe: number;       // IVA de ese tramo, en pesos
};

export type DesgloseIva = {
  total: number;
  neto: number;
  iva: number;
  tramos: TramoIva[];
};

// Códigos de alícuota de ARCA (FEParamGetTiposIva).
const ID_ARCA: Record<number, number> = { 0: 3, 10.5: 4, 21: 5, 27: 6 };

export function idAlicuotaArca(alicuota: number): number {
  const id = ID_ARCA[alicuota];
  if (id === undefined) throw new Error(`Alícuota de IVA no soportada: ${alicuota}`);
  return id;
}

const aCentavos = (n: number) => Math.round(n * 100);
const aPesos = (c: number) => c / 100;

export function desglosarIva(lineas: LineaIva[]): DesgloseIva {
  const porAlicuota = new Map<number, number>(); // alícuota -> total en centavos
  for (const l of lineas) {
    if (!Number.isFinite(l.subtotal)) throw new Error("Una línea de la venta no tiene subtotal");
    idAlicuotaArca(l.alicuota); // valida
    porAlicuota.set(l.alicuota, (porAlicuota.get(l.alicuota) ?? 0) + aCentavos(l.subtotal));
  }

  const tramos: TramoIva[] = [];
  let totalC = 0, netoC = 0, ivaC = 0;
  for (const [alicuota, tC] of [...porAlicuota.entries()].sort((a, b) => a[0] - b[0])) {
    if (tC <= 0) continue; // un tramo en cero no se informa
    const nC = alicuota === 0 ? tC : Math.round(tC / (1 + alicuota / 100));
    const iC = tC - nC;
    tramos.push({ alicuota, idArca: idAlicuotaArca(alicuota), base: aPesos(nC), importe: aPesos(iC) });
    totalC += tC; netoC += nC; ivaC += iC;
  }

  return { total: aPesos(totalC), neto: aPesos(netoC), iva: aPesos(ivaC), tramos };
}

/** Importe con dos decimales como lo pide ARCA ("1210.00"). */
export const importeArca = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
