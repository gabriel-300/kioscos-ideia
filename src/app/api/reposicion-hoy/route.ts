import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fmtFechaLarga } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";

// Endpoint de solo lectura para que una automatización externa (n8n) arme el
// aviso diario de reposición por WhatsApp -- mismo criterio de auth que
// /api/webhooks/pedidoya (token fijo por env var, comparado contra el header
// Authorization). A propósito NO incluye la sección "pedido semanal de hoy"
// (dia_pedido) de /admin/reposicion -- el usuario pidió específicamente que
// este aviso dispare solo por punto de pedido; el ciclo semanal fijo queda
// como algo que se revisa a mano en el reporte por ahora.

type PuntoRow = {
  product_id:  string;
  sucursal_id: string;
  punto_pedido: number;
  punto_maximo: number | null;
  product: { name: string; sku: string; unit_label: string; is_active: boolean } | null;
};

function fmtQty(qty: number, unit: string) {
  if (unit === "kg") return `${formatKg(qty)} kg`;
  return `${qty} ${unit === "unidad" ? "u." : unit}`;
}

export async function GET(request: Request) {
  const token = process.env.REPOSICION_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Endpoint no configurado todavía (falta REPOSICION_API_TOKEN)" },
      { status: 501 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: sucursales }, { data: puntosRaw }, { data: stockRaw }] = await Promise.all([
    admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    (admin as any)
      .from("product_prices")
      .select(`
        product_id, sucursal_id, punto_pedido, punto_maximo,
        product:products(name, sku, unit_label, is_active)
      `)
      .not("punto_pedido", "is", null) as unknown as Promise<{ data: PuntoRow[] | null }>,
    (admin as any)
      .from("stock_sucursal")
      .select("product_id, sucursal_id, stock_actual") as unknown as Promise<{
        data: { product_id: string; sucursal_id: string; stock_actual: number }[] | null;
      }>,
  ]);

  const sucursalNombreMap = new Map((sucursales ?? []).map((s) => [s.id, s.nombre]));
  const stockMap = new Map((stockRaw ?? []).map((r) => [`${r.sucursal_id}:${r.product_id}`, r.stock_actual]));

  type Item = { sucursal: string; nombre: string; sku: string; stockActual: number; unit: string; cantidadSugerida: number | null };
  const items: Item[] = [];
  for (const p of puntosRaw ?? []) {
    if (!p.product?.is_active) continue;
    const stockActual = stockMap.get(`${p.sucursal_id}:${p.product_id}`) ?? 0;
    if (stockActual > p.punto_pedido) continue;
    items.push({
      sucursal:    sucursalNombreMap.get(p.sucursal_id) ?? "—",
      nombre:      p.product.name,
      sku:         p.product.sku,
      stockActual,
      unit:        p.product.unit_label,
      cantidadSugerida: p.punto_maximo != null ? Math.max(0, p.punto_maximo - stockActual) : null,
    });
  }
  items.sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.nombre.localeCompare(b.nombre));

  const bySuc = new Map<string, Item[]>();
  for (const it of items) bySuc.set(it.sucursal, [...(bySuc.get(it.sucursal) ?? []), it]);

  let mensaje = "";
  if (items.length > 0) {
    const lineas = [`📦 *Reposición — ${fmtFechaLarga(new Date())}*`, ""];
    for (const [suc, filas] of bySuc) {
      lineas.push(`*${suc}*`);
      for (const f of filas) {
        const sugerida = f.cantidadSugerida != null && f.cantidadSugerida > 0 ? ` (pedir ≈${fmtQty(f.cantidadSugerida, f.unit)})` : "";
        lineas.push(`• ${f.nombre}: ${fmtQty(f.stockActual, f.unit)}${sugerida}`);
      }
      lineas.push("");
    }
    mensaje = lineas.join("\n").trim();
  }

  return NextResponse.json({ count: items.length, mensaje, items });
}
