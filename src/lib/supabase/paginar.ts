// PostgREST corta cada consulta en 1.000 filas (configuración "max rows" de
// Supabase) sin avisar: un informe que sume `movimientos` de un mes entero
// queda con una fracción de las ventas y nadie se entera. Este helper trae
// TODAS las filas pidiendo de a páginas con .range().
//
// La consulta que se le pasa TIENE que ordenar por una clave única (ej.
// .order("id")): sin un orden total, dos páginas pueden repetir o saltearse
// filas. Devuelve un error real (no datos truncados) si alguna página falla.
//
// Si el .select() pide `{ count: "exact" }`, después de la primera página se
// sabe el total y las páginas que faltan se piden EN PARALELO (en vez de una
// tras otra) -- importa en pantallas que se cargan seguido, como el detalle de
// sucursal que usa el vendedor para cobrar.
//
// Uso:
//   const ventas = await fetchAll<MovRow>((desde, hasta) =>
//     admin.from("movimientos").select("...", { count: "exact" })
//       .eq("tipo", "venta").order("id").range(desde, hasta));

export const PAGINA = 1000;

type Pagina<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

const CONCURRENCIA = 5;

export async function fetchAll<T = any>(
  pagina: (desde: number, hasta: number) => PromiseLike<Pagina<T>>,
  tamano: number = PAGINA,
  maxPaginas: number = 200, // tope de seguridad: 200.000 filas
): Promise<T[]> {
  async function pedir(i: number): Promise<{ lote: T[]; count: number | null }> {
    const desde = i * tamano;
    const { data, error, count } = await pagina(desde, desde + tamano - 1);
    if (error) throw new Error(error.message);
    return { lote: data ?? [], count: typeof count === "number" ? count : null };
  }

  const primera = await pedir(0);
  const filas: T[] = [...primera.lote];
  if (primera.lote.length < tamano) return filas;

  // Con total conocido: el resto en paralelo, de a CONCURRENCIA.
  if (primera.count !== null) {
    const paginasTotales = Math.ceil(primera.count / tamano);
    if (paginasTotales > maxPaginas) throw new Error(`fetchAll: ${primera.count} filas exceden el tope (${maxPaginas * tamano}), agregar en SQL`);
    const restantes = Array.from({ length: Math.max(0, paginasTotales - 1) }, (_, k) => k + 1);
    for (let k = 0; k < restantes.length; k += CONCURRENCIA) {
      const lotes = await Promise.all(restantes.slice(k, k + CONCURRENCIA).map(pedir));
      for (const { lote } of lotes) filas.push(...lote);
    }
    return filas;
  }

  // Sin total: una tras otra hasta que venga una página incompleta.
  for (let i = 1; i < maxPaginas; i++) {
    const { lote } = await pedir(i);
    filas.push(...lote);
    if (lote.length < tamano) return filas;
  }
  throw new Error(`fetchAll: más de ${maxPaginas * tamano} filas, la consulta necesita otro enfoque (agregar en SQL)`);
}
