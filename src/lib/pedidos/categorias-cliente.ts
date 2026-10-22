// Cómo se muestran y en qué orden van las categorías en la tienda. Las del kiosco ("MINUTAS CONG",
// "KIOSKO") son internas; acá el cliente ve nombres de comida y primero lo que más apetece. Solo
// cambia la presentación: las categorías de verdad (y los productos) no se tocan. Puro.

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Orden de aparición y nombre para el cliente, por el nombre interno (sin tildes ni mayúsculas).
const PRESENTACION: { interno: string; nombre: string }[] = [
  { interno: "promos",       nombre: "Promos" },
  { interno: "minutas",      nombre: "Minutas y pizzas" },
  { interno: "panaderia",    nombre: "Panadería" },
  { interno: "confiteria",   nombre: "Dulces" },
  { interno: "minutas cong", nombre: "Congelados" },
  { interno: "bebidas",      nombre: "Bebidas" },
  { interno: "kiosko",       nombre: "Kiosco" },
];

export function nombreCategoriaCliente(nombreInterno: string): string {
  return PRESENTACION.find((p) => p.interno === sinTildes(nombreInterno))?.nombre ?? nombreInterno;
}

// Reordena sin perder lo que no está en la lista: las categorías desconocidas van al final, en el
// orden en que venían.
export function ordenarCategoriasCliente<T extends { name: string }>(grupos: T[]): T[] {
  const posicion = (g: T) => {
    const i = PRESENTACION.findIndex((p) => p.interno === sinTildes(g.name));
    return i < 0 ? PRESENTACION.length : i;
  };
  return grupos.map((g, orden) => ({ g, orden })).sort((a, b) => posicion(a.g) - posicion(b.g) || a.orden - b.orden).map((x) => x.g);
}
