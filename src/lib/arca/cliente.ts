// Comunicación con ARCA (ex AFIP): WSAA (ticket de acceso) y WSFEv1 (factura electrónica).
// Probado en homologación el 2026-11-03 desde Node y desde el runtime de Workers (workerd).
// Sin dependencias de Supabase: recibe todo por parámetro.

import forge from "node-forge";

export type Ambiente = "homologacion" | "produccion";

// Verificar las URLs de producción contra la documentación de ARCA antes del primer uso real.
const URLS: Record<Ambiente, { wsaa: string; wsfe: string }> = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

/** Error de ARCA. `transitorio` = problema de red/servicio: se reintenta solo. Si no, ARCA rechazó el dato. */
export class ArcaError extends Error {
  constructor(message: string, public transitorio: boolean, public codigo?: string) {
    super(message);
    this.name = "ArcaError";
  }
}

export type Ticket = { token: string; sign: string; expiraEn: Date };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const tag = (xml: string, t: string) => xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1];

/** Los PEM en variables de entorno suelen llegar con "\n" literales. */
export function normalizarPem(pem: string): string {
  return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

async function soap(url: string, cuerpo: string, accion: string | null): Promise<string> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      body: cuerpo,
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: accion ? `"${accion}"` : '""' },
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw new ArcaError(`No se pudo conectar con ARCA: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  const txt = await r.text();
  if (r.status >= 500 && !txt.includes("Fault")) throw new ArcaError(`ARCA respondió HTTP ${r.status}`, true);
  return txt;
}

// ── WSAA ────────────────────────────────────────────────────────────────────
const ar = (d: Date) => new Date(d.getTime() - 3 * 3600e3).toISOString().replace(/\.\d+Z$/, "-03:00");

export function firmarTra(crtPem: string, keyPem: string, ahora = Date.now()): string {
  const tra =
    `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(ahora / 1000)}</uniqueId>` +
    `<generationTime>${ar(new Date(ahora - 600e3))}</generationTime>` +
    `<expirationTime>${ar(new Date(ahora + 600e3))}</expirationTime></header><service>wsfe</service></loginTicketRequest>`;
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  const cert = forge.pki.certificateFromPem(normalizarPem(crtPem));
  const key = forge.pki.privateKeyFromPem(normalizarPem(keyPem));
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/** ARCA responde esto cuando ya hay un ticket vigente y no deja pedir otro. */
export const TICKET_YA_EMITIDO = "alreadyAuthenticated";

export async function pedirTicket(ambiente: Ambiente, crtPem: string, keyPem: string): Promise<Ticket> {
  const cms = firmarTra(crtPem, keyPem);
  const xml =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const txt = await soap(URLS[ambiente].wsaa, xml, null);
  if (txt.includes("<faultstring>") || txt.includes("Fault")) {
    const msg = (tag(txt, "faultstring") ?? "error de WSAA").trim();
    const codigo = tag(txt, "faultcode")?.trim();
    throw new ArcaError(`WSAA: ${msg}`, codigo?.includes(TICKET_YA_EMITIDO) ?? false, codigo);
  }
  const ret = desescapar(txt);
  const token = tag(ret, "token"), sign = tag(ret, "sign"), exp = tag(ret, "expirationTime");
  if (!token || !sign || !exp) throw new ArcaError("WSAA no devolvió token/sign", true);
  return { token, sign, expiraEn: new Date(exp) };
}

// ── WSFEv1 ──────────────────────────────────────────────────────────────────
export type Auth = { ticket: Ticket; cuit: string };

async function fe(ambiente: Ambiente, auth: Auth, metodo: string, interior: string): Promise<string> {
  const xml =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/><soapenv:Body><ar:${metodo}><ar:Auth><ar:Token>${esc(auth.ticket.token)}</ar:Token>` +
    `<ar:Sign>${esc(auth.ticket.sign)}</ar:Sign><ar:Cuit>${esc(auth.cuit)}</ar:Cuit></ar:Auth>${interior}</ar:${metodo}></soapenv:Body></soapenv:Envelope>`;
  return soap(URLS[ambiente].wsfe, xml, `http://ar.gov.afip.dif.FEV1/${metodo}`);
}

const errores = (xml: string) =>
  [...xml.matchAll(/<Err><Code>(\d+)<\/Code><Msg>([^<]*)<\/Msg>/g)].map((m) => ({ codigo: m[1], mensaje: desescapar(m[2]) }));
const observaciones = (xml: string) =>
  [...xml.matchAll(/<Obs><Code>(\d+)<\/Code><Msg>([^<]*)<\/Msg>/g)].map((m) => ({ codigo: m[1], mensaje: desescapar(m[2]) }));

export async function ultimoAutorizado(amb: Ambiente, auth: Auth, ptoVta: number, tipo: number): Promise<number> {
  const xml = await fe(amb, auth, "FECompUltimoAutorizado", `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`);
  const n = tag(xml, "CbteNro");
  if (n === undefined) {
    const e = errores(xml)[0];
    throw new ArcaError(`ARCA no informó el último comprobante${e ? `: ${e.codigo} ${e.mensaje}` : ""}`, !e, e?.codigo);
  }
  return Number(n);
}

export type ComprobanteConsultado = { cae: string; caeVto: string; total: number; fecha: string } | null;

/** Busca un comprobante ya autorizado (null si no existe). Sirve para no duplicar tras un timeout. */
export async function consultarComprobante(amb: Ambiente, auth: Auth, ptoVta: number, tipo: number, numero: number): Promise<ComprobanteConsultado> {
  const xml = await fe(amb, auth, "FECompConsultar",
    `<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${numero}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`);
  const cae = tag(xml, "CodAutorizacion");
  if (!cae) {
    const e = errores(xml)[0];
    if (!e || e.codigo === "602") return null; // 602 = no existe
    throw new ArcaError(`Consulta de comprobante: ${e.codigo} ${e.mensaje}`, false, e.codigo);
  }
  return { cae, caeVto: tag(xml, "FchVto") ?? "", total: Number(tag(xml, "ImpTotal") ?? NaN), fecha: tag(xml, "CbteFch") ?? "" };
}

export type PedidoCae = {
  ptoVta: number;
  tipo: number;
  numero: number;
  fecha: string;              // yyyymmdd
  docTipo: number;
  docNro: string;
  condicionIvaReceptor: number;
  total: string; neto: string; iva: string;   // ya con dos decimales
  tramos: { idArca: number; base: string; importe: string }[];
  asociado?: { tipo: number; ptoVta: number; numero: number; cuit: string; fecha: string };
};

export type ResultadoCae =
  | { aprobado: true; cae: string; caeVto: string }
  | { aprobado: false; errores: string[] };

export async function solicitarCae(amb: Ambiente, auth: Auth, p: PedidoCae): Promise<ResultadoCae> {
  const asoc = p.asociado
    ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${p.asociado.tipo}</ar:Tipo><ar:PtoVta>${p.asociado.ptoVta}</ar:PtoVta><ar:Nro>${p.asociado.numero}</ar:Nro><ar:Cuit>${p.asociado.cuit}</ar:Cuit><ar:CbteFch>${p.asociado.fecha}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>`
    : "";
  const iva = p.tramos.map((t) => `<ar:AlicIva><ar:Id>${t.idArca}</ar:Id><ar:BaseImp>${t.base}</ar:BaseImp><ar:Importe>${t.importe}</ar:Importe></ar:AlicIva>`).join("");
  const xml = await fe(amb, auth, "FECAESolicitar",
    `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${p.ptoVta}</ar:PtoVta><ar:CbteTipo>${p.tipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>1</ar:Concepto><ar:DocTipo>${p.docTipo}</ar:DocTipo><ar:DocNro>${p.docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${p.numero}</ar:CbteDesde><ar:CbteHasta>${p.numero}</ar:CbteHasta><ar:CbteFch>${p.fecha}</ar:CbteFch>` +
    `<ar:ImpTotal>${p.total}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${p.neto}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx>` +
    `<ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${p.iva}</ar:ImpIVA><ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${p.condicionIvaReceptor}</ar:CondicionIVAReceptorId>${asoc}<ar:Iva>${iva}</ar:Iva>` +
    `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`);

  const cae = tag(xml, "CAE");
  if (tag(xml, "Resultado") !== undefined && cae && cae.trim() !== "") {
    const det = xml.match(/<FECAEDetResponse>[\s\S]*?<\/FECAEDetResponse>/)?.[0] ?? xml;
    if (tag(det, "Resultado") === "A") return { aprobado: true, cae, caeVto: tag(det, "CAEFchVto") ?? "" };
  }
  const msgs = [...errores(xml), ...observaciones(xml)].map((e) => `${e.codigo}: ${e.mensaje}`);
  if (msgs.length === 0 && !xml.includes("Resultado")) throw new ArcaError("Respuesta de ARCA ilegible", true);
  return { aprobado: false, errores: msgs.length ? msgs : ["ARCA rechazó el comprobante sin detalle"] };
}

/** Código de ARCA: "el número no es el próximo a autorizar". Pasa si dos facturas pidieron el mismo número a la vez. */
export const ERR_NUMERO_NO_CORRELATIVO = "10016";
