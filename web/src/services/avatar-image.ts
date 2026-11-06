/**
 * Turn a picked image into a TeamSpeak avatar: a centred square, at most
 * AVATAR_SIDE pixels, small enough for the server's default size permission.
 * An animated GIF that already fits is kept as it is, so it stays animated.
 */

/** TeamSpeak's default `i_client_max_avatar_filesize`; matches the gateway's own limit. */
export const AVATAR_MAX_BYTES = 200_000;
export const AVATAR_SIDE = 256;
/** Pictures larger than this are refused before decoding. */
export const AVATAR_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

export interface PreparedAvatar {
  /** Base64 of the bytes to upload. */
  base64: string;
  /** A data URL for the preview. */
  dataUrl: string;
  bytes: number;
  type: string;
}

export type AvatarImageError = "AVATAR_NOT_IMAGE" | "AVATAR_SOURCE_TOO_LARGE" | "AVATAR_DECODE_FAILED" | "AVATAR_TOO_LARGE";

export class AvatarPrepareError extends Error {
  constructor(readonly code: AvatarImageError) {
    super(code);
  }
}

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);

export function isAcceptedAvatarFile(file: Pick<File, "type">): boolean {
  return ACCEPTED.has(file.type);
}

export async function prepareAvatar(file: File): Promise<PreparedAvatar> {
  if (!isAcceptedAvatarFile(file)) throw new AvatarPrepareError("AVATAR_NOT_IMAGE");
  if (file.size > AVATAR_SOURCE_MAX_BYTES) throw new AvatarPrepareError("AVATAR_SOURCE_TOO_LARGE");
  if (file.type === "image/gif" && file.size <= AVATAR_MAX_BYTES) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return fromBytes(bytes, "image/gif");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarPrepareError("AVATAR_DECODE_FAILED");
  }
  try {
    const crop = Math.min(bitmap.width, bitmap.height);
    if (!crop) throw new AvatarPrepareError("AVATAR_DECODE_FAILED");
    const side = Math.min(AVATAR_SIDE, crop);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new AvatarPrepareError("AVATAR_DECODE_FAILED");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);

    // Keep transparency where the picture has it; photos become JPEG.
    const transparent = file.type !== "image/jpeg" && hasTransparency(context, side);
    if (transparent) {
      const png = await encode(canvas, "image/png");
      if (png && png.length <= AVATAR_MAX_BYTES) return fromBytes(png, "image/png");
    }
    for (const quality of [0.92, 0.85, 0.75, 0.6]) {
      const jpeg = await encode(canvas, "image/jpeg", quality);
      if (jpeg && jpeg.length <= AVATAR_MAX_BYTES) return fromBytes(jpeg, "image/jpeg");
    }
    throw new AvatarPrepareError("AVATAR_TOO_LARGE");
  } finally {
    bitmap.close();
  }
}

function hasTransparency(context: CanvasRenderingContext2D, side: number): boolean {
  const pixels = context.getImageData(0, 0, side, side).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! < 250) return true;
  return false;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== type) { resolve(null); return; }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), () => resolve(null));
    }, type, quality);
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBytes(bytes: Uint8Array, type: string): PreparedAvatar {
  const base64 = bytesToBase64(bytes);
  return { base64, dataUrl: `data:${type};base64,${base64}`, bytes: bytes.length, type };
}
