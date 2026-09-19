// Reduce una imagen ANTES de subirla a Supabase Storage. Las imágenes del catálogo se
// descargan en cada carga del POS y del catálogo público: una foto de 2 MB (había 3 PNG
// así) multiplicada por cada pantalla abierta llevó el "Cached Egress" de Supabase a
// 8,4 GB de 5 GB (168%, 2026-09-19). Un producto se ve a menos de 400 px: 1000 px de
// lado mayor en WebP pesa ~30-80 KB.

export const LADO_MAX_PX = 1000;

// Puro (se prueba en tests/unit/imagen.test.ts): escala manteniendo la proporción y nunca agranda.
export function escalarA(ancho: number, alto: number, max: number = LADO_MAX_PX): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (!(mayor > max)) return { ancho, alto };
  const f = max / mayor;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

// Solo en el navegador. Si algo falla o el resultado no es más chico, devuelve el archivo original.
export async function reducirImagen(file: File, max: number = LADO_MAX_PX, calidad = 0.82): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const { ancho, alto } = escalarA(bmp.width, bmp.height, max);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, ancho, alto);

    // WebP conserva la transparencia de un PNG. Safari no lo codifica (devuelve otro tipo): en ese
    // caso se cae a JPEG sobre fondo blanco.
    let blob = await aBlob(canvas, "image/webp", calidad);
    let ext = "webp";
    if (!blob || blob.type !== "image/webp") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, ancho, alto);
      blob = await aBlob(canvas, "image/jpeg", calidad);
      ext = "jpg";
    }
    bmp.close?.();

    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + ext, { type: blob.type });
  } catch {
    return file;
  }
}
