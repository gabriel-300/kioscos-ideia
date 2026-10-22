// Archivos de verificación de propiedad de Google Search Console para www.angirufood.com.ar.
//
// Google pide un archivo en la raíz que responda 200 en esa URL exacta. Como archivo estático
// (public/) Cloudflare lo redirige a la URL sin ".html" (307) y Google puede no aceptarlo; por eso
// cada archivo se sirve desde una ruta del sitio (src/app/google<código>.html/route.ts). Hay que
// dejarlos mientras se quiera mantener la verificación.
export function respuestaVerificacionGoogle(nombreArchivo: string): Response {
  return new Response(`google-site-verification: ${nombreArchivo}`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
