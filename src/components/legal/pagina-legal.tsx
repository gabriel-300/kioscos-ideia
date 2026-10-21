import PedirLayout from "@/app/pedir/layout";

// Marco común de las páginas legales públicas (privacidad y términos): mismo estilo que la tienda,
// sin sesión. Las exigen Google (para publicar el ingreso con Google) y Meta (WhatsApp Business).

export const CONTACTO_LEGAL = "lytwyn.gabriel@gmail.com";
export const FECHA_LEGAL = "21 de octubre de 2026";

export function PaginaLegal({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <PedirLayout>
      <main className="mx-auto min-h-screen w-full max-w-[720px] px-5 pb-16 pt-10">
        <a href="/" style={{ color: "var(--color-pd-ember)" }} className="pd-display text-[14px] font-bold">← Angiru Food</a>
        <h1 className="mt-4 text-[30px] leading-tight">{titulo}</h1>
        <p className="mt-1 text-[13px] text-pd-ink-400">Última actualización: {FECHA_LEGAL}</p>
        <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-pd-ink-900 [&_h2]:mt-8 [&_h2]:text-[19px] [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </main>
    </PedirLayout>
  );
}
