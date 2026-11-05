// Llamadas a la API de Mercado Pago que dependen de QUÉ cuenta se use (token explícito): Cajas y datos de la cuenta.

export interface CajaMp { internalId: string; externalId: string | null; name: string; store_id: string | null }

/** Lista las Cajas (puntos de venta) de la cuenta dueña del token. */
export async function listarCajasConToken(accessToken: string): Promise<{ error?: string; cajas?: CajaMp[] }> {
  const res = await fetch("https://api.mercadopago.com/pos?limit=50", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { error: `Mercado Pago respondió ${res.status}: ${bodyText || "sin detalle"}` };
  }
  // El "id" interno NO es el external_id: las órdenes de QR se arman contra external_id. Las Cajas creadas a mano
  // desde "Cobrar en tu local" no lo tienen (se les asigna uno aparte).
  const body = await res.json() as { results?: { id: number; external_id: string | null; name: string; store_id: number | null }[] };
  const cajas = (body.results ?? []).map((p) => ({
    internalId: String(p.id),
    externalId: p.external_id || null,
    name:       p.name,
    store_id:   p.store_id != null ? String(p.store_id) : null,
  }));
  if (cajas.length === 0) return { error: "No se encontraron Cajas en la cuenta de Mercado Pago" };
  return { cajas };
}

/** Le asigna un external_id a una Caja que no lo tiene (solo alfanumérico, máx. 40 caracteres). */
export async function asignarExternalIdConToken(
  accessToken: string,
  internalId: string,
  nombreSugerido: string,
): Promise<{ error?: string; externalId?: string }> {
  const base = nombreSugerido.normalize("NFD").replace(/[^a-zA-Z0-9]/g, "");
  const externalId = `${base.slice(0, 30)}${internalId}`.slice(0, 40);
  const res = await fetch(`https://api.mercadopago.com/pos/${internalId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ external_id: externalId }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { error: `Mercado Pago respondió ${res.status}: ${bodyText || "sin detalle"}` };
  }
  return { externalId };
}

/** Verifica el token contra Mercado Pago y devuelve a qué cuenta pertenece. */
export async function cuentaDelToken(accessToken: string): Promise<{ error?: string; userId?: string; cuenta?: string }> {
  const res = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    return { error: res.status === 401 ? "Mercado Pago no reconoce ese Access Token. Revisá que sea el de producción." : `Mercado Pago respondió ${res.status}` };
  }
  const u = await res.json() as { id?: number | string; nickname?: string; email?: string };
  if (u.id == null) return { error: "Mercado Pago no devolvió la cuenta de ese token" };
  return { userId: String(u.id), cuenta: u.nickname || u.email || String(u.id) };
}
