// Íconos mínimos del catálogo público (trazo de 2px, heredan currentColor).
type P = { className?: string };
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconBuscar = ({ className }: P) => (
  <svg {...base} className={className}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const IconAtras = ({ className }: P) => (
  <svg {...base} className={className}><path d="M15 5l-7 7 7 7" /></svg>
);
export const IconChevron = ({ className }: P) => (
  <svg {...base} className={className}><path d="M9 5l7 7-7 7" /></svg>
);
export const IconMas = ({ className }: P) => (
  <svg {...base} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMenos = ({ className }: P) => (
  <svg {...base} className={className}><path d="M5 12h14" /></svg>
);
export const IconCerrar = ({ className }: P) => (
  <svg {...base} className={className}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconCheck = ({ className }: P) => (
  <svg {...base} strokeWidth={2.6} className={className}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
