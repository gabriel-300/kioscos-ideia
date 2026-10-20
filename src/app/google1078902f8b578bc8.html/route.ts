// Verificación de propiedad de Google Search Console para www.angirufood.com.ar.
//
// Google pide un archivo en la raíz que responda 200 en esta URL exacta. Como archivo estático
// (public/) Cloudflare lo redirige a la URL sin ".html" (307), y Google puede no aceptarlo; por eso
// se sirve desde una ruta del sitio. Hay que dejarlo mientras se quiera mantener la verificación.
export function GET() {
  return new Response("google-site-verification: google1078902f8b578bc8.html", {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
