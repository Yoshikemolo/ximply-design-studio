import type { Layer, Point } from "./document";

/**
 * Paints beyond a flat colour, as Illustrator's Gradient and Swatches panels hold them:
 * linear and radial gradients with stops and midpoints, patterns tiled from artwork, and
 * the swatches of a document. Also the colour models a colour can be edited in, which
 * change how a colour is chosen, never the colour the document stores.
 */

export interface GradientStop {
  /** A colour as #rrggbb or #rrggbbaa. */
  color: string;
  /** Where the stop sits along the gradient, 0 to 100. */
  location: number;
  /** Where, between this stop and the next, the two colours are half and half: 13 to 87. */
  midpoint: number;
}
export interface GradientPaint {
  kind: "gradient";
  type: "linear" | "radial";
  /** The direction of a linear gradient in degrees, -180 to 180. */
  angle: number;
  stops: GradientStop[];
  /**
   * The line the Gradient tool drew, as fractions of the object's box, from where the
   * first stop sits to where the last one does. Without it the gradient fills the box.
   */
  vector?: { start: Point; end: Point };
}
export interface PatternPaint {
  kind: "pattern";
  patternId: string;
}
export type FillPaint = GradientPaint | PatternPaint;

/** A pattern tile: artwork laid out on a tile of a given size, repeated from the origin. */
export interface PatternDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
}
export type Swatch =
  | { id: string; name: string; kind: "color"; color: string }
  | { id: string; name: string; kind: "gradient"; gradient: GradientPaint }
  | { id: string; name: string; kind: "pattern"; patternId: string };

export const MAX_STOPS = 32;
export const MAX_PATTERNS = 50;
export const MAX_PATTERN_LAYERS = 200;
export const MAX_SWATCHES = 500;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const finite = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function validGradient(value: unknown): value is GradientPaint {
  if (!record(value) || value["kind"] !== "gradient") return false;
  const keys = Object.keys(value);
  if (keys.some((k) => !["kind", "type", "angle", "stops", "vector"].includes(k))) return false;
  if (!["linear", "radial"].includes(String(value["type"])) || !finite(value["angle"], -180, 180)) return false;
  const stops = value["stops"];
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) return false;
  let previous = -Infinity;
  for (const stop of stops) {
    if (!record(stop) || Object.keys(stop).length !== 3 || typeof stop["color"] !== "string" || !HEX.test(stop["color"])) return false;
    if (!finite(stop["location"], 0, 100) || !finite(stop["midpoint"], 13, 87) || (stop["location"] as number) < previous) return false;
    previous = stop["location"] as number;
  }
  const vector = value["vector"];
  if (vector !== undefined) {
    const point = (p: unknown) => record(p) && Object.keys(p).length === 2 && finite(p["x"], -100, 100) && finite(p["y"], -100, 100);
    if (!record(vector) || Object.keys(vector).length !== 2 || !point(vector["start"]) || !point(vector["end"])) return false;
  }
  return true;
}
export function validFillPaint(value: unknown, patternIds: Set<string>): value is FillPaint {
  if (record(value) && value["kind"] === "pattern")
    return Object.keys(value).length === 2 && typeof value["patternId"] === "string" && patternIds.has(value["patternId"]);
  return validGradient(value);
}
export function validSwatch(value: unknown, patternIds: Set<string>): value is Swatch {
  if (!record(value) || typeof value["id"] !== "string" || value["id"].length < 1 || value["id"].length > 100) return false;
  if (typeof value["name"] !== "string" || value["name"].length > 150 || Object.keys(value).length !== 4) return false;
  if (value["kind"] === "color") return typeof value["color"] === "string" && HEX.test(value["color"]);
  if (value["kind"] === "gradient") return validGradient(value["gradient"]);
  if (value["kind"] === "pattern") return typeof value["patternId"] === "string" && patternIds.has(value["patternId"]);
  return false;
}

/** Where a gradient runs on an object, in the object's own coordinates. */
export function gradientGeometry(paint: GradientPaint, width: number, height: number): { start: Point; end: Point; radius: number } {
  if (paint.vector) {
    const start = { x: paint.vector.start.x * width, y: paint.vector.start.y * height };
    const end = { x: paint.vector.end.x * width, y: paint.vector.end.y * height };
    return { start, end, radius: Math.max(1e-6, Math.hypot(end.x - start.x, end.y - start.y)) };
  }
  const centre = { x: width / 2, y: height / 2 };
  if (paint.type === "radial") {
    const radius = Math.max(width, height) / 2 || 1;
    return { start: centre, end: { x: centre.x + radius, y: centre.y }, radius };
  }
  // A linear gradient crosses the whole box along its angle, corner to corner.
  const a = (paint.angle * Math.PI) / 180;
  const half = (Math.abs(width * Math.cos(a)) + Math.abs(height * Math.sin(a))) / 2;
  const d = { x: Math.cos(a) * half, y: -Math.sin(a) * half };
  return { start: { x: centre.x - d.x, y: centre.y - d.y }, end: { x: centre.x + d.x, y: centre.y + d.y }, radius: half * 2 || 1 };
}

/**
 * The colour stops a renderer draws, from 0 to 1, with each midpoint written as a stop of
 * its own holding the even mix of its neighbours, as a gradient slider shows it.
 */
export function renderedStops(paint: GradientPaint): Array<{ offset: number; color: string }> {
  const stops = [...paint.stops].sort((a, b) => a.location - b.location);
  const out: Array<{ offset: number; color: string }> = [];
  stops.forEach((stop, i) => {
    out.push({ offset: stop.location / 100, color: stop.color });
    const next = stops[i + 1];
    if (next && Math.abs(stop.midpoint - 50) > 1e-9 && next.location > stop.location) {
      const at = stop.location + ((next.location - stop.location) * stop.midpoint) / 100;
      out.push({ offset: at / 100, color: mixColors(stop.color, next.color, 0.5) });
    }
  });
  return out;
}

/** The colour at a position of a gradient, 0 to 1, as the renderer would paint it. */
export function gradientColorAt(paint: GradientPaint, position: number): string {
  const stops = renderedStops(paint);
  if (position <= stops[0].offset) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    if (position <= stops[i].offset) {
      const span = stops[i].offset - stops[i - 1].offset;
      return mixColors(stops[i - 1].color, stops[i].color, span > 0 ? (position - stops[i - 1].offset) / span : 1);
    }
  }
  return stops[stops.length - 1].color;
}

/**
 * The fill paint of a blend step between two objects. Two gradients mix stop by stop at the
 * locations of both, and their angles or lines move between the two; a gradient and a flat
 * colour mix as if the colour were a gradient of that colour alone, so the steps fade from
 * the gradient into the colour. Patterns are not mixed: a step keeps the nearer end's.
 */
export function blendFillPaint(back: { fill: string; fillPaint?: FillPaint }, front: { fill: string; fillPaint?: FillPaint }, t: number): FillPaint | undefined {
  const near = t < 0.5 ? back : front;
  const a = back.fillPaint, b = front.fillPaint;
  if (a?.kind === "pattern" || b?.kind === "pattern") return near.fillPaint?.kind === "pattern" ? structuredClone(near.fillPaint) : undefined;
  if (!a && !b) return undefined;
  const flat = (color: string, like: GradientPaint): GradientPaint => ({
    ...structuredClone(like),
    // A missing fill fades in as the gradient's own colours made transparent.
    stops: like.stops.map((stop) => ({ ...stop, color: color === "none" ? stop.color.slice(0, 7) + "00" : color })),
  });
  const from = a ?? flat(back.fill, b as GradientPaint), to = b ?? flat(front.fill, a as GradientPaint);
  const offsets = [...new Set([...renderedStops(from), ...renderedStops(to)].map((stop) => Math.round(stop.offset * 1e6) / 1e6))].sort((x, y) => x - y);
  const sampled = offsets.length > MAX_STOPS ? Array.from({ length: MAX_STOPS }, (_, i) => i / (MAX_STOPS - 1)) : offsets;
  const turn = ((to.angle - from.angle) % 360 + 540) % 360 - 180;
  const angle = ((from.angle + turn * t + 180) % 360 + 360) % 360 - 180;
  const lerpPoint = (p: Point, q: Point) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const result: GradientPaint = {
    kind: "gradient",
    type: from.type === to.type ? from.type : (t < 0.5 ? from : to).type,
    angle: Math.max(-180, Math.min(180, Math.round(angle * 1e6) / 1e6)),
    stops: sampled.map((offset) => ({ color: mixColors(gradientColorAt(from, offset), gradientColorAt(to, offset), t), location: Math.round(offset * 100 * 1e6) / 1e6, midpoint: 50 })),
  };
  if (result.stops.length < 2) result.stops = [{ ...result.stops[0], location: 0 }, { ...result.stops[0], location: 100 }];
  if (from.vector && to.vector) result.vector = { start: lerpPoint(from.vector.start, to.vector.start), end: lerpPoint(from.vector.end, to.vector.end) };
  else if ((t < 0.5 ? from : to).vector) result.vector = structuredClone((t < 0.5 ? from : to).vector);
  return result;
}

export function parseHex(color: string): { r: number; g: number; b: number; a: number } {
  const hex = HEX.test(color) ? color.slice(1) : "000000";
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}
export function toHex(r: number, g: number, b: number, a = 1): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return "#" + part(r) + part(g) + part(b) + (a < 1 ? part(a * 255) : "");
}
export function mixColors(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  return toHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t, x.a + (y.a - x.a) * t);
}

/** The colour models a colour can be edited in. The document always stores RGB. */
export type ColorMode = "quick" | "rgb" | "cmyk" | "grayscale" | "palette";
export const COLOR_MODES: ColorMode[] = ["quick", "rgb", "cmyk", "grayscale", "palette"];

/** Cyan, magenta, yellow and black, 0 to 100, of an RGB colour, by the naive device conversion. */
export function rgbToCmyk(color: string): { c: number; m: number; y: number; k: number } {
  const { r, g, b } = parseHex(color);
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const part = (v: number) => ((1 - v / 255 - k) / (1 - k)) * 100;
  const round = (v: number) => Math.round(v * 10) / 10;
  return { c: round(part(r)), m: round(part(g)), y: round(part(b)), k: round(k * 100) };
}
export function cmykToRgb(c: number, m: number, y: number, k: number): string {
  const f = (v: number) => 255 * (1 - Math.min(100, Math.max(0, v)) / 100) * (1 - Math.min(100, Math.max(0, k)) / 100);
  return toHex(f(c), f(m), f(y));
}
/** The black of a grey, 0 (white) to 100 (black), from the luminance of an RGB colour. */
export function rgbToGray(color: string): number {
  const { r, g, b } = parseHex(color);
  return Math.round((1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255) * 1000) / 10;
}
export function grayToRgb(black: number): string {
  const v = 255 * (1 - Math.min(100, Math.max(0, black)) / 100);
  return toHex(v, v, v);
}

/** Presets a new document's Swatches panel starts with, in the spirit of a print palette. */
export const DEFAULT_SWATCH_COLORS: Array<[string, string]> = [
  ["White", "#ffffff"], ["Black", "#000000"], ["Grey 75%", "#404040"], ["Grey 50%", "#808080"], ["Grey 25%", "#bfbfbf"],
  ["Red", "#e31e24"], ["Orange", "#f39200"], ["Yellow", "#ffed00"], ["Green", "#3aaa35"], ["Cyan", "#009fe3"],
  ["Blue", "#1d71b8"], ["Violet", "#662483"], ["Magenta", "#e6007e"], ["Brown", "#8a5a2b"], ["Sand", "#dcc49a"],
];
export const DEFAULT_GRADIENTS: Array<[string, GradientPaint]> = [
  ["White to black", { kind: "gradient", type: "linear", angle: 0, stops: [{ color: "#ffffff", location: 0, midpoint: 50 }, { color: "#000000", location: 100, midpoint: 50 }] }],
  ["Radial white to black", { kind: "gradient", type: "radial", angle: 0, stops: [{ color: "#ffffff", location: 0, midpoint: 50 }, { color: "#000000", location: 100, midpoint: 50 }] }],
  ["Sunset", { kind: "gradient", type: "linear", angle: 90, stops: [{ color: "#ffed00", location: 0, midpoint: 50 }, { color: "#f39200", location: 50, midpoint: 50 }, { color: "#e31e24", location: 100, midpoint: 50 }] }],
  ["Sky", { kind: "gradient", type: "linear", angle: 90, stops: [{ color: "#1d71b8", location: 0, midpoint: 50 }, { color: "#dff2fd", location: 100, midpoint: 50 }] }],
];

/** The patterns a document can start from, drawn in a colour on a tile of its own. */
export type PresetPattern = "stripes" | "dots" | "checker" | "grid" | "diagonal";
export const PRESET_PATTERNS: PresetPattern[] = ["stripes", "dots", "checker", "grid", "diagonal"];
export function presetPattern(kind: PresetPattern, id: string, color = "#000000", size = 16): PatternDefinition {
  const base = (layerId: string, shape: Partial<Layer>): Layer => ({
    id: layerId, name: "Tile", kind: "rectangle", x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, visible: true, locked: false,
    blend: "source-over", fill: color, stroke: "none", strokeWidth: 0, points: [], text: "", fontSize: 16, source: "",
    adjustments: { brightness: 100, contrast: 100, saturation: 100, blur: 0 }, ...shape,
  });
  const half = size / 2;
  const layers: Layer[] =
    kind === "stripes" ? [base(id + "-1", { width: size, height: half })]
    : kind === "dots" ? [base(id + "-1", { kind: "ellipse", x: size / 4, y: size / 4, width: half, height: half })]
    : kind === "checker" ? [base(id + "-1", { width: half, height: half }), base(id + "-2", { x: half, y: half, width: half, height: half })]
    : kind === "grid" ? [base(id + "-1", { width: size, height: 1 }), base(id + "-2", { width: 1, height: size })]
    : [base(id + "-1", {
        kind: "path", name: "Tile", width: size, height: size, fill: "none", stroke: color, strokeWidth: 2,
        curves: [{ closed: false, nodes: [{ x: 0, y: size }, { x: size, y: 0 }].map((p) => ({ point: p, incoming: { ...p }, outgoing: { ...p }, smooth: false })) }],
      })];
  const names: Record<PresetPattern, string> = { stripes: "Stripes", dots: "Dots", checker: "Checker", grid: "Grid", diagonal: "Diagonal lines" };
  return { id, name: names[kind], width: size, height: size, layers };
}

/** The swatches a document shows when it has none of its own yet. */
export function defaultSwatches(): Swatch[] {
  return [
    ...DEFAULT_SWATCH_COLORS.map(([name, color], i): Swatch => ({ id: "color-" + i, name, kind: "color", color })),
    ...DEFAULT_GRADIENTS.map(([name, gradient], i): Swatch => ({ id: "gradient-" + i, name, kind: "gradient", gradient: structuredClone(gradient) })),
  ];
}
