import { FONT_FAMILIES, layoutText, TextLayoutOptions, TextTypography, TextMeasurement } from "./text-layout";
import {
  CurvePath,
  flatten,
  mapCurves,
  curveSvg,
  snapDirection,
  worldPoint,
} from "./curves";
/** Editable local-preview document model. FEAT-0006: geometry and history invariants. */
export type LayerKind = "rectangle" | "ellipse" | "path" | "text" | "image";
export type Blend =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten";
export interface Point {
  x: number;
  y: number;
}
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
}
export interface StrokeStyle {
  alignment: "center" | "inside" | "outside";
  join: "round" | "bevel" | "miter";
  cap: "butt" | "square" | "round";
}
export const defaultStrokeStyle: Readonly<StrokeStyle> = { alignment: "center", join: "round", cap: "round" };
export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blend: Blend;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle?: StrokeStyle;
  points: Point[];
  text: string;
  fontSize: number;
  textLayout?: TextLayoutOptions;
  typography?: TextTypography;
  source: string;
  adjustments: Adjustments;
  curves?: CurvePath[];
  symbolId?: string;
  traceSourceId?: string;
  groupPath?: string[];
  guide?: "vertical" | "horizontal";
  skewX?: number;
  flipX?: boolean;
  flipY?: boolean;
}
export interface StudioDocument {
  format: "ximply-document";
  version: 1 | 2;
  symbols?: SymbolDefinition[];
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}
export interface SymbolDefinition {
  id: string;
  name: string;
  layer: Layer;
}
export const BLENDS: Blend[] = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
];
export function blankDocument(): StudioDocument {
  return {
    format: "ximply-document",
    version: 2,
    name: "Untitled exploration",
    width: 1200,
    height: 800,
    background: "#ffffff",
    layers: [],
  };
}
export function strokeBounds(layer: Layer) {
  const controls = layer.curves?.flatMap((path) => path.nodes.flatMap((node) => [node.point, node.incoming, node.outgoing])) ?? layer.points;
  const xs = [0, layer.width, ...controls.map((point) => point.x)];
  const ys = [0, layer.height, ...controls.map((point) => point.y)];
  const margin = layer.strokeWidth * 10 + 1;
  const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin;
  return { x, y, width: Math.max(...xs) + margin - x, height: Math.max(...ys) + margin - y };
}
export function newLayer(
  kind: LayerKind,
  id: string,
  point: Point,
  fill = "#0d59f2",
  stroke = "#163363",
  strokeWidth = 2,
): Layer {
  return {
    id,
    name: kind[0].toUpperCase() + kind.slice(1),
    kind,
    x: point.x,
    y: point.y,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blend: "source-over",
    fill,
    stroke,
    strokeWidth,
    points: [],
    text: "Your words",
    fontSize: 48,
    source: "",
    adjustments: { brightness: 100, contrast: 100, saturation: 100, blur: 0 },
  };
}
export function bounds(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(1, Math.abs(b.x - a.x)),
    height: Math.max(1, Math.abs(b.y - a.y)),
  };
}
export function localPoint(layer: Layer, point: Point): Point {
  const a = (-layer.rotation * Math.PI) / 180,
    x = point.x - layer.x - layer.width / 2,
    y = point.y - layer.y - layer.height / 2;
  const ry = x * Math.sin(a) + y * Math.cos(a),
    px =
      x * Math.cos(a) -
      y * Math.sin(a) -
      Math.tan(((layer.skewX ?? 0) * Math.PI) / 180) * ry +
      layer.width / 2,
    py = ry + layer.height / 2;
  return {
    x: layer.flipX ? layer.width - px : px,
    y: layer.flipY ? layer.height - py : py,
  };
}
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy;
  const t = len
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hitTest(layer: Layer, point: Point): boolean {
  if (!layer.visible || layer.locked || layer.guide) return false;
  const p = localPoint(layer, point),
    pad = Math.max(5, layer.strokeWidth * (layer.strokeStyle?.alignment === "outside" ? 1 : 0.5));
  if (layer.kind === "ellipse")
    return (
      ((p.x - layer.width / 2) / (layer.width / 2 + pad)) ** 2 +
        ((p.y - layer.height / 2) / (layer.height / 2 + pad)) ** 2 <=
      1
    );
  if (layer.curves) {
    let inside = false;
    for (const curve of layer.curves) {
      const pts = flatten(curve);
      if (pts.some((b, i) => i > 0 && segmentDistance(p, pts[i - 1], b) <= pad))
        return true;
      if (curve.closed)
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i],
            b = pts[j];
          if (
            a.y > p.y !== b.y > p.y &&
            p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
          )
            inside = !inside;
        }
    }
    return inside;
  }
  if (layer.kind === "path")
    return layer.points.some(
      (b, i) => i > 0 && segmentDistance(p, layer.points[i - 1], b) <= pad,
    );
  return (
    p.x >= -pad &&
    p.y >= -pad &&
    p.x <= layer.width + pad &&
    p.y <= layer.height + pad
  );
}
export function pick(layers: Layer[], point: Point): Layer | undefined {
  return [...layers].reverse().find((layer) => hitTest(layer, point));
}
export function normalizePath(layer: Layer, points: Point[]): Layer {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return {
    ...layer,
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
    points: points.map((p) => ({ x: p.x - x, y: p.y - y })),
  };
}
export function resizeLayer(
  layer: Layer,
  width: number,
  height: number,
): Layer {
  return {
    ...layer,
    width,
    height,
    ...(layer.curves
      ? {
          curves: mapCurves(layer.curves, (p) => ({
            x: (p.x * width) / layer.width,
            y: (p.y * height) / layer.height,
          })),
        }
      : {}),
    points: layer.points.map((p) => ({
      x: (p.x * width) / layer.width,
      y: (p.y * height) / layer.height,
    })),
  };
}
export function resizeFromCorner(
  layer: Layer,
  point: Point,
  corner: "tl" | "tr" | "bl" | "br" | "t" | "r" | "b" | "l",
  snapAngle?: number,
): Layer {
  let p = localPoint(layer, point);
  if (snapAngle && corner.length === 2)
    p = snapDirection(
      {
        x: corner.endsWith("l") ? layer.width : 0,
        y: corner.startsWith("t") ? layer.height : 0,
      },
      p,
      snapAngle,
    );
  const left = corner.endsWith("l") ? Math.min(p.x, layer.width - 1) : 0,
    top = corner.startsWith("t") ? Math.min(p.y, layer.height - 1) : 0;
  const right = corner.endsWith("r") ? Math.max(p.x, 1) : layer.width,
    bottom = corner.startsWith("b") ? Math.max(p.y, 1) : layer.height;
  const width = right - left,
    height = bottom - top,
    center = worldPoint(layer, {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
    });
  return {
    ...resizeLayer(layer, width, height),
    x: center.x - width / 2,
    y: center.y - height / 2,
  };
}
export class DocumentHistory {
  private past: StudioDocument[] = [];
  private future: StudioDocument[] = [];
  constructor(private limit = 24) {}
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  commit(before: StudioDocument) {
    this.past.push(structuredClone(before));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: StudioDocument): StudioDocument {
    const next = this.past.pop();
    if (!next) return current;
    this.future.push(structuredClone(current));
    return next;
  }
  redo(current: StudioDocument): StudioDocument {
    const next = this.future.pop();
    if (!next) return current;
    this.past.push(structuredClone(current));
    return next;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}
const color = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
function paint(value: unknown, version: unknown): boolean {
  return color(value) || (version === 2 && typeof value === "string" &&
    (value === "none" || /^#[0-9a-f]{8}$/i.test(value)));
}
export function parseDocument(text: string): StudioDocument {
  if (text.length > 35_000_000)
    throw new Error("Project exceeds the 35 MB preview limit.");
  const value: unknown = JSON.parse(text);
  if (
    !record(value) ||
    value["format"] !== "ximply-document" ||
    ![1, 2].includes(value["version"] as number)
  )
    throw new Error("Unsupported project format.");
  if (
    typeof value["name"] !== "string" ||
    value["name"].length > 150 ||
    !finite(value["width"], 16, 4096) ||
    !finite(value["height"], 16, 4096) ||
    !color(value["background"]) ||
    !Array.isArray(value["layers"]) ||
    value["layers"].length > 150
  )
    throw new Error("Invalid document or preview limits exceeded.");
  const symbols = value["symbols"];
  if (
    symbols !== undefined &&
    (!Array.isArray(symbols) || symbols.length > 100)
  )
    throw new Error("Invalid symbol library.");
  if (value["version"] === 1 && symbols !== undefined)
    throw new Error("Symbols require native format 2.");
  const definitions = (symbols ?? []) as {
    id: string;
    name: string;
    layer: unknown;
  }[];
  const symbolIds = new Set<string>();
  for (const symbol of definitions) {
    if (
      !record(symbol) ||
      typeof symbol.id !== "string" ||
      symbol.id.length < 1 ||
      symbol.id.length > 100 ||
      symbolIds.has(symbol.id) ||
      typeof symbol.name !== "string" ||
      symbol.name.length > 150 ||
      !record(symbol.layer) ||
      symbol.layer["symbolId"] !== undefined ||
      symbol.layer["guide"] !== undefined
    )
      throw new Error("Invalid symbol definition.");
    symbolIds.add(symbol.id);
  }
  const ids = new Set<string>();
  for (const layer of [
    ...value["layers"],
    ...definitions.map((s) => s.layer),
  ]) {
    if (
      !record(layer) ||
      typeof layer["id"] !== "string" ||
      layer["id"].length < 1 ||
      layer["id"].length > 100 ||
      typeof layer["name"] !== "string" ||
      layer["name"].length > 150
    )
      throw new Error("Invalid layer identity.");
    if (value["layers"].includes(layer)) {
      if (ids.has(layer["id"])) throw new Error("Invalid layer identity.");
      ids.add(layer["id"]);
    }
    if (
      layer["skewX"] !== undefined &&
      (value["version"] !== 2 ||
        typeof layer["skewX"] !== "number" ||
        !Number.isFinite(layer["skewX"]) ||
        Math.abs(layer["skewX"]) > 89.9999)
    )
      throw new Error("Invalid shear transform.");
    for (const key of ["flipX", "flipY"])
      if (
        layer[key] !== undefined &&
        (typeof layer[key] !== "boolean" || value["version"] !== 2)
      )
        throw new Error("Invalid reflection transform.");
    if (
      layer["groupPath"] !== undefined &&
      (value["version"] !== 2 ||
        !Array.isArray(layer["groupPath"]) ||
        layer["groupPath"].length > 16 ||
        new Set(layer["groupPath"]).size !== layer["groupPath"].length ||
        layer["groupPath"].some(
          (id) => typeof id !== "string" || id.length < 1 || id.length > 100,
        ))
    )
      throw new Error("Invalid group path.");
    if (
      layer["traceSourceId"] !== undefined &&
      (typeof layer["traceSourceId"] !== "string" ||
        layer["traceSourceId"].length < 1 ||
        layer["traceSourceId"].length > 100 ||
        value["version"] === 1)
    )
      throw new Error("Invalid tracing source.");
    if (
      layer["symbolId"] !== undefined &&
      (typeof layer["symbolId"] !== "string" ||
        !symbolIds.has(layer["symbolId"]))
    )
      throw new Error("Unknown symbol reference.");
    if (
      layer["guide"] !== undefined &&
      (value["version"] !== 2 ||
        !["vertical", "horizontal"].includes(String(layer["guide"])) ||
        layer["kind"] !== "path" ||
        layer["symbolId"] !== undefined ||
        (Array.isArray(layer["groupPath"]) && layer["groupPath"].length > 0))
    )
      throw new Error("Invalid guide layer.");
    const strokeStyle = layer["strokeStyle"];
    if (strokeStyle !== undefined && (value["version"] !== 2 || !record(strokeStyle) ||
      Object.keys(strokeStyle).length !== 3 ||
      (typeof strokeStyle["alignment"] !== "string" || !["center", "inside", "outside"].includes(strokeStyle["alignment"])) ||
      (typeof strokeStyle["join"] !== "string" || !["round", "bevel", "miter"].includes(strokeStyle["join"])) ||
      (typeof strokeStyle["cap"] !== "string" || !["butt", "square", "round"].includes(strokeStyle["cap"]))))
      throw new Error("Invalid stroke style.");
    for (const key of ["textLayout", "typography"]) {
      const settings = layer[key];
      if (settings !== undefined) {
        if (value["version"] !== 2 || layer["kind"] !== "text" || !record(settings))
          throw new Error("Invalid text settings.");
        if (key === "textLayout") {
          if (Object.keys(settings).length !== 4 ||
            !["fixed", "content", "width", "height"].includes(String(settings["sizing"])) ||
            ["wrap", "hyphenate", "fit"].some((flag) => typeof settings[flag] !== "boolean") ||
            (settings["fit"] && settings["sizing"] !== "fixed"))
            throw new Error("Invalid text layout.");
        } else if (Object.keys(settings).length !== 13 ||
          !FONT_FAMILIES.includes(settings["fontFamily"] as TextTypography["fontFamily"]) ||
          !finite(settings["fontWeight"], 100, 900) || (settings["fontWeight"] as number) % 100 !== 0 ||
          !["normal", "italic"].includes(String(settings["fontStyle"])) ||
          !finite(settings["lineHeight"], 0, 2000) || !finite(settings["letterSpacing"], -100, 500) ||
          !finite(settings["wordSpacing"], -100, 1000) || !finite(settings["paragraphSpacing"], 0, 2000) ||
          !finite(settings["horizontalScale"], 0.1, 10) || !finite(settings["verticalScale"], 0.1, 10) ||
          !finite(settings["baselineShift"], -1000, 1000) ||
          !["left", "center", "right", "justify"].includes(String(settings["align"])) ||
          !["none", "underline", "line-through"].includes(String(settings["decoration"])) ||
          !["en", "es"].includes(String(settings["language"])))
          throw new Error("Invalid typography.");
      }
    }
    if (layer["curves"] !== undefined) {
      if (
        value["version"] === 1 ||
        !Array.isArray(layer["curves"]) ||
        layer["curves"].length > 4096 ||
        layer["kind"] !== "path"
      )
        throw new Error("Invalid curve paths.");
      let total = 0;
      for (const path of layer["curves"]) {
        if (
          !record(path) ||
          typeof path["closed"] !== "boolean" ||
          !Array.isArray(path["nodes"]) ||
          (total += path["nodes"].length) > 20000
        )
          throw new Error("Invalid curve nodes.");
        for (const node of path["nodes"]) {
          if (!record(node) || typeof node["smooth"] !== "boolean")
            throw new Error("Invalid curve anchor.");
          for (const key of ["point", "incoming", "outgoing"]) {
            const p = node[key];
            if (
              !record(p) ||
              !finite(p["x"], -100000, 100000) ||
              !finite(p["y"], -100000, 100000)
            )
              throw new Error("Invalid curve control.");
          }
        }
      }
    }
    if (
      !["rectangle", "ellipse", "path", "text", "image"].includes(
        String(layer["kind"]),
      ) ||
      !BLENDS.includes(layer["blend"] as Blend) ||
      typeof layer["visible"] !== "boolean" ||
      typeof layer["locked"] !== "boolean"
    )
      throw new Error("Unsupported layer.");
    for (const key of ["x", "y", "rotation"])
      if (!finite(layer[key], -100000, 100000))
        throw new Error("Invalid layer transform.");
    for (const key of ["width", "height"])
      if (!finite(layer[key], 1, 16384)) throw new Error("Invalid layer size.");
    if (
      !finite(layer["opacity"], 0, 1) ||
      !finite(layer["strokeWidth"], 0, 200) ||
      !finite(layer["fontSize"], 1, 500) ||
      !paint(layer["fill"], value["version"]) ||
      !paint(layer["stroke"], value["version"])
    )
      throw new Error("Invalid layer style.");
    if (
      typeof layer["text"] !== "string" ||
      layer["text"].length > 2000 ||
      typeof layer["source"] !== "string" ||
      (layer["source"] !== "" &&
        !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(
          layer["source"],
        ))
    )
      throw new Error("Invalid layer content.");
    if (
      !Array.isArray(layer["points"]) ||
      layer["points"].length > 20000 ||
      !layer["points"].every(
        (p) =>
          record(p) &&
          finite(p["x"], -100000, 100000) &&
          finite(p["y"], -100000, 100000),
      )
    )
      throw new Error("Invalid path.");
    const a = layer["adjustments"];
    if (
      !record(a) ||
      !finite(a["brightness"], 0, 200) ||
      !finite(a["contrast"], 0, 200) ||
      !finite(a["saturation"], 0, 200) ||
      !finite(a["blur"], 0, 30)
    )
      throw new Error("Invalid image adjustment.");
  }
  return { ...value, version: 2 } as unknown as StudioDocument;
}
function escapeXml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
function svgPaint(property: "fill" | "stroke", value: string): string {
  if (/^#[0-9a-f]{8}$/i.test(value))
    return `${property}="${value.slice(0, 7)}" ${property}-opacity="${Number.parseInt(value.slice(7), 16) / 255}"`;
  return `${property}="${value}"`;
}
function svgStroke(layer: Layer, width = layer.strokeWidth) {
  const style = layer.strokeStyle ?? defaultStrokeStyle;
  return `${svgPaint("stroke", layer.stroke)} stroke-width="${width}" stroke-linecap="${style.cap}" stroke-linejoin="${style.join}" stroke-miterlimit="10"`;
}
function svgAlignedStroke(layer: Layer, shape: (style: string) => string, index: number): string {
  if (layer.stroke === "none" || layer.strokeWidth <= 0) return "";
  const alignment = layer.strokeStyle?.alignment ?? "center";
  if (alignment === "center") return shape(`fill="none" ${svgStroke(layer)}`);
  const id = `stroke-region-${index}`;
  const stroke = shape(`fill="none" ${svgStroke(layer, layer.strokeWidth * 2)}`);
  if (alignment === "inside")
    return `<defs><clipPath id="${id}" clipPathUnits="userSpaceOnUse">${shape('fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" stroke="none"')}</clipPath></defs><g clip-path="url(#${id})">${stroke}</g>`;
  const bounds = strokeBounds(layer);
  return `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" style="mask-type:luminance"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>${shape('fill="#000000" fill-rule="evenodd" stroke="none"')}</mask></defs><g mask="url(#${id})">${stroke}</g>`;
}
export function svgExport(doc: StudioDocument, measure?: TextMeasurement): string {
  const shapes = doc.layers
    .filter((l) => l.visible && !l.guide)
    .map((l, layerIndex) => {
      const style = `${svgPaint("fill", l.kind === "path" && !l.curves?.some((p) => p.closed) ? "none" : l.fill)} ${svgStroke(l)}`;
      let content = "";
      if (l.kind === "rectangle")
        content = `<rect width="${l.width}" height="${l.height}" ${style}/>`;
      if (l.kind === "ellipse")
        content = `<ellipse cx="${l.width / 2}" cy="${l.height / 2}" rx="${l.width / 2}" ry="${l.height / 2}" ${style}/>`;
      if (["rectangle", "ellipse"].includes(l.kind) && l.strokeStyle?.alignment && l.strokeStyle.alignment !== "center") {
        const shape = (attributes: string) => l.kind === "rectangle"
          ? `<rect width="${l.width}" height="${l.height}" ${attributes}/>`
          : `<ellipse cx="${l.width / 2}" cy="${l.height / 2}" rx="${l.width / 2}" ry="${l.height / 2}" ${attributes}/>`;
        content = shape(`${svgPaint("fill", l.fill)} stroke="none"`) + svgAlignedStroke(l, shape, layerIndex);
      }
      if (l.curves) {
        const closed = l.curves.filter((path) => path.closed);
        content =
          (closed.length
            ? `<path d="${curveSvg(closed)}" ${svgPaint("fill", l.fill)} fill-rule="evenodd" stroke="none"/>`
            : "") +
          (l.strokeStyle?.alignment && l.strokeStyle.alignment !== "center"
            ? (closed.length ? svgAlignedStroke(l, (attributes) => `<path d="${curveSvg(closed)}" ${attributes}/>`, layerIndex) : "") +
              `<path d="${curveSvg(l.curves.filter((path) => !path.closed))}" fill="none" ${svgStroke(l)}/>`
            : `<path d="${curveSvg(l.curves)}" fill="none" ${svgStroke(l)}/>`);
      } else if (l.kind === "path")
        content = `<polyline points="${l.points.map((p) => `${p.x},${p.y}`).join(" ")}" ${style}/>`;
      if (l.kind === "text")
        content = `<text y="${l.fontSize}" font-size="${l.fontSize}" font-family="sans-serif" ${style}>${l.text
          .split("\n")
          .map(
            (line, i) =>
              `<tspan x="0" dy="${i ? l.fontSize * 1.2 : 0}">${escapeXml(line)}</tspan>`,
          )
          .join("")}</text>`;
      if (l.kind === "text" && (l.textLayout || l.typography)) {
        const layout = layoutText(l, measure), type = layout.typography;
        const clipId = `text-frame-${layerIndex}`;
        const clipping = l.textLayout ? `<defs><clipPath id="${clipId}"><rect width="${layout.width}" height="${layout.height}"/></clipPath></defs>` : "";
        const glyphs = layout.lines.map((line) => line.glyphs.map((glyph) =>
          `<tspan x="${glyph.x / type.horizontalScale}" y="${line.y / type.verticalScale}">${escapeXml(glyph.text)}</tspan>`).join("")).join("");
        const decoration = type.decoration === "none" || (l.fill === "none" && (l.stroke === "none" || l.strokeWidth <= 0)) ? "" : layout.lines.map((line) => {
          const offset = type.decoration === "underline" ? layout.fontSize * 0.12 : -layout.fontSize * 0.3;
          return `<rect x="${line.x}" y="${line.y + offset * type.verticalScale}" width="${line.width}" height="${Math.max(1, layout.fontSize / 16) * type.verticalScale}" ${svgPaint("fill", l.fill === "none" ? l.stroke : l.fill)}/>`;
        }).join("");
        content = `${clipping}<g${l.textLayout ? ` clip-path="url(#${clipId})"` : ""}><text xml:space="preserve" font-size="${layout.fontSize}" font-family="${escapeXml(type.fontFamily)}" font-weight="${type.fontWeight}" font-style="${type.fontStyle}" transform="scale(${type.horizontalScale} ${type.verticalScale})" ${style}>${glyphs}</text>${decoration}</g>`;
      }
      if (l.kind === "image")
        content = `<image width="${l.width}" height="${l.height}" href="${escapeXml(l.source)}" style="filter:brightness(${l.adjustments.brightness}%) contrast(${l.adjustments.contrast}%) saturate(${l.adjustments.saturation}%) blur(${l.adjustments.blur}px)"/>`;
      const blend = l.blend === "source-over" ? "normal" : l.blend;
      return `<g transform="translate(${l.x} ${l.y}) rotate(${l.rotation} ${l.width / 2} ${l.height / 2})${l.skewX ? ` translate(${l.width / 2} ${l.height / 2}) skewX(${l.skewX}) translate(${-l.width / 2} ${-l.height / 2})` : ""}${l.flipX || l.flipY ? ` translate(${l.flipX ? l.width : 0} ${l.flipY ? l.height : 0}) scale(${l.flipX ? -1 : 1} ${l.flipY ? -1 : 1})` : ""}" opacity="${l.opacity}" style="mix-blend-mode:${blend}">${content}</g>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><rect width="100%" height="100%" fill="${doc.background}"/>${shapes}</svg>`;
}
