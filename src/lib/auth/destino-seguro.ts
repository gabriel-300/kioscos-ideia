// Solo se acepta un destino interno: una ruta que empiece con UNA sola "/".
// `next=@sitio-malo.com` daba `https://<origen>@sitio-malo.com` (redirección
// abierta, auditoría 19/09, H-24); `//sitio-malo.com` y `/\sitio-malo.com`
// tampoco pasan. Lo usan los dos callbacks de auth (personal y clientes).
export function destinoSeguro(next: string | null, porDefecto: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return porDefecto;
  return next;
}
