// Datos estructurados para Google (schema.org). El "<" se escapa para que ningún texto de la base pueda cerrar
// la etiqueta <script>.
export function JsonLd({ datos }: { datos: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datos).replace(/</g, "\\u003c") }} />;
}
