import type { WhiteboardElement } from "../../../src/shared/whiteboard.js";

/** Geometry, hit testing and canvas drawing for whiteboard elements. */

export interface Bounds { x: number; y: number; w: number; h: number }

export const WHITEBOARD_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
export const TEXT_LINE_HEIGHT = 1.25;

export function normalizeBounds(x: number, y: number, w: number, h: number): Bounds {
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
}

/** Tight bounds of the geometry, without the stroke width. */
export function elementBounds(element: WhiteboardElement): Bounds {
  if (element.type === "pen" && element.points?.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const points = element.points;
    for (let index = 0; index < points.length; index += 2) {
      minX = Math.min(minX, points[index]!); maxX = Math.max(maxX, points[index]!);
      minY = Math.min(minY, points[index + 1]!); maxY = Math.max(maxY, points[index + 1]!);
    }
    return { x: element.x + minX, y: element.y + minY, w: maxX - minX, h: maxY - minY };
  }
  return normalizeBounds(element.x, element.y, element.w, element.h);
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const bounds of list) {
    minX = Math.min(minX, bounds.x); minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w); maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is world point (px, py) on the element, within `tolerance` world units? */
export function hitTest(element: WhiteboardElement, px: number, py: number, tolerance: number): boolean {
  const reach = tolerance + element.strokeWidth / 2;
  switch (element.type) {
    case "pen": {
      const points = element.points ?? [];
      if (points.length === 2) return Math.hypot(px - element.x - points[0]!, py - element.y - points[1]!) <= reach;
      for (let index = 2; index < points.length; index += 2) {
        if (segmentDistance(px, py, element.x + points[index - 2]!, element.y + points[index - 1]!, element.x + points[index]!, element.y + points[index + 1]!) <= reach) return true;
      }
      return false;
    }
    case "line":
    case "arrow":
      return segmentDistance(px, py, element.x, element.y, element.x + element.w, element.y + element.h) <= reach;
    case "rect": {
      const b = elementBounds(element);
      const inside = px >= b.x - reach && px <= b.x + b.w + reach && py >= b.y - reach && py <= b.y + b.h + reach;
      if (!inside) return false;
      if (element.fill) return true;
      return px <= b.x + reach || px >= b.x + b.w - reach || py <= b.y + reach || py >= b.y + b.h - reach;
    }
    case "ellipse": {
      const b = elementBounds(element);
      const rx = b.w / 2, ry = b.h / 2;
      if (rx < 0.5 || ry < 0.5) return segmentDistance(px, py, b.x, b.y, b.x + b.w, b.y + b.h) <= reach;
      const nx = (px - (b.x + rx)) / rx, ny = (py - (b.y + ry)) / ry;
      const radial = Math.hypot(nx, ny);
      if (element.fill && radial <= 1) return true;
      // Approximate distance to the outline in world units.
      return Math.abs(radial - 1) * Math.min(rx, ry) <= reach;
    }
    default: {
      const b = elementBounds(element);
      return px >= b.x - tolerance && px <= b.x + b.w + tolerance && py >= b.y - tolerance && py <= b.y + b.h + tolerance;
    }
  }
}

export function translateElement(element: WhiteboardElement, dx: number, dy: number): WhiteboardElement {
  return { ...element, x: round(element.x + dx), y: round(element.y + dy) };
}

/** Map an element from one bounding box onto another (group resize). */
export function scaleElement(element: WhiteboardElement, from: Bounds, to: Bounds): WhiteboardElement {
  const sx = from.w > 0.0001 ? to.w / from.w : 1;
  const sy = from.h > 0.0001 ? to.h / from.h : 1;
  const mapX = (x: number) => to.x + (x - from.x) * sx;
  const mapY = (y: number) => to.y + (y - from.y) * sy;
  if (element.type === "pen") {
    const points = (element.points ?? []).map((value, index) => round(index % 2 === 0 ? value * sx : value * sy));
    return { ...element, x: round(mapX(element.x)), y: round(mapY(element.y)), points };
  }
  if (element.type === "line" || element.type === "arrow") {
    const x1 = mapX(element.x), y1 = mapY(element.y), x2 = mapX(element.x + element.w), y2 = mapY(element.y + element.h);
    return { ...element, x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
  }
  const b = elementBounds(element);
  const next = normalizeBounds(mapX(b.x), mapY(b.y), b.w * sx, b.h * sy);
  const scaled = { ...element, x: round(next.x), y: round(next.y), w: round(Math.max(1, next.w)), h: round(Math.max(1, next.h)) };
  if (element.type === "text" && element.fontSize) {
    scaled.fontSize = Math.max(6, Math.min(400, round(element.fontSize * Math.min(Math.abs(sx), Math.abs(sy)))));
  }
  return scaled;
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function textLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function measureText(context: CanvasRenderingContext2D, text: string, fontSize: number): { w: number; h: number } {
  context.save();
  context.font = `${fontSize}px ${WHITEBOARD_FONT}`;
  const lines = textLines(text);
  const width = Math.max(...lines.map((line) => context.measureText(line || " ").width));
  context.restore();
  return { w: Math.ceil(width) + 2, h: Math.ceil(lines.length * fontSize * TEXT_LINE_HEIGHT) };
}

/** Decoded images by data URL; `onLoad` asks for a redraw when one arrives. */
export class WhiteboardImageCache {
  private readonly images = new Map<string, HTMLImageElement>();
  constructor(private readonly onLoad: () => void) {}
  get(src: string): HTMLImageElement | null {
    let image = this.images.get(src);
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.onload = () => this.onLoad();
      image.src = src;
      this.images.set(src, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }
  /** Forget images no longer on the board. */
  retain(sources: Set<string>): void {
    for (const src of [...this.images.keys()]) if (!sources.has(src)) this.images.delete(src);
  }
}

function drawArrowHead(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(10, width * 3.5);
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7));
  context.lineTo(x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

export function drawElement(context: CanvasRenderingContext2D, element: WhiteboardElement, images: WhiteboardImageCache | null): void {
  context.save();
  context.strokeStyle = element.stroke;
  context.fillStyle = element.stroke;
  context.lineWidth = element.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  switch (element.type) {
    case "pen": {
      const points = element.points ?? [];
      context.translate(element.x, element.y);
      if (points.length <= 4) {
        if (points.length === 2 || (points[0] === points[2] && points[1] === points[3])) {
          context.beginPath();
          context.arc(points[0]!, points[1]!, element.strokeWidth / 2, 0, Math.PI * 2);
          context.fill();
          break;
        }
      }
      context.beginPath();
      context.moveTo(points[0]!, points[1]!);
      // Quadratic curves through segment midpoints smooth the stroke.
      for (let index = 2; index < points.length - 2; index += 2) {
        const mx = (points[index]! + points[index + 2]!) / 2, my = (points[index + 1]! + points[index + 3]!) / 2;
        context.quadraticCurveTo(points[index]!, points[index + 1]!, mx, my);
      }
      context.lineTo(points[points.length - 2]!, points[points.length - 1]!);
      context.stroke();
      break;
    }
    case "line":
    case "arrow": {
      const x2 = element.x + element.w, y2 = element.y + element.h;
      let endX = x2, endY = y2;
      if (element.type === "arrow") {
        // Stop the shaft short of the tip so the round cap does not poke through.
        const length = Math.hypot(element.w, element.h);
        const back = Math.min(length, Math.max(10, element.strokeWidth * 3.5) * 0.6);
        if (length > 0) { endX = x2 - (element.w / length) * back; endY = y2 - (element.h / length) * back; }
      }
      context.beginPath();
      context.moveTo(element.x, element.y);
      context.lineTo(endX, endY);
      context.stroke();
      if (element.type === "arrow" && (element.w || element.h)) drawArrowHead(context, element.x, element.y, x2, y2, element.strokeWidth);
      break;
    }
    case "rect": {
      const b = elementBounds(element);
      if (element.fill) { context.fillStyle = element.fill; context.fillRect(b.x, b.y, b.w, b.h); }
      context.strokeRect(b.x, b.y, b.w, b.h);
      break;
    }
    case "ellipse": {
      const b = elementBounds(element);
      context.beginPath();
      context.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(0.1, b.w / 2), Math.max(0.1, b.h / 2), 0, 0, Math.PI * 2);
      if (element.fill) { context.fillStyle = element.fill; context.fill(); }
      context.stroke();
      break;
    }
    case "text": {
      const fontSize = element.fontSize ?? 20;
      context.font = `${fontSize}px ${WHITEBOARD_FONT}`;
      context.textBaseline = "top";
      const lines = textLines(element.text ?? "");
      lines.forEach((line, index) => context.fillText(line, element.x, element.y + index * fontSize * TEXT_LINE_HEIGHT + fontSize * (TEXT_LINE_HEIGHT - 1) / 2));
      break;
    }
    case "image": {
      const image = element.src && images ? images.get(element.src) : null;
      if (image) context.drawImage(image, element.x, element.y, element.w, element.h);
      else {
        context.fillStyle = "#eef1f4";
        context.fillRect(element.x, element.y, element.w, element.h);
      }
      break;
    }
  }
  context.restore();
}
