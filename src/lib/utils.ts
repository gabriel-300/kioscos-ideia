import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Cantidad en kg: sin ceros de relleno (2 -> "2", 2.5 -> "2.5", 2.567 -> "2.567").
// Antes cada pantalla (venta rápida, stock, informe de ventas) redondeaba/formateaba
// distinto y el mismo peso se veía con una cantidad de decimales distinta según
// dónde se mirara.
export function formatKg(qty: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(qty);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(date));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// Cuando el servidor se redeploya mientras alguien tenía una pantalla abierta,
// el botón de guardar queda apuntando a una Server Action que ya no existe en
// el build nuevo -- Next.js tira un mensaje técnico ("Server Action '...' was
// not found on the server") que un vendedor/encargado no puede accionar. Acá
// se traduce a instrucción clara; cualquier otro error (de negocio, ya
// redactado a mano en la action) pasa intacto.
export function friendlyError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("failed-to-find-server-action") || message.includes("was not found on the server")) {
    return "La aplicación se actualizó mientras tenías esta pantalla abierta. Recargá la página (F5) y volvé a intentar.";
  }
  return message;
}

export function validateCuit(cuit: string): boolean {
  const clean = cuit.replace(/[-\s]/g, "");
  if (!/^\d{11}$/.test(clean)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(clean[i]), 0);
  const mod = 11 - (sum % 11);
  const verifier = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return verifier === parseInt(clean[10]);
}
