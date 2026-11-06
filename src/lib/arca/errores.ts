// Traducción de errores de ARCA a un lenguaje que entienda quien está en el mostrador. Lógica pura.
// El texto original de ARCA se conserva siempre al final: es lo que hay que mostrarle al contador.

/** Mensaje claro para los rechazos más comunes; el resto se devuelve tal cual. */
export function explicarErrorArca(original: string): string {
  const t = original ?? "";
  // 10000 «no autorizado a emitir comprobantes clase A»: la habilitación es del EMISOR (la SAS), no del cliente.
  if (/CLASE\s*'?A'?/i.test(t) && /NO AUTORIZADO/i.test(t)) {
    return `ARCA todavía no habilita a la SAS para emitir la Factura A común. Sí puede emitir la Factura A «sujeta a retención» (activala en el emisor) o, mientras tanto, una Factura B. (ARCA: ${t})`;
  }
  return t;
}
