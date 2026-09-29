import qrcode from "qrcode-generator";

// QR como SVG escalable, generado en el servidor. Librería de JS puro (sin
// fs ni dependencias): las que escriben PNG/archivos rompen el build de
// Cloudflare Workers, como ya pasó con exceljs.
export function qrComoSvg(texto: string): string {
  const qr = qrcode(0, "M"); // tipo 0 = el tamaño mínimo que entre; "M" tolera un poco de suciedad en el papel
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
