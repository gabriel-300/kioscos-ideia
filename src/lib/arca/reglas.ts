// Cuándo corresponde facturar. Lógica pura.
//
// Decisión del dueño (2026-11-03): lo cobrado por medios digitales (billetera/MP,
// tarjeta, QR, transferencia) se factura SIEMPRE y sola; el efectivo solo si el
// cliente pide el comprobante (botón manual). Si una venta mezcla efectivo con un
// cobro digital se factura la venta ENTERA: el comprobante no se puede partir por
// medio de pago.

export type VentaParaFacturar = {
  tipo: string;
  canal: string | null;
  anulado_en: string | null;
  pago_efectivo: number | null;
  pago_billetera: number | null;
  pago_tarjeta: number | null;
  pago_transferencia: number | null;
};

// Canales donde no hay cobro al cliente en el momento: el fiado se factura
// cuando se cobra, y lo de Pedido Ya Plataforma lo cobra y liquida Pedido Ya.
export const CANALES_SIN_FACTURA_AUTOMATICA = ["cuenta_corriente", "pedido_ya_plataforma"] as const;

export function montoDigital(v: Pick<VentaParaFacturar, "pago_billetera" | "pago_tarjeta" | "pago_transferencia">): number {
  return Math.round(((v.pago_billetera ?? 0) + (v.pago_tarjeta ?? 0) + (v.pago_transferencia ?? 0)) * 100) / 100;
}

export function debeFacturarseSola(v: VentaParaFacturar): boolean {
  if (v.tipo !== "venta" || v.anulado_en) return false;
  if ((CANALES_SIN_FACTURA_AUTOMATICA as readonly string[]).includes(v.canal ?? "")) return false;
  return montoDigital(v) > 0;
}

/** Documento del receptor. Consumidor final sin datos: tipo 99, número 0. */
export type Receptor = { docTipo: 99 | 96 | 80; docNro: string; condicionIva: number };

// Condición frente al IVA del receptor (FEParamGetCondicionIvaReceptor):
// 5 = Consumidor Final, 1 = Responsable Inscripto, 6 = Monotributo.
export const COND_IVA_CONSUMIDOR_FINAL = 5;

export function normalizarReceptor(doc?: string | null): { receptor?: Receptor; error?: string } {
  const limpio = (doc ?? "").replace(/[^0-9]/g, "");
  if (!limpio) return { receptor: { docTipo: 99, docNro: "0", condicionIva: COND_IVA_CONSUMIDOR_FINAL } };
  if (limpio.length === 11) {
    if (!cuitValido(limpio)) return { error: "El CUIT no es válido (dígito verificador)." };
    return { receptor: { docTipo: 80, docNro: limpio, condicionIva: COND_IVA_CONSUMIDOR_FINAL } };
  }
  if (limpio.length >= 7 && limpio.length <= 8) {
    return { receptor: { docTipo: 96, docNro: limpio, condicionIva: COND_IVA_CONSUMIDOR_FINAL } };
  }
  return { error: "Ingresá un DNI (7 u 8 dígitos) o un CUIT (11 dígitos), o dejalo vacío." };
}

export function cuitValido(cuit: string): boolean {
  if (!/^[0-9]{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return dv === Number(cuit[10]);
}
