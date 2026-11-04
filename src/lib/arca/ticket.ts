// Ticket de acceso de ARCA, compartido entre todas las instancias del Worker vía la tabla
// arca_tickets. ARCA no deja pedir un ticket nuevo mientras el anterior sirve, así que
// primero se mira la base y solo se pide uno si falta o está por vencer.

import { ArcaError, pedirTicket, TICKET_YA_EMITIDO, type Ambiente, type Ticket } from "./cliente";

// El cliente de Supabase del repo va sin tipos de tablas nuevas (ver docs/architecture.md §9).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const MARGEN_MS = 10 * 60_000; // se renueva 10 minutos antes de que venza
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function leer(db: Db, ambiente: Ambiente): Promise<Ticket | null> {
  const { data } = await db.from("arca_tickets").select("token, sign, expira_en").eq("ambiente", ambiente).maybeSingle();
  if (!data) return null;
  const expiraEn = new Date(data.expira_en);
  return expiraEn.getTime() > Date.now() + MARGEN_MS ? { token: data.token, sign: data.sign, expiraEn } : null;
}

export function credenciales(): { crt: string; key: string } {
  const crt = process.env.ARCA_CRT, key = process.env.ARCA_KEY;
  if (!crt || !key) throw new ArcaError("Faltan los secrets ARCA_CRT y ARCA_KEY del certificado.", false);
  return { crt, key };
}

export async function obtenerTicket(db: Db, ambiente: Ambiente): Promise<Ticket> {
  const guardado = await leer(db, ambiente);
  if (guardado) return guardado;

  const { crt, key } = credenciales();
  try {
    const nuevo = await pedirTicket(ambiente, crt, key);
    const { error } = await db.from("arca_tickets").upsert({
      ambiente, token: nuevo.token, sign: nuevo.sign, expira_en: nuevo.expiraEn.toISOString(), updated_at: new Date().toISOString(),
    });
    if (error) console.error("[arca] no se pudo guardar el ticket:", error.message);
    return nuevo;
  } catch (e) {
    // Otra instancia lo pidió un instante antes: esperar a que lo guarde y leerlo.
    if (e instanceof ArcaError && e.codigo?.includes(TICKET_YA_EMITIDO)) {
      for (let i = 0; i < 4; i++) {
        await espera(1500);
        const otro = await leer(db, ambiente);
        if (otro) return otro;
      }
      throw new ArcaError(
        "ARCA ya entregó un ticket que no tenemos guardado (se pidió desde otro lado). Se destraba solo cuando venza, en unas 12 horas.",
        true, e.codigo,
      );
    }
    throw e;
  }
}
