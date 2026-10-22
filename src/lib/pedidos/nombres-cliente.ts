// Cómo se ven los nombres en la tienda. En el kiosco los productos se cargan en mayúsculas y abreviados
// ("CAFE/LUNGO + CHIPA 150GR"); al cliente eso le parece una etiqueta de góndola. Acá se muestran como
// frase ("Café/lungo + chipa 150 gr") sin tocar el nombre real del producto. Puro.

const ACENTOS: Record<string, string> = {
  cafe: "café", jamon: "jamón", limon: "limón", pacu: "pacú", mani: "maní", azucar: "azúcar", pure: "puré",
  budin: "budín", "miñon": "miñón", panaderia: "panadería", confiteria: "confitería", "sandwich": "sándwich",
  "te": "té", gaseosa: "gaseosa", chipa: "chipa",
};
const MINUSCULAS = new Set(["de", "del", "la", "el", "los", "las", "y", "e", "o", "a", "al", "con", "en", "por", "para", "sin", "x"]);
const UNIDADES = /^(\d+(?:[.,]\d+)?)(gr|grs|g|kg|ml|cc|lt|lts|l|un|u)$/;

const esLetra = (c: string) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(c);

function pasaAFrase(nombre: string): string {
  const partes = nombre.split(/(\s+|\/|\+|-)/); // se conservan los separadores
  let primero = true;
  const salida = partes.map((parte) => {
    if (!parte || /^(\s+|\/|\+|-)$/.test(parte)) return parte;
    const minus = parte.toLowerCase();

    const unidad = UNIDADES.exec(minus);
    if (unidad) return `${unidad[1]} ${unidad[2] === "grs" ? "gr" : unidad[2]}`;

    // Sin vocales (MM, JYQ, BBQ): es una sigla, se deja en mayúsculas.
    if (/^[a-zñ]{2,4}$/.test(minus) && !/[aeiouáéíóú]/.test(minus) && !MINUSCULAS.has(minus)) return parte.toUpperCase();

    let palabra = ACENTOS[minus] ?? minus;
    if (/^\d/.test(palabra)) return palabra; // un número solo ("3", "4x"): no cuenta como primera palabra

    if (primero) {
      primero = false;
      return palabra.charAt(0).toUpperCase() + palabra.slice(1);
    }
    if (MINUSCULAS.has(palabra)) return palabra;
    return palabra;
  });
  return salida.join("");
}

export function nombrePresentable(nombre: string): string {
  const limpio = nombre.replace(/\s+/g, " ").trim();
  if (!limpio) return nombre;

  const letras = [...limpio].filter(esLetra);
  const mayusculas = letras.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  const casiTodoMayusculas = letras.length >= 3 && mayusculas.length / letras.length >= 0.7;
  if (casiTodoMayusculas) return pasaAFrase(limpio);

  // Ya viene escrito como frase: se le ponen las tildes que suelen faltar ("Cafe" → "Café") y la primera letra en mayúscula.
  const conTildes = limpio.replace(/\b(cafe|jamon|limon|pacu|mani|azucar|pure|budin|sandwich)\b/gi, (w) => {
    const buena = ACENTOS[w.toLowerCase()];
    return w[0] === w[0].toUpperCase() ? buena.charAt(0).toUpperCase() + buena.slice(1) : buena;
  });
  const i = [...conTildes].findIndex(esLetra);
  if (i < 0) return conTildes;
  return conTildes.slice(0, i) + conTildes.charAt(i).toUpperCase() + conTildes.slice(i + 1);
}
