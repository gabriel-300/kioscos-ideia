import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["opsz", "SOFT", "WONK"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
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
      className={`${fraunces.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
