import { NextResponse } from "next/server";

// El registro público (remanente del alta B2B) está deshabilitado a propósito:
// esta ruta creaba usuarios `authenticated` sin sesión, sin límite y con el
// email ya confirmado, y con eso cualquiera podía escribir en Storage
// (auditoría 19/09/2026, hallazgo A-02). El staff se da de alta solo desde
// /admin/staff (crearStaff, requiere admin). Se puede borrar este archivo.
function gone() {
  return NextResponse.json({ error: "El registro público está deshabilitado." }, { status: 410 });
}

export const POST = gone;
export const GET = gone;
