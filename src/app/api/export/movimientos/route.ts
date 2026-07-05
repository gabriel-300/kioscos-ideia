import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fechaHoyAR } from "@/lib/fecha";
import ExcelJS from "exceljs";

export async function GET(req: NextRequest) {
  // Verificar sesión
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (user.app_metadata?.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const { searchParams } = req.nextUrl;
  const desde      = searchParams.get("desde");
  const hasta      = searchParams.get("hasta");
  const sucursalId = searchParams.get("sucursal_id");

  const admin = createAdminClient();
  let query = (admin as any)
    .from("movimientos")
    .select(`
      id, fecha, tipo, notas, created_at, proveedor, nro_remito, canal,
      sucursal:sucursales(nombre, localidad),
      movimiento_items(
        cantidad, precio_unitario, subtotal,
        product:products(name, sku)
      )
    `)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  if (desde)      query = query.gte("fecha", desde);
  if (hasta)      query = query.lte("fecha", hasta);
  if (sucursalId) query = query.eq("sucursal_id", sucursalId);

  const { data, error } = await query as { data: any[] | null; error: any };
  if (error) return new NextResponse(error.message, { status: 500 });

  const movimientos = data ?? [];

  // ── Excel ─────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator  = "Kioscos IDEIA";
  wb.created  = new Date();

  const TIERRA = "FF6B3A";   // color primario
  const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: TIERRA } };
  const BORDER: Partial<ExcelJS.Borders> = {
    top:    { style: "thin", color: { argb: "FFE5E7EB" } },
    bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
    left:   { style: "thin", color: { argb: "FFE5E7EB" } },
    right:  { style: "thin", color: { argb: "FFE5E7EB" } },
  };

  function styleHeader(row: ExcelJS.Row) {
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

  let totalGeneral = 0;
  for (const m of movimientos) {
    const sucursal = m.sucursal as { nombre: string; localidad: string } | null;
    const total = m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0);
    totalGeneral += total;

    const row = wsResumen.addRow({
      fecha:      m.fecha,
      sucursal:   sucursal?.nombre ?? "",
      localidad:  sucursal?.localidad ?? "",
      tipo:       ({ entrega: "Entrega", devolucion: "Devolución", venta: "Venta", ajuste: "Ajuste" } as Record<string, string>)[m.tipo] ?? m.tipo,
      proveedor:  (m as any).proveedor  ?? "",
      nro_remito: (m as any).nro_remito ?? "",
      items:      m.movimiento_items.length,
      total:      total > 0 ? total : null,
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
    { header: "Subtotal",    key: "subtotal",  width: 14 },
  ];
  styleHeader(wsDetalle.getRow(1));

  for (const m of movimientos) {
    const sucursal = m.sucursal as { nombre: string } | null;
    for (const item of m.movimiento_items) {
      const product = item.product as { name: string; sku: string } | null;
      const row = wsDetalle.addRow({
        fecha:    m.fecha,
        sucursal: sucursal?.nombre ?? "",
        tipo:     ({ entrega: "Entrega", devolucion: "Devolución", venta: "Venta", ajuste: "Ajuste" } as Record<string, string>)[m.tipo] ?? m.tipo,
        sku:      product?.sku ?? "",
        producto: product?.name ?? "",
        cantidad: item.cantidad,
        precio:   item.precio_unitario ?? null,
        subtotal: item.subtotal ?? null,
      });
      row.eachCell((cell) => { cell.border = BORDER; });
      row.getCell("precio").numFmt   = '"$"#,##0';
      row.getCell("subtotal").numFmt = '"$"#,##0';

      if (m.tipo === "devolucion") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
        });
      }
    }
  }

  // ── Serializar ────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();

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
