import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Cuenta en revisión — En Minutas" };

export default function PendientePage() {
  return (
    <div className="w-full max-w-sm text-center">
      <div className="size-12 rounded-full bg-tierra-700 text-white flex items-center justify-center mx-auto mb-6 font-display font-bold text-lg">
        EM
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-8">
        <div className="size-12 rounded-full bg-warning-bg flex items-center justify-center mx-auto mb-4">
          <svg className="size-6 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </div>

        <h1 className="font-display text-xl font-semibold text-neutral-900 mb-2">
          Cuenta en revisión
        </h1>
        <p className="text-sm text-neutral-500 leading-relaxed">
          Recibimos tu solicitud. El equipo de En Minutas la revisará y te notificará por email cuando tu cuenta esté activa.
        </p>

        <p className="text-xs text-neutral-400 mt-4">
          Tiempo estimado: 1 día hábil
        </p>
      </div>

      <p className="text-center text-sm text-neutral-500 mt-4">
        ¿Preguntas?{" "}
        <a
          href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`}
          className="text-tierra-700 font-medium hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Escribinos por WhatsApp
        </a>
      </p>
    </div>
  );
}
