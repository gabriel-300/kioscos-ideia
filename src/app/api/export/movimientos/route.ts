import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fechaHoyAR } from "@/lib/fecha";
import type ExcelJSType from "exceljs";

export async function GET(req: NextRequest) {
  try {
    return await handleGet(req);
  } catch (e: any) {
    return new NextResponse(`ERROR: ${e?.message ?? String(e)}\n\nSTACK:\n${e?.stack ?? "(sin stack)"}`, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function handleGet(req: NextRequest) {
  // Import dinámico -- exceljs hace chequeos a nivel de módulo (ej.
  // process.versions.node) que si tiran, un `import` estático los ejecuta
  // ANTES de que este try/catch pueda atraparlos, y Cloudflare devuelve un
  // "Internal Server Error" genérico sin decir por qué.
  const { default: ExcelJS } = (await import("exceljs")) as { default: typeof ExcelJSType };

  // Verificar sesión
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.app_metadata?.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const { searchParams } = req.nextUrl;
  const desde      = searchParams.get("desde");
  const hasta      = searchParams.get("hasta");
  const sucursalId = searchParams.get("sucursal_id");
  const tipo       = searchParams.get("tipo"); // "entrega" | "devolucion" | "venta" | "ajuste" | "merma" | null (todos)

  const admin = createAdminClient();
  let query = (admin as any)
    .from("movimientos")
    .select(`
      id, fecha, tipo, notas, created_at, proveedor, nro_remito, canal, sucursal_id,
      sucursal:sucursales(nombre, localidad),
      movimiento_items(
        product_id, cantidad, precio_unitario, subtotal,
        product:products(name, sku)
      )
    `)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  if (desde)      query = query.gte("fecha", desde);
  if (hasta)      query = query.lte("fecha", hasta);
  if (sucursalId) query = query.eq("sucursal_id", sucursalId);
  if (tipo)       query = query.eq("tipo", tipo);

  const { data, error } = await query as { data: any[] | null; error: any };
  if (error) return new NextResponse(error.message, { status: 500 });

  const movimientos = data ?? [];

  // Ajustes casi nunca traen precio_unitario/subtotal cargado a mano (se
  // usan para corregir cantidades, no para registrar plata) -- sin esto el
  // reporte de "valor de mercadería" para descontar al personal saldría en
  // blanco. Se completa con el costo ACTUAL del producto en esa sucursal
  // (product_prices), marcado aparte como estimado en la hoja de detalle --
  // no es el costo histórico al momento del ajuste, es el mejor dato
  // disponible hoy.
  const { data: preciosRaw } = await admin.from("product_prices").select("sucursal_id, product_id, costo");
  const costoMap = new Map((preciosRaw ?? []).map((p) => [`${p.sucursal_id}:${p.product_id}`, p.costo]));

  function valorItem(sucursalId: string, item: { product_id: string; cantidad: number; subtotal: number | null }): { valor: number; estimado: boolean } {
    if (item.subtotal != null) return { valor: item.subtotal, estimado: false };
    const costo = costoMap.get(`${sucursalId}:${item.product_id}`);
    if (costo == null) return { valor: 0, estimado: false };
    return { valor: item.cantidad * costo, estimado: true };
  }

  // ── Excel ─────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator  = "Kioscos IDEIA";
  wb.created  = new Date();

  const TIERRA = "FF6B3A";   // color primario
  const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  const HEADER_FILL: ExcelJSType.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: TIERRA } };
  const BORDER: Partial<ExcelJSType.Borders> = {
    top:    { style: "thin", color: { argb: "FFE5E7EB" } },
    bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    left:   { style: "thin", color: { argb: "FFE5E7EB" } },
    right:  { style: "thin", color: { argb: "FFE5E7EB" } },
  };

  function styleHeader(row: ExcelJSType.Row) {
    row.eachCell((cell) => {
      cell.font  = HEADER_FONT;
      cell.fill  = HEADER_FILL;
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    row.height = 24;
  }

  const ARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

  // ── Hoja 1: Resumen ────────────────────────────────────────
  const wsResumen = wb.addWorksheet("Resumen");
  wsResumen.columns = [
    { header: "Fecha",      key: "fecha",      width: 14 },
    { header: "Sucursal",   key: "sucursal",   width: 24 },
    { header: "Localidad",  key: "localidad",  width: 16 },
    { header: "Tipo",       key: "tipo",       width: 14 },
    { header: "Proveedor",  key: "proveedor",  width: 20 },
    { header: "N° Remito",  key: "nro_remito", width: 14 },
    { header: "Ítems",      key: "items",      width: 8  },
    { header: "Total",      key: "total",      width: 16 },
    { header: "Canal",      key: "canal",      width: 16 },
    { header: "Notas",      key: "notas",      width: 30 },
  ];
  styleHeader(wsResumen.getRow(1));

  const TIPO_LABEL: Record<string, string> = { entrega: "Entrega", devolucion: "Devolución", venta: "Venta", ajuste: "Ajuste", merma: "Merma" };

  let totalGeneral = 0;
  let totalPerdida = 0;   // solo ajustes negativos -- lo que efectivamente se descontaría
  let totalSobrante = 0;  // solo ajustes positivos, para contexto
  for (const m of movimientos) {
    const sucursal = m.sucursal as { nombre: string; localidad: string } | null;
    const total = m.movimiento_items.reduce((s: number, i: any) => s + valorItem(m.sucursal_id, i).valor, 0);
    totalGeneral += total;
    if (m.tipo === "ajuste") {
      if (total < 0) totalPerdida  += total;
      if (total > 0) totalSobrante += total;
    }

    const row = wsResumen.addRow({
      fecha:      m.fecha,
      sucursal:   sucursal?.nombre ?? "",
      localidad:  sucursal?.localidad ?? "",
      tipo:       TIPO_LABEL[m.tipo] ?? m.tipo,
      proveedor:  (m as any).proveedor  ?? "",
      nro_remito: (m as any).nro_remito ?? "",
      items:      m.movimiento_items.length,
      total:      total !== 0 ? total : null,
      canal:      (m as any).canal ?? "",
      notas:      m.notas ?? "",
    });
    row.eachCell((cell) => { cell.border = BORDER; });

    // Color fila según tipo
    if (m.tipo === "devolucion") {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
      });
    }

    // Formato moneda en columna total
    const totalCell = row.getCell("total");
    if (totalCell.value) totalCell.numFmt = '"$"#,##0';
  }

  // Fila de total
  if (movimientos.length > 0) {
    const lastRow = wsResumen.lastRow!.number + 1;
    const totRow = wsResumen.getRow(lastRow);
    totRow.getCell("sucursal").value = "TOTAL";
    totRow.getCell("sucursal").font  = { bold: true };
    totRow.getCell("total").value    = totalGeneral;
    totRow.getCell("total").numFmt   = '"$"#,##0';
    totRow.getCell("total").font     = { bold: true };
    totRow.eachCell((cell) => {
      cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      cell.border = BORDER;
    });

    // Si se filtró específicamente por ajustes, separar pérdida de sobrante
    // -- el número que importa para descontarle al personal es la pérdida
    // sola, no el neto (un sobrante en otro producto no compensa un faltante).
    if (tipo === "ajuste") {
      const perdidaRow = wsResumen.getRow(lastRow + 1);
      perdidaRow.getCell("sucursal").value = "Total faltante (a descontar)";
      perdidaRow.getCell("sucursal").font  = { bold: true, color: { argb: "FFC02820" } };
      perdidaRow.getCell("total").value    = totalPerdida;
      perdidaRow.getCell("total").numFmt   = '"$"#,##0';
      perdidaRow.getCell("total").font     = { bold: true, color: { argb: "FFC02820" } };

      const sobranteRow = wsResumen.getRow(lastRow + 2);
      sobranteRow.getCell("sucursal").value = "Total sobrante (solo referencia)";
      sobranteRow.getCell("sucursal").font  = { italic: true };
      sobranteRow.getCell("total").value    = totalSobrante;
      sobranteRow.getCell("total").numFmt   = '"$"#,##0';
      sobranteRow.getCell("total").font     = { italic: true };
    }
  }

  // ── Hoja 2: Detalle ────────────────────────────────────────
  const wsDetalle = wb.addWorksheet("Detalle");
  wsDetalle.columns = [
    { header: "Fecha",       key: "fecha",     width: 14 },
    { header: "Sucursal",    key: "sucursal",  width: 24 },
    { header: "Tipo",        key: "tipo",      width: 14 },
    { header: "SKU",         key: "sku",       width: 16 },
    { header: "Producto",    key: "producto",  width: 32 },
    { header: "Cantidad",    key: "cantidad",  width: 10 },
    { header: "Precio unit", key: "precio",    width: 14 },
    { header: "Valor",       key: "valor",     width: 14 },
    { header: "Origen valor",key: "origen",    width: 20 },
  ];
  styleHeader(wsDetalle.getRow(1));

  for (const m of movimientos) {
    const sucursal = m.sucursal as { nombre: string } | null;
    for (const item of m.movimiento_items) {
      const product = item.product as { name: string; sku: string } | null;
      const { valor, estimado } = valorItem(m.sucursal_id, item);
      const row = wsDetalle.addRow({
        fecha:    m.fecha,
        sucursal: sucursal?.nombre ?? "",
        tipo:     TIPO_LABEL[m.tipo] ?? m.tipo,
        sku:      product?.sku ?? "",
        producto: product?.name ?? "",
        cantidad: item.cantidad,
        precio:   item.precio_unitario ?? null,
        valor:    valor !== 0 ? valor : null,
        // Ajustes en general no tienen un precio cargado a mano (ver
        // comentario de valorItem más arriba) -- se aclara acá para que
        // quien mire la planilla sepa que ese número es el costo de HOY,
        // no necesariamente el vigente en la fecha del ajuste.
        origen:   item.subtotal != null ? "Registrado" : estimado ? "Costo actual (estimado)" : "",
      });
      row.eachCell((cell) => { cell.border = BORDER; });
      row.getCell("precio").numFmt = '"$"#,##0';
      row.getCell("valor").numFmt  = '"$"#,##0';
      if (estimado) row.getCell("origen").font = { italic: true, color: { argb: "FF97690A" } };

      if (m.tipo === "devolucion") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
        });
      }
    }
  }

  // ── Serializar ────────────────────────────────────────────
  // ExcelJS devuelve un Buffer de Node -- en Cloudflare Workers (no es
  // Node real, aunque corra con nodejs_compat) pasarlo tal cual como body
  // de la respuesta puede llegar corrompido del otro lado ("Excel no puede
  // abrir el archivo... formato no válido"), aunque en local (next dev,
  // Node real) funcione perfecto. Se copia a un Uint8Array plano antes de
  // mandarlo, que sí se serializa igual en los dos entornos.
  const raw    = await wb.xlsx.writeBuffer();
  const buffer = new Uint8Array(raw as ArrayBuffer);

  const desde_label = desde ?? "inicio";
  const hasta_label = hasta ?? fechaHoyAR();
  const filename    = `kioscos-ideia_${desde_label}_${hasta_label}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
