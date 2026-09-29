import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { cargarCatalogoComandera, paraEvento, type CatalogoComandera } from "@/lib/comandera-offline/catalogo";
import { generarComanderaHtml, nombreArchivoComandera } from "@/lib/comandera-offline/html";

// Descarga el archivo HTML de la comandera offline con el catálogo y los precios de HOY incorporados.
// Solo staff con acceso a la sucursal de la que salen los precios.
//
// GET  ?sucursal_id=<uuid>                  todo el catálogo de la sucursal, con su nombre
// POST sucursal_id, evento, ids (JSON)      modo evento: nombre propio y solo los productos elegidos
//      (POST porque son ~200 ids: no entran cómodos en una URL)

const MAX_IDS = 2000;

async function entregar(sucursalId: string | null, armar: (c: CatalogoComandera) => CatalogoComandera | NextResponse) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const role = (user.app_metadata?.role as string | undefined) ?? "";

  if (!sucursalId) return new NextResponse("Falta sucursal_id", { status: 400 });

  const admin = createAdminClient();
  // requireSucursalAccess niega por defecto cualquier rol que no sea de staff (repartidor incluido).
  const denegado = await requireSucursalAccess(admin, user.id, role, sucursalId);
  if (denegado) return new NextResponse("Forbidden", { status: 403 });

  const base = await cargarCatalogoComandera(admin, sucursalId);
  if (!base) return new NextResponse("Sucursal no encontrada", { status: 404 });

  const catalogo = armar(base);
  if (catalogo instanceof NextResponse) return catalogo;
  if (catalogo.categorias.length === 0) {
    return new NextResponse("No hay productos con precio para vender.", { status: 422 });
  }

  return new NextResponse(generarComanderaHtml(catalogo), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivoComandera(catalogo)}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  return entregar(req.nextUrl.searchParams.get("sucursal_id"), (c) => c);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const sucursalId = String(form.get("sucursal_id") ?? "") || null;
  const evento = String(form.get("evento") ?? "").replace(/\s+/g, " ").trim();

  let ids: string[];
  try {
    const parsed = JSON.parse(String(form.get("ids") ?? "[]"));
    if (!Array.isArray(parsed) || parsed.length > MAX_IDS || !parsed.every((x) => typeof x === "string")) throw new Error();
    ids = parsed;
  } catch {
    return new NextResponse("ids inválidos", { status: 400 });
  }

  return entregar(sucursalId, (base) => {
    if (!evento) return new NextResponse("Falta el nombre del evento", { status: 400 });
    return paraEvento(base, evento, ids);
  });
}
