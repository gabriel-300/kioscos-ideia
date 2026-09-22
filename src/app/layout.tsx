import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// Una sola familia para todo el admin y el login (titulares, interfaz y cifras).
// Variable: admite cualquier peso (los títulos usan 650). El catálogo público
// (/pedir) carga sus propias fuentes en su layout y no depende de esta.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "En Minutas — Cocina ultracongelada de Misiones",
    template: "%s · En Minutas",
  },
  description:
    "Bocaditos, chipas, pizzas y empanadas elaborados con materia prima del Litoral, cocidos en horno Rational y ultracongelados. Desde Posadas, Misiones.",
  keywords: [
    "chipa",
    "empanadas",
    "bocaditos",
    "finger food",
    "ultracongelado",
    "Posadas",
    "Misiones",
    "Argentina",
    "pacu",
    "masa madre",
  ],
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "En Minutas",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6B2417",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es-AR"
      className={archivo.variable}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
