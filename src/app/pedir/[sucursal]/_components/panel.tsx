// Contenedor de las pantallas que van "encima" del catálogo (carrito,
// checkout, detalle, confirmación). En celular ocupa toda la pantalla; en
// pantallas anchas es un panel centrado (si no, el checkout se estira a los
// 1400px de una notebook y queda inusable).
export function Panel({ children, fondo = "bg-pd-paper", z = "z-40", animacion = "pd-slideup" }: {
  children: React.ReactNode; fondo?: string; z?: string; animacion?: string;
}) {
  return (
    <div className={`fixed inset-0 ${z} flex justify-center bg-pd-ink/55 md:items-center md:p-6`}>
      <div className={`${animacion} flex h-full w-full max-w-[520px] flex-col overflow-hidden ${fondo} md:h-auto md:max-h-full md:min-h-[min(760px,100%)] md:rounded-[28px] md:shadow-2xl`}>
        {children}
      </div>
    </div>
  );
}
