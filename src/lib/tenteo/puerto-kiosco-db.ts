import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import type {
  DatosCatalogo,
  DatosProductosPedido,
  DatosPromosPedido,
  EntradaVenta,
  FilaStock,
  NombresCatalogo,
  PuertoKiosco,
  RestriccionesCatalogo,
  ResultadoVenta,
} from "./puerto-kiosco";

// Implementación del puerto con consultas directas a la base del kiosco. Las
// consultas son las MISMAS que antes estaban repartidas en lib/pedidos
// (catalogo, pricing, stock, crear-venta-publica, por-atender), movidas acá sin
// cambiar filtros, orden ni manejo de errores.
//
// (admin as any): categorias_habilitadas/promos_habilitadas, las columnas de
// promos y las vistas no están en los tipos generados -- mismo patrón que el resto.

type Admin = ReturnType<typeof createAdminClient>;

export function kioscoDirecto(admin: Admin): PuertoKiosco {
  return {
    async restricciones(sucursalId): Promise<RestriccionesCatalogo> {
      const { data } = await (admin as any)
        .from("sucursales")
        .select("categorias_habilitadas, promos_habilitadas")
        .eq("id", sucursalId)
        .single();
      return { categoriasHabilitadas: data?.categorias_habilitadas ?? null, promosHabilitadas: data?.promos_habilitadas ?? true };
    },

    async datosCatalogo(sucursalId): Promise<DatosCatalogo> {
      const [categorias, productos, preciosProducto, promos, preciosPromo, stock, componentes] = await Promise.all([
        admin.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
        (admin as any).from("products").select("id, name, cover_image_url, category_id, unit_label, vendible_pos").eq("is_active", true).neq("sku", "MULTA-TERMO").order("name"),
        admin.from("product_prices").select("product_id, precio_dist").eq("sucursal_id", sucursalId),
        (admin as any).from("promos").select("id, name, price, tipo, cover_image_url, category_id").eq("is_active", true).order("name"),
        (admin as any).from("promo_prices").select("promo_id, price").eq("sucursal_id", sucursalId),
        // Si no se puede leer el stock, se muestra todo (mejor que dejar la tienda vacía):
        // el chequeo al confirmar sigue ahí.
        fetchAll((d, h) => (admin as any).from("stock_sucursal").select("product_id, stock_actual", { count: "exact" }).eq("sucursal_id", sucursalId).order("product_id").range(d, h)).catch(() => []),
        (admin as any).from("promo_items").select("promo_id, product_id, cantidad"),
      ]);

      return {
        categorias:      categorias.data ?? [],
        productos:       productos.data ?? [],
        preciosProducto: preciosProducto.data ?? [],
        promos:          promos.data ?? [],
        preciosPromo:    preciosPromo.data ?? [],
        stock,
        componentes:     componentes.data ?? [],
      };
    },

    async datosProductos(sucursalId, productIds): Promise<{ error: string } | DatosProductosPedido> {
      const { data: products, error: prodError } = await (admin as any)
        .from("products")
        .select("id, category_id, is_active, vendible_pos")
        .in("id", productIds);
      if (prodError) return { error: prodError.message };

      const { data: precios, error: preciosError } = await admin
        .from("product_prices")
        .select("product_id, precio_dist")
        .eq("sucursal_id", sucursalId)
        .in("product_id", productIds);
      if (preciosError) return { error: preciosError.message };

      return { productos: products ?? [], precios: (precios ?? []) as DatosProductosPedido["precios"] };
    },

    async datosPromos(sucursalId, promoIds): Promise<{ error: string } | DatosPromosPedido> {
      const { data: promos, error: promosError } = await (admin as any)
        .from("promos")
        .select("id, price, is_active, category_id, promo_items(product_id, cantidad)")
        .in("id", promoIds);
      if (promosError) return { error: promosError.message };

      const { data: preciosPromo, error: preciosPromoError } = await (admin as any)
        .from("promo_prices")
        .select("promo_id, price")
        .eq("sucursal_id", sucursalId)
        .in("promo_id", promoIds);
      if (preciosPromoError) return { error: preciosPromoError.message };

      const componentProductIds: string[] = [...new Set(
        (promos ?? []).flatMap((p: { promo_items: { product_id: string }[] }) => p.promo_items.map((pi) => pi.product_id))
      )] as string[];
      let costosComponentes: DatosPromosPedido["costosComponentes"] = [];
      if (componentProductIds.length > 0) {
        const { data: preciosComponentes, error: preciosCompError } = await admin
          .from("product_prices")
          .select("product_id, costo")
          .eq("sucursal_id", sucursalId)
          .in("product_id", componentProductIds);
        if (preciosCompError) return { error: preciosCompError.message };
        costosComponentes = (preciosComponentes ?? []) as DatosPromosPedido["costosComponentes"];
      }

      return { promos: promos ?? [], preciosPromo: preciosPromo ?? [], costosComponentes };
    },

    async nombres(productIds, promoIds): Promise<NombresCatalogo> {
      const [{ data: productos }, { data: promos }] = await Promise.all([
        productIds.length ? (admin as any).from("products").select("id, name").in("id", productIds) : { data: [] },
        promoIds.length ? (admin as any).from("promos").select("id, name").in("id", promoIds) : { data: [] },
      ]);
      return { productos: productos ?? [], promos: promos ?? [] };
    },

    async stock(sucursalId, productIds): Promise<FilaStock[] | null> {
      const { data, error } = await (admin as any)
        .from("stock_sucursal")
        .select("product_id, product_name, stock_actual")
        .eq("sucursal_id", sucursalId)
        .in("product_id", productIds);
      if (error) return null; // best-effort -- si falla la consulta, no bloquea el pedido por esto
      return data ?? [];
    },

    async registrarVenta(entrada: EntradaVenta): Promise<ResultadoVenta> {
      // crear_movimiento_con_items tiene EXECUTE revocado de anon/authenticated: solo
      // se invoca con service_role desde el servidor. No valida que la suma de pagos
      // coincida con la de ítems ni exige caja abierta (ver docs/architecture.md §5).
      const rpcRes = await (admin as any).rpc("crear_movimiento_con_items", {
        p_sucursal_id: entrada.sucursalId,
        p_fecha: entrada.fecha,
        p_tipo: "venta",
        p_notas: entrada.notas,
        p_proveedor: null,
        p_proveedor_id: null,
        p_nro_remito: null,
        p_canal: entrada.canal,
        p_personal_id: null,
        p_contacto_id: entrada.contactoId,
        p_pago_efectivo: entrada.pagoEfectivo,
        p_pago_billetera: entrada.pagoBilletera,
        p_pago_tarjeta: null,
        p_pago_transferencia: null,
        p_created_by: null,
        p_items: entrada.items.map((i) => ({
          product_id: i.product_id,
          cantidad: i.cantidad,
          precio_unitario: i.precio_unitario,
          subtotal: i.subtotal,
          promo_id: i.promo_id,
        })),
      });
      if (rpcRes.error) return { error: rpcRes.error.message };
      return { movimientoId: typeof rpcRes.data === "string" ? rpcRes.data : null };
    },

    // admin ve todas (null); encargado/concesionario, la suya; vendedor, las de
    // profile_sucursales (la columna vieja profiles.sucursal_id solo si todavía
    // no tiene filas ahí). Cualquier otro rol: ninguna.
    async sucursalesDelUsuario(userId, rol): Promise<string[] | null> {
      if (rol === "admin") return null;

      if (rol === "encargado" || rol === "concesionario") {
        const { data } = await admin.from("sucursales").select("id").eq("encargado_user_id", userId);
        return ((data ?? []) as { id: string }[]).map((s) => s.id);
      }

      if (rol === "vendedor") {
        const { data: asignadas } = await (admin as any).from("profile_sucursales").select("sucursal_id").eq("profile_id", userId);
        const ids = ((asignadas ?? []) as { sucursal_id: string }[]).map((r) => r.sucursal_id);
        if (ids.length > 0) return ids;
        const { data: perfil } = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
        return perfil?.sucursal_id ? [perfil.sucursal_id as string] : [];
      }

      return [];
    },
  };
}
