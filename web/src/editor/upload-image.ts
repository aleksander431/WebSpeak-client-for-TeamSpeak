/** Large pictures are shrunk and re-encoded as WebP in the browser before upload. */

const MAX_SIDE = 3072;
const KEEP_BYTES = 1_500_000;

export async function prepareUpload(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return file; }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= KEEP_BYTES) return file;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.86));
    return blob && blob.type === "image/webp" && blob.size < file.size ? blob : file;
  } finally {
    bitmap.close();
  }
}
