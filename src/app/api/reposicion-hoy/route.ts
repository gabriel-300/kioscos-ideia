import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fmtFechaLarga } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";
import { obtenerItemsReposicion, agruparPorProveedor } from "@/lib/reposicion";

// Endpoint de solo lectura para que una automatización externa (n8n) arme el
// aviso diario de reposición por WhatsApp -- mismo criterio de auth que
// /api/webhooks/pedidoya (token fijo por env var, comparado contra el header
// Authorization).
//
// Incluye tanto lo que está por debajo del punto de pedido como los
// productos de ciclo fijo (diario o día de la semana) que corresponden hoy
// -- antes esto último se dejaba afuera a propósito, pero productos como el
// pan (ciclo diario) son justo el caso de uso real de un aviso automático.
// Lo que ya se marcó "pedido" en /admin/reposicion no vuelve a aparecer
// acá hasta que llegue una entrega nueva (ver src/lib/reposicion.ts).

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
  const items = await obtenerItemsReposicion(admin);
  const grupos = agruparPorProveedor(items);

  let mensaje = "";
  if (items.length > 0) {
    const lineas = [`📦 *Reposición — ${fmtFechaLarga(new Date())}*`, ""];
    for (const [proveedor, filas] of grupos) {
      lineas.push(`*${proveedor}*`);
      const porSucursal = new Map<string, typeof filas>();
      for (const f of filas) porSucursal.set(f.sucursalNombre, [...(porSucursal.get(f.sucursalNombre) ?? []), f]);
      for (const [suc, filasSuc] of porSucursal) {
        lineas.push(`_${suc}_`);
        for (const f of filasSuc) {
          const sugerida = f.cantidadSugerida != null && f.cantidadSugerida > 0 ? ` (pedir ≈${fmtQty(f.cantidadSugerida, f.unit)})` : "";
          const cicloTag = f.motivo === "ciclo" ? " 🔁" : "";
          lineas.push(`• ${f.nombre}: ${fmtQty(f.stockActual, f.unit)}${sugerida}${cicloTag}`);
        }
      }
      lineas.push("");
    }
    mensaje = lineas.join("\n").trim();
  }

  return NextResponse.json({ count: items.length, mensaje, items });
}
