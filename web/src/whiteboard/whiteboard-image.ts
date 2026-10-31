import { WHITEBOARD_LIMITS } from "../../../src/shared/whiteboard.js";

/** Longest side of a pasted image after downscaling. */
export const WHITEBOARD_IMAGE_MAX_SIDE = 1600;

export interface PreparedImage { src: string; width: number; height: number }

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("WHITEBOARD_IMAGE_UNREADABLE")); };
    image.src = url;
  });
}

const ACCEPTED = /^data:image\/(png|jpeg|webp|gif);base64,/;

/**
 * Downscale and re-encode a pasted or dropped image so it fits the board's
 * per-image budget. WebP keeps transparency where the browser supports it;
 * JPEG is the fallback. Large images step down in size until they fit.
 */
export async function prepareWhiteboardImage(blob: Blob): Promise<PreparedImage> {
  if (!blob.type.startsWith("image/")) throw new Error("WHITEBOARD_IMAGE_UNREADABLE");
  const image = await loadImage(blob);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) throw new Error("WHITEBOARD_IMAGE_UNREADABLE");
  let scale = Math.min(1, WHITEBOARD_IMAGE_MAX_SIDE / Math.max(naturalWidth, naturalHeight));
  for (let attempt = 0; attempt < 6; attempt++) {
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("WHITEBOARD_IMAGE_UNREADABLE");
    context.drawImage(image, 0, 0, width, height);
    let flattened = false;
    for (const [type, quality] of [["image/webp", 0.86], ["image/webp", 0.7], ["image/jpeg", 0.82], ["image/jpeg", 0.65]] as const) {
      if (type === "image/jpeg" && !flattened) {
        // JPEG has no transparency: put the picture on white instead of black.
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = "source-over";
        flattened = true;
      }
      const src = canvas.toDataURL(type, quality);
      if (ACCEPTED.test(src) && src.length <= WHITEBOARD_LIMITS.maxImageSrcLength) return { src, width, height };
    }
    scale *= 0.7;
  }
  throw new Error("WHITEBOARD_IMAGE_TOO_LARGE");
}
