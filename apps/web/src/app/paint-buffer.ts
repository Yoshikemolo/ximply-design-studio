import { Layer, StudioDocument } from '../../../../packages/domain/src/document';
import { worldPoint } from '../../../../packages/domain/src/curves';

/** Paint buffers use a world-aligned frame, retaining pixels outside the page. */
export function paintFrame(layer: Layer, document: StudioDocument): Layer {
  if (!layer.paintLayer) return layer;
  const corners = [{ x: 0, y: 0 }, { x: layer.width, y: 0 }, { x: 0, y: layer.height }, { x: layer.width, y: layer.height }].map(p => worldPoint(layer, p));
  const x = Math.floor(Math.min(0, ...corners.map(p => p.x)));
  const y = Math.floor(Math.min(0, ...corners.map(p => p.y)));
  return { ...layer, x, y, width: Math.ceil(Math.max(document.width, ...corners.map(p => p.x))) - x,
    height: Math.ceil(Math.max(document.height, ...corners.map(p => p.y))) - y, rotation: 0, skewX: 0, flipX: false, flipY: false };
}
export function drawPaintSource(ctx: CanvasRenderingContext2D, image: HTMLImageElement, original: Layer, frame: Layer, width: number, height: number) {
  if (!original.paintLayer) { ctx.drawImage(image, 0, 0, width, height); return; }
  const p = worldPoint(original, { x: 0, y: 0 });
  const u = worldPoint(original, { x: original.width, y: 0 });
  const v = worldPoint(original, { x: 0, y: original.height });
  ctx.save();
  ctx.scale(width / frame.width, height / frame.height);
  ctx.transform((u.x - p.x) / original.width, (u.y - p.y) / original.width,
    (v.x - p.x) / original.height, (v.y - p.y) / original.height, p.x - frame.x, p.y - frame.y);
  ctx.drawImage(image, 0, 0, original.width, original.height);
  ctx.restore();
}
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
export function finishPaint(canvas: HTMLCanvasElement, frame: Layer, initial: Uint8ClampedArray): Layer | null | undefined {
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (pixels.data.every((value, i) => value === initial[i])) return undefined;
  if (!frame.paintLayer) return { ...frame, source: canvas.toDataURL('image/png') };
  const bounds = alphaBounds(pixels.data, canvas.width, canvas.height);
  if (!bounds) return null;
  const cropped = window.document.createElement('canvas');
  cropped.width = bounds.width; cropped.height = bounds.height;
  cropped.getContext('2d')!.putImageData(ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height), 0, 0);
  return { ...frame, x: frame.x + bounds.x * frame.width / canvas.width, y: frame.y + bounds.y * frame.height / canvas.height,
    width: bounds.width * frame.width / canvas.width, height: bounds.height * frame.height / canvas.height,
    source: cropped.toDataURL('image/png') };
}
