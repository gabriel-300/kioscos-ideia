import { createAdminClient } from "@/lib/supabase/server";

// Credenciales de Mercado Pago de cada sucursal (migración 134).
//   - Sucursal con fila en sucursal_mercadopago (local independiente, otra cuenta): usa SU token y SU usuario.
//   - Sin fila: las credenciales globales de IDEIA (MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_USER_ID), como siempre.
// El token se guarda cifrado con AES-GCM. La clave sale de MP_CREDENCIALES_KEY y, si no está, se deriva de
// SUPABASE_SERVICE_ROLE_KEY: así una filtración de la base sola no revela los tokens (la clave está en el servidor).

export interface CredencialesMp {
  accessToken: string;
  userId: string;
  /** true = cuenta propia de la sucursal; false = la cuenta de IDEIA. */
  propia: boolean;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function aBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function deBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function claveAes(secreto: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(`mp-credenciales:${secreto}`));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function secretoDeCifrado(): string | null {
  return process.env.MP_CREDENCIALES_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

/** Cifra `texto` con el secreto dado. Formato: base64(iv).base64(cifrado). */
export async function cifrar(texto: string, secreto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveAes(secreto), enc.encode(texto)));
  return `${aBase64(iv)}.${aBase64(ct)}`;
}

/** Inversa de cifrar. Lanza si el secreto no es el mismo o el dato fue alterado. */
export async function descifrar(valor: string, secreto: string): Promise<string> {
  const [iv, ct] = valor.split(".");
  if (!iv || !ct) throw new Error("Formato de credencial inválido");
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: deBase64(iv) as BufferSource },
    await claveAes(secreto),
    deBase64(ct) as BufferSource,
  );
  return dec.decode(claro);
}

export async function cifrarToken(token: string): Promise<string> {
  const secreto = secretoDeCifrado();
  if (!secreto) throw new Error("Falta la clave para cifrar las credenciales (MP_CREDENCIALES_KEY)");
  return cifrar(token, secreto);
}

/** Credenciales de IDEIA (las globales), o null si no están cargadas. */
export function credencialesIdeia(): CredencialesMp | null {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return null;
  // El usuario solo hace falta para armar el QR del mostrador; el cobro online y el aviso de pago usan solo el token.
  return { accessToken, userId: process.env.MERCADOPAGO_USER_ID ?? "", propia: false };
}

/**
 * Credenciales con las que cobra esa sucursal. null = no hay ninguna disponible.
 * Un local independiente (catalogo_propio) NUNCA cae a la cuenta de IDEIA: si no cargó la suya, o no se puede
 * leer, devuelve null. La plata de un local independiente jamás debe entrar a la cuenta de IDEIA.
 */
export async function credencialesDeSucursal(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
): Promise<CredencialesMp | null> {
  const { data } = await (admin as any)
    .from("sucursal_mercadopago")
    .select("access_token_cifrado, mp_user_id")
    .eq("sucursal_id", sucursalId)
    .maybeSingle();
  if (!data) {
    const { data: suc } = await (admin as any).from("sucursales").select("catalogo_propio").eq("id", sucursalId).maybeSingle();
    if (suc?.catalogo_propio) return null;
    return credencialesIdeia();
  }
  const secreto = secretoDeCifrado();
  if (!secreto) return null;
  try {
    const accessToken = await descifrar((data as { access_token_cifrado: string }).access_token_cifrado, secreto);
    return { accessToken, userId: (data as { mp_user_id: string }).mp_user_id, propia: true };
  } catch {
    return null;
  }
}
