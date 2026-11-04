import { reactive } from "vue";

export interface ViewerImage {
  src: string;
  name: string;
}

/** The page-wide image viewer: one at a time, opened from chat images. */
export const imageViewer = reactive({
  open: false,
  images: [] as ViewerImage[],
  index: 0,
});

/**
 * Open the viewer on `image`. The other images of the same conversation become
 * the gallery, so the arrows step through them in chat order.
 */
export function openImageViewer(image: ViewerImage, gallery: readonly ViewerImage[] = []): void {
  const images = gallery.length ? [...gallery] : [image];
  let index = images.findIndex(item => item.src === image.src);
  if (index < 0) { images.unshift(image); index = 0; }
  imageViewer.images = images;
  imageViewer.index = index;
  imageViewer.open = true;
}

export function closeImageViewer(): void {
  imageViewer.open = false;
  imageViewer.images = [];
  imageViewer.index = 0;
}

export function stepImageViewer(delta: number): void {
  const count = imageViewer.images.length;
  if (!imageViewer.open || count < 2) return;
  imageViewer.index = (imageViewer.index + delta + count) % count;
}

/** Chat images next to `element`, in document order, for the gallery. */
export function chatImagesAround(element: Element | null): ViewerImage[] {
  const scope = element?.closest('[data-ws-part="voice.chat.messages"]') ?? element?.closest('[data-ws-part="voice.chat"]');
  if (!scope) return [];
  return [...scope.querySelectorAll<HTMLAnchorElement>('a[data-ws-part="voice.chat.attachment-image"]')]
    .map(link => ({ src: link.href, name: link.title || "" }))
    .filter((item, position, all) => all.findIndex(other => other.src === item.src) === position);
}

export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

export const IMAGE_VIEWER_MAX_SCALE = 8;

/**
 * Zoom `view` to `scale` keeping the point `(px, py)` (relative to the stage
 * centre) under the cursor, clamped between `minScale` and the maximum.
 */
export function zoomAround(view: ZoomView, scale: number, px: number, py: number, minScale: number): ZoomView {
  const next = Math.min(IMAGE_VIEWER_MAX_SCALE, Math.max(minScale, scale));
  const ratio = next / view.scale;
  return { scale: next, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/** Keep a zoomed image from being dragged out of the stage; centre it when it fits. */
export function clampPan(view: ZoomView, imageWidth: number, imageHeight: number, stageWidth: number, stageHeight: number): ZoomView {
  const limit = (size: number, stage: number, offset: number) => {
    const overflow = Math.max(0, (size - stage) / 2);
    return Math.min(overflow, Math.max(-overflow, offset));
  };
  return { scale: view.scale, x: limit(imageWidth * view.scale, stageWidth, view.x), y: limit(imageHeight * view.scale, stageHeight, view.y) };
}
