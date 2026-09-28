import sharp from "sharp";

export interface ProcessedImage {
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Normaliza una foto: respeta la orientación EXIF, elimina metadatos (incluida la ubicación
 * GPS del teléfono), limita el tamaño y genera una miniatura. Todo en WebP.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const base = sharp(input, { failOn: "error", limitInputPixels: 60_000_000 }).rotate();
  const display = await base
    .clone()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base
    .clone()
    .resize({ width: 480, height: 360, fit: "cover", position: "attention" })
    .webp({ quality: 75 })
    .toBuffer();
  return { display: display.data, thumb, width: display.info.width, height: display.info.height };
}
