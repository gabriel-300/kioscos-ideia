import type { CSSProperties } from "react";

// Formato de precio del diseño: "$ 1.200" con espacio fino, sin decimales.
const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
export function fmt(n: number): string {
  return `$ ${NUM.format(Math.round(n))}`;
}

export function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const GRADIENTES: Record<string, [string, string]> = {
  promos:     ["#E8552F", "#F0A03C"],
  minutas:    ["#C24A1E", "#E8A03E"],
  bebidas:    ["#2E6F8E", "#6FC2D6"],
  panaderia:  ["#A9722A", "#E2BC72"],
  confiteria: ["#B8365F", "#EE86A6"],
  kiosko:     ["#6B4BC2", "#AE93EA"],
  congeladas: ["#2F7A6B", "#7FCBB4"],
};
const CLAVES = Object.keys(GRADIENTES);

// Las categorías reales de cada sucursal no siempre coinciden con las del
// diseño (ej. "MINUTAS CONG" = congeladas) -- se reconoce por palabra clave y,
// si no matchea nada, se elige una de la paleta según el nombre para que
// siempre sea la misma.
export function claveCategoria(nombre: string): string {
  const n = sinTildes(nombre);
  if (n.includes("promo")) return "promos";
  if (n.includes("cong")) return "congeladas";
  if (n.includes("minuta")) return "minutas";
  if (n.includes("beb")) return "bebidas";
  if (n.includes("panad")) return "panaderia";
  if (n.includes("confit")) return "confiteria";
  if (n.includes("kiosk") || n.includes("quiosc")) return "kiosko";
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CLAVES[h % CLAVES.length];
}

export function estiloGradiente(nombreCategoria: string): CSSProperties {
  const [a, b] = GRADIENTES[claveCategoria(nombreCategoria)];
  return {
    background: `linear-gradient(145deg, ${a}, ${b})`,
    boxShadow: "inset 0 -40px 60px -30px rgba(0,0,0,.35), inset 0 30px 50px -30px rgba(255,255,255,.4)",
  };
}

const ARTICULOS = new Set(["de", "del", "la", "las", "los", "el", "y", "e"]);

// "Parque de las Fiestas" -> ["PARQUE", "FIESTAS"] para el logo generado.
export function lineasLogo(nombre: string): string[] {
  const palabras = nombre.trim().split(/\s+/).filter((w) => !ARTICULOS.has(w.toLowerCase()));
  const base = palabras.length > 0 ? palabras : nombre.trim().split(/\s+/);
  return base.slice(0, 2).map((w) => w.toUpperCase());
}
