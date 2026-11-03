/**
 * Filtro PostgREST (`.or(...)`) para quedarse con lo que una sucursal puede ver del
 * catálogo: lo global más lo suyo. Hay que usarlo en toda consulta con el cliente
 * admin (que se salta la RLS) que arme una lista de productos/categorías/promos
 * para una sucursal concreta; si no, el catálogo de un local aparecería en otro.
 */
export function filtroCatalogoDe(sucursalId: string): string {
  return `owner_sucursal_id.is.null,owner_sucursal_id.eq.${sucursalId}`;
}
