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
  if (cajas.length === 0) {
    return { error: "No se encontraron Cajas en esta cuenta de Mercado Pago. Revisá que la Caja se haya creado en la MISMA cuenta que conectaste (el número de cuenta figura arriba) y, si es recién creada, esperá un par de minutos." };
  }
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

/**
 * Verifica el token contra Mercado Pago y devuelve a qué cuenta pertenece.
 * Primero pregunta por la cuenta (/users/me). Las aplicaciones de QR a veces no tienen permiso para esa consulta
 * (403): en ese caso se verifica con la consulta de Cajas, que es la que el QR usa igual, y el usuario sale de la
 * Caja o, si todavía no hay ninguna, del final del propio token (APP_USR-…-<usuario>).
 */
export async function cuentaDelToken(accessToken: string): Promise<{ error?: string; userId?: string; cuenta?: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const yo = await fetch("https://api.mercadopago.com/users/me", { headers });
  if (yo.ok) {
    const u = await yo.json() as { id?: number | string; nickname?: string; email?: string };
    if (u.id != null) return { userId: String(u.id), cuenta: u.nickname || u.email || String(u.id) };
  }
  if (yo.status === 401) return { error: "Mercado Pago no reconoce ese Access Token. Revisá que sea el de producción y que esté completo." };

  const pos = await fetch("https://api.mercadopago.com/pos?limit=1", { headers });
  if (pos.status === 401) return { error: "Mercado Pago no reconoce ese Access Token. Revisá que sea el de producción y que esté completo." };
  // Mercado Pago responde 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES también cuando el token no existe o no es de esa
  // cuenta (se comprobó con un token inventado): así que acá lo más probable es un token mal copiado.
  if (pos.status === 403 && yo.status === 403) {
    return { error: "Mercado Pago no aceptó ese token (error 403). Revisá que sea el Access Token de PRODUCCIÓN de tu aplicación, copiado completo; si recién activaste las credenciales, esperá unos minutos y probá de nuevo." };
  }
  if (!pos.ok) {
    const detalle = (await pos.text().catch(() => "")).slice(0, 300);
    return { error: `Mercado Pago respondió ${pos.status}${detalle ? `: ${detalle}` : ""}. Revisá que la aplicación sea de Pagos presenciales (Código QR) y que las credenciales de producción estén activadas.` };
  }
  const body = await pos.json().catch(() => ({})) as { results?: { user_id?: number | string }[] };
  const desdeCaja = body.results?.[0]?.user_id;
  const desdeToken = /-([0-9]{3,20})$/.exec(accessToken)?.[1];
  const userId = desdeCaja != null ? String(desdeCaja) : desdeToken;
  if (!userId) return { error: "No se pudo saber a qué cuenta pertenece el token. Creá primero una Caja en Mercado Pago y probá de nuevo." };
  return { userId, cuenta: `cuenta ${userId}` };
}
