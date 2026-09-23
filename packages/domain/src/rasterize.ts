/** Convert to pixel image (FEAT-0030): what is drawn, where the picture goes and its pixel box. */
import { Layer, StudioDocument, strokeBounds } from "./document";
import { worldPoint } from "./curves";

/** Resolutions offered for Convert to pixel image; the page is 72 units per inch. */
export const RASTER_RESOLUTIONS = [72, 150, 300] as const;
export const PAGE_PPI = 72;
/** The largest side and pixel count a conversion may produce, so it stays within memory. */
export const MAX_RASTER_SIDE = 8192;
export const MAX_RASTER_PIXELS = 32 * 1024 * 1024;

export type RasterAntialias = "art" | "none";
export interface RasterOptions {
  /** Pixels per inch of the result. */
  ppi: number;
  antialias: RasterAntialias;
  /** Space added around the artwork, in page units. */
  margin: number;
}
export const DEFAULT_RASTER_OPTIONS: Readonly<RasterOptions> = { ppi: 150, antialias: "art", margin: 0 };

export interface Box { x: number; y: number; width: number; height: number }
export interface RasterTarget {
  /** Identifiers of the layers drawn into the image. */
  ids: string[];
  /** Index in the layer list at which the image is inserted, above the topmost target. */
  insertAt: number;
  /** Group of the topmost selected object, which the image joins. */
  groupPath?: string[];
  /** A page area that holds every pixel the targets can paint. */
  area: Box;
}

export function validRasterOptions(options: RasterOptions): boolean {
  return Number.isFinite(options.ppi) && options.ppi >= 1 && options.ppi <= 2400
    && (options.antialias === "art" || options.antialias === "none")
    && Number.isFinite(options.margin) && options.margin >= 0 && options.margin <= 1000;
}

/**
 * The layers a conversion draws: the selected ones that are drawn, or, with nothing
 * selected, every visible layer that prints. Hidden layers and guides are never drawn,
 * as in PNG export. Returns null when nothing would be drawn.
 */
export function rasterTarget(document: StudioDocument, selectedIds: readonly string[]): RasterTarget | null {
  const chosen = new Set(selectedIds);
  const whole = chosen.size === 0;
  const indices: number[] = [];
  document.layers.forEach((layer, index) => {
    if ((whole || chosen.has(layer.id)) && layer.visible && !layer.guide) indices.push(index);
  });
  if (!indices.length) return null;
  const layers = indices.map((index) => document.layers[index]);
  const top = document.layers[indices[indices.length - 1]];
  return {
    ids: layers.map((layer) => layer.id),
    insertAt: whole ? document.layers.length : indices[indices.length - 1] + 1,
    groupPath: !whole && top.groupPath?.length ? [...top.groupPath] : undefined,
    area: paintArea(layers),
  };
}

/**
 * A page box that holds everything the layers can paint: their frames and control points
 * widened by the stroke, the line ends and the blur, and by a fixed allowance for type and
 * labels that can run past a frame. The image is cropped to its painted pixels afterwards,
 * so this box only needs to be large enough, not exact.
 */
export function paintArea(layers: readonly Layer[]): Box {
  const points = layers.flatMap((layer) => {
    const local = strokeBounds(layer);
    const pad = 32 + Math.max(layer.fontSize || 0, 0) + Math.max(layer.adjustments?.blur ?? 0, 0) * 3;
    const x0 = local.x - pad, y0 = local.y - pad, x1 = local.x + local.width + pad, y1 = local.y + local.height + pad;
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map((point) => worldPoint(layer, point));
  });
  const x = Math.floor(Math.min(...points.map((p) => p.x)));
  const y = Math.floor(Math.min(...points.map((p) => p.y)));
  return { x, y, width: Math.ceil(Math.max(...points.map((p) => p.x))) - x, height: Math.ceil(Math.max(...points.map((p) => p.y))) - y };
}

/** Pixels per page unit at a resolution. */
export function rasterScale(ppi: number): number {
  return ppi / PAGE_PPI;
}

/**
 * Widens a page box to whole pixels of a grid anchored at the page origin, so the same
 * artwork always lands on the same pixels whatever area is drawn around it.
 */
export function alignToPixels(area: Box, scale: number): Box {
  const left = Math.floor(area.x * scale), top = Math.floor(area.y * scale);
  const right = Math.ceil((area.x + area.width) * scale), bottom = Math.ceil((area.y + area.height) * scale);
  return { x: left / scale, y: top / scale, width: Math.max(1, right - left) / scale, height: Math.max(1, bottom - top) / scale };
}

/** Pixel size of a page box at a scale, or null when it exceeds the limits. */
export function rasterPixels(area: Box, scale: number): { width: number; height: number } | null {
  const width = Math.max(1, Math.ceil(area.width * scale));
  const height = Math.max(1, Math.ceil(area.height * scale));
  return width > MAX_RASTER_SIDE || height > MAX_RASTER_SIDE || width * height > MAX_RASTER_PIXELS ? null : { width, height };
}

/**
 * The page frame and pixel box of the result: the painted pixels found inside the drawn
 * area, grown by the margin on every side.
 */
export function rasterFrame(area: Box, painted: Box, scale: number, margin: number) {
  const pad = Math.round(margin * scale);
  const pixels = { x: painted.x - pad, y: painted.y - pad, width: painted.width + pad * 2, height: painted.height + pad * 2 };
  return {
    pixels,
    frame: { x: area.x + pixels.x / scale, y: area.y + pixels.y / scale, width: pixels.width / scale, height: pixels.height / scale },
  };
}

/** Anti-aliasing none: every pixel is either fully painted or empty, split at half coverage. */
export function aliasPixels(data: Uint8ClampedArray): void {
  for (let index = 3; index < data.length; index += 4) data[index] = data[index] >= 128 ? 255 : 0;
}
