import { Bricolage_Grotesque, Archivo } from "next/font/google";

// Tipografía del catálogo público (ver ESPECIFICACION de diseño): Bricolage
// Grotesque para nombres/precios/títulos, Archivo para el resto. Se carga
// acá y no en el layout raíz para que no afecte al admin.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-pd-display",
  display: "swap",
  weight: ["600", "700", "800"],
});

const body = Archivo({
  subsets: ["latin"],
  variable: "--font-pd-body",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export default function PedirLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pd ${display.variable} ${body.variable}`}>{children}</div>;
}
