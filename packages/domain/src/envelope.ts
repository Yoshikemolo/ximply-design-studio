import type { Layer, Point, StudioDocument } from "./document";
import { CurvePath, cubic, worldPoint } from "./curves";
import { Box, mapLayers, worldCurves } from "./distort";

/**
 * Envelopes, as Illustrator's Object > Envelope Distort makes them: objects kept whole and
 * drawn through a mesh. The mesh is a grid of Coons patches, each bounded by four cubic
 * edges, so a warp style, a plain grid and the outline of another object are all the same
 * kind of thing once made, and the Direct Selection and Mesh tools edit any of them.
 */
export type WarpStyle = "arc" | "arcLower" | "arcUpper" | "arch" | "bulge" | "shellLower" | "shellUpper" | "flag" | "wave" | "fish" | "rise" | "fisheye" | "inflate" | "squeeze" | "twist";
export const WARP_STYLES: WarpStyle[] = ["arc", "arcLower", "arcUpper", "arch", "bulge", "shellLower", "shellUpper", "flag", "wave", "fish", "rise", "fisheye", "inflate", "squeeze", "twist"];
export const WARP_LABELS: Record<WarpStyle, string> = {
  arc: "Arc", arcLower: "Arc Lower", arcUpper: "Arc Upper", arch: "Arch", bulge: "Bulge", shellLower: "Shell Lower", shellUpper: "Shell Upper",
  flag: "Flag", wave: "Wave", fish: "Fish", rise: "Rise", fisheye: "Fisheye", inflate: "Inflate", squeeze: "Squeeze", twist: "Twist",
};
export interface WarpSettings {
  style: WarpStyle;
  axis: "horizontal" | "vertical";
  /** Bend and the two distortions, each from -100 to 100 percent. */
  bend: number;
  horizontal: number;
  vertical: number;
}
export const DEFAULT_WARP: WarpSettings = { style: "arc", axis: "horizontal", bend: 50, horizontal: 0, vertical: 0 };

/** A crossing of the mesh and the handles of the edges that leave it towards each neighbour. */
export interface MeshNode { point: Point; left: Point; right: Point; up: Point; down: Point }
/** A grid of rows by columns cells whose lines lie at `us` and `vs`, fractions of the source box from 0 to 1. */
export interface EnvelopeMesh { rows: number; columns: number; us: number[]; vs: number[]; nodes: MeshNode[] }
export interface Envelope {
  contents: Layer[];
  source: Box;
  mesh: EnvelopeMesh;
  origin: "warp" | "grid" | "object";
  warp?: WarpSettings;
  fidelity: number;
  editing: "envelope" | "contents";
  group: string;
}
export const MAX_MESH = 50;
export const MAX_ENVELOPE_CONTENTS = 200;

/**
 * Where a warp style sends a point of the unit box, in coordinates from -1 to 1 with y
 * pointing down. Each named style has a formula of its own; a bend and distortions of zero
 * leave every point where it is. The vertical axis applies the style across the other way.
 */
export function warpPoint(settings: WarpSettings, x0: number, y0: number): Point {
  const vertical = settings.axis === "vertical";
  let x = vertical ? y0 : x0, y = vertical ? -x0 : y0;
  const b = settings.bend / 100;
  const across = 1 - x * x;
  switch (settings.style) {
    case "arc": {
      if (Math.abs(b) > 1e-9) {
        // Bent round a circle: the horizontal centre line becomes an arc of angle b times pi.
        // Heights count half, as for a line of text, so the inner edge keeps its length.
        const radius = 2 / (b * Math.PI), r = radius - y / 2, angle = x / radius;
        [x, y] = [r * Math.sin(angle), (radius - r * Math.cos(angle)) * 2];
      }
      break;
    }
    case "arcLower": y += b * 0.5 * across * (y + 1) / 2; break;
    case "arcUpper": y -= b * 0.5 * across * (1 - y) / 2; break;
    case "arch": y -= b * 0.5 * across; break;
    case "bulge": y += b * 0.5 * across * y; break;
    case "shellLower": y -= b * 0.5 * x * x * (y + 1) / 2; break;
    case "shellUpper": y += b * 0.5 * x * x * (1 - y) / 2; break;
    case "flag": y += b * 0.3 * Math.sin(Math.PI * x); break;
    case "wave": y += b * 0.3 * Math.sin(Math.PI * (x + y / 2)); break;
    case "fish": y *= 1 + b * 0.5 * Math.cos((Math.PI * x) / 2) + b * 0.2 * x; break;
    case "rise": y -= b * 0.5 * ((x + 1) / 2) ** 2 - b * 0.125; break;
    case "fisheye": {
      const f = 1 + b * 0.5 * Math.max(0, 1 - (x * x + y * y) / 2);
      x *= f; y *= f;
      break;
    }
    case "inflate": [x, y] = [x * (1 + b * 0.3 * (1 - y * y)), y * (1 + b * 0.3 * across)]; break;
    case "squeeze": [x, y] = [x * (1 - b * 0.3 * (1 - y * y)), y * (1 + b * 0.3 * across)]; break;
    case "twist": {
      const a = (b * Math.PI) / 2 * Math.max(0, 1 - Math.hypot(x, y) / Math.SQRT2), c = Math.cos(a), s = Math.sin(a);
      [x, y] = [x * c - y * s, x * s + y * c];
      break;
    }
  }
  const dh = settings.horizontal / 100, dv = settings.vertical / 100;
  // Distortion scales one side against the other, as a perspective would.
  [x, y] = [x * (1 + 0.5 * dv * y), y * (1 + 0.5 * dh * x)];
  return vertical ? { x: -y, y: x } : { x, y };
}

/**
 * A mesh sampled from a map of the unit square: nodes where the map sends the crossings and
 * handles a third of the way along each edge, following the map's slope there.
 */
export function meshFromMap(rows: number, columns: number, map: (u: number, v: number) => Point): EnvelopeMesh {
  const nodes: MeshNode[] = [];
  const d = 1e-4;
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= columns; j++) {
      const u = j / columns, v = i / rows, point = map(u, v);
      const du = { a: Math.max(0, u - d), b: Math.min(1, u + d) }, dv = { a: Math.max(0, v - d), b: Math.min(1, v + d) };
      const pu0 = map(du.a, v), pu1 = map(du.b, v), pv0 = map(u, dv.a), pv1 = map(u, dv.b);
      const su = { x: (pu1.x - pu0.x) / (du.b - du.a), y: (pu1.y - pu0.y) / (du.b - du.a) };
      const sv = { x: (pv1.x - pv0.x) / (dv.b - dv.a), y: (pv1.y - pv0.y) / (dv.b - dv.a) };
      const hu = 1 / columns / 3, hv = 1 / rows / 3;
      // A border node has no edge beyond the border, so that handle stays on the node.
      nodes.push({
        point,
        left: j > 0 ? { x: point.x - su.x * hu, y: point.y - su.y * hu } : { ...point }, right: j < columns ? { x: point.x + su.x * hu, y: point.y + su.y * hu } : { ...point },
        up: i > 0 ? { x: point.x - sv.x * hv, y: point.y - sv.y * hv } : { ...point }, down: i < rows ? { x: point.x + sv.x * hv, y: point.y + sv.y * hv } : { ...point },
      });
    }
  return { rows, columns, us: Array.from({ length: columns + 1 }, (_, j) => j / columns), vs: Array.from({ length: rows + 1 }, (_, i) => i / rows), nodes };
}
const inBox = (box: Box) => (u: number, v: number): Point => ({ x: box.x + box.width * u, y: box.y + box.height * v });
/** Make With Mesh: a plain grid over the box, which leaves the contents as they are. */
export const gridMesh = (box: Box, rows: number, columns: number) => meshFromMap(rows, columns, inBox(box));
/** Make With Warp: the style's map sampled on a fine enough grid to follow its curves. */
export function warpMesh(box: Box, settings: WarpSettings, size = 6): EnvelopeMesh {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return meshFromMap(size, size, (u, v) => {
    const p = warpPoint(settings, u * 2 - 1, v * 2 - 1);
    return { x: cx + (p.x * box.width) / 2, y: cy + (p.y * box.height) / 2 };
  });
}

/** A polyline of an outline, dense enough to measure along. */
function flatten(path: CurvePath, steps = 16): Point[] {
  const out: Point[] = [];
  const count = path.closed ? path.nodes.length : path.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i], b = path.nodes[(i + 1) % path.nodes.length];
    for (let k = 0; k < steps; k++) out.push(cubic(a.point, a.outgoing, b.incoming, b.point, k / steps));
  }
  if (!path.closed && path.nodes.length) out.push(path.nodes[path.nodes.length - 1].point);
  return out;
}
/** A point a fraction of the way along a polyline, by length. */
function along(points: Point[], t: number): Point {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const target = Math.max(0, Math.min(1, t)) * lengths[lengths.length - 1];
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < target) i++;
  const span = lengths[i] - lengths[i - 1] || 1, f = (target - lengths[i - 1]) / span;
  return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * f, y: points[i - 1].y + (points[i].y - points[i - 1].y) * f };
}
/**
 * Make With Top Object: the outline of the object split at the points nearest the corners
 * of its bounds into four sides, and the Coons patch they bound sampled as a mesh. The box
 * of the contents is stretched to fill the object.
 */
export function objectMesh(outline: CurvePath, size = 6): EnvelopeMesh | null {
  let ring = flatten(outline);
  if (ring.length < 4) return null;
  // Clockwise on the page, whose y axis points down, the signed area is positive.
  const area = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p.x * q.y - q.x * p.y; }, 0);
  if (area < 0) ring = [...ring].reverse();
  const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  const nearest = (cx: number, cy: number) => ring.reduce((best, p, i) => (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(ring[best].x - cx, ring[best].y - cy) ? i : best), 0);
  const corners = [nearest(box.x, box.y), nearest(box.right, box.y), nearest(box.right, box.bottom), nearest(box.x, box.bottom)];
  if (new Set(corners).size < 4) return null;
  const chain = (from: number, to: number) => { const out: Point[] = []; for (let i = from; ; i = (i + 1) % ring.length) { out.push(ring[i]); if (i === to) break; } return out; };
  const top = chain(corners[0], corners[1]), right = chain(corners[1], corners[2]);
  // The bottom and left sides run from left to right and from top to bottom, against the ring.
  const bottom = [...chain(corners[2], corners[3])].reverse();
  const left = [...chain(corners[3], corners[0])].reverse();
  if ([top, right, bottom, left].some((side) => side.length < 2)) return null;
  const [p00, p10, p11, p01] = [ring[corners[0]], ring[corners[1]], ring[corners[2]], ring[corners[3]]];
  return meshFromMap(size, size, (u, v) => {
    const t = along(top, u), b = along(bottom, u), l = along(left, v), r = along(right, v);
    return {
      x: (1 - v) * t.x + v * b.x + (1 - u) * l.x + u * r.x - ((1 - u) * (1 - v) * p00.x + u * (1 - v) * p10.x + (1 - u) * v * p01.x + u * v * p11.x),
      y: (1 - v) * t.y + v * b.y + (1 - u) * l.y + u * r.y - ((1 - u) * (1 - v) * p00.y + u * (1 - v) * p10.y + (1 - u) * v * p01.y + u * v * p11.y),
    };
  });
}

const node = (mesh: EnvelopeMesh, i: number, j: number) => mesh.nodes[i * (mesh.columns + 1) + j];
/** A point of the mesh at parameters u and v of the whole grid, each from 0 to 1. */
export function meshPoint(mesh: EnvelopeMesh, u: number, v: number): Point {
  // The cell holding the point and where in it the point lies, the lines being anywhere.
  const cell = (lines: number[], x: number) => {
    const c = Math.max(0, Math.min(1, x));
    let k = 0;
    while (k < lines.length - 2 && c > lines[k + 1]) k++;
    return { k, f: (c - lines[k]) / ((lines[k + 1] - lines[k]) || 1) };
  };
  const { k: j, f: s } = cell(mesh.us, u), { k: i, f: t } = cell(mesh.vs, v);
  const a = node(mesh, i, j), b = node(mesh, i, j + 1), c = node(mesh, i + 1, j), d = node(mesh, i + 1, j + 1);
  const top = cubic(a.point, a.right, b.left, b.point, s), bottom = cubic(c.point, c.right, d.left, d.point, s);
  const left = cubic(a.point, a.down, c.up, c.point, t), right = cubic(b.point, b.down, d.up, d.point, t);
  return {
    x: (1 - t) * top.x + t * bottom.x + (1 - s) * left.x + s * right.x - ((1 - s) * (1 - t) * a.point.x + s * (1 - t) * b.point.x + (1 - s) * t * c.point.x + s * t * d.point.x),
    y: (1 - t) * top.y + t * bottom.y + (1 - s) * left.y + s * right.y - ((1 - s) * (1 - t) * a.point.y + s * (1 - t) * b.point.y + (1 - s) * t * c.point.y + s * t * d.point.y),
  };
}
/** The map of the envelope: a point of the source box to where the mesh puts it. */
export const envelopeMap = (mesh: EnvelopeMesh, source: Box) => (p: Point): Point =>
  meshPoint(mesh, (p.x - source.x) / (source.width || 1), (p.y - source.y) / (source.height || 1));

/**
 * A mesh with its lines at other places, sampled from the one it replaces, so the shape is
 * kept: the Mesh tool adds a row and a column, Delete removes them, and Reset With Mesh can
 * keep the envelope's shape.
 */
export function resampleMesh(mesh: EnvelopeMesh, us: number[], vs: number[]): EnvelopeMesh {
  const cols = [...new Set(us.map((u) => Math.round(Math.max(0, Math.min(1, u)) * 1e9) / 1e9))].sort((a, b) => a - b);
  const rows = [...new Set(vs.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1e9) / 1e9))].sort((a, b) => a - b);
  const e = 1e-6;
  // The slope of the mesh at a crossing, taken on the side the handle points to: where an
  // old line crosses, the cells on either side meet at an angle.
  const handle = (u: number, v: number, du: number, dv: number): Point => {
    const point = meshPoint(mesh, u, v), span = du || dv, step = Math.sign(span) * e;
    const q = du ? meshPoint(mesh, u + step, v) : meshPoint(mesh, u, v + step);
    const k = span / step / 3;
    return { x: point.x + (q.x - point.x) * k, y: point.y + (q.y - point.y) * k };
  };
  const nodes: MeshNode[] = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < cols.length; j++) {
      const u = cols[j], v = rows[i], point = meshPoint(mesh, u, v);
      nodes.push({
        point,
        left: j > 0 ? handle(u, v, cols[j - 1] - u, 0) : { ...point }, right: j < cols.length - 1 ? handle(u, v, cols[j + 1] - u, 0) : { ...point },
        up: i > 0 ? handle(u, v, 0, rows[i - 1] - v) : { ...point }, down: i < rows.length - 1 ? handle(u, v, 0, rows[i + 1] - v) : { ...point },
      });
    }
  return { rows: rows.length - 1, columns: cols.length - 1, us: cols, vs: rows, nodes };
}
/** The grid lines of a mesh as fractions of the whole, for resampling. */
export const meshLines = (mesh: EnvelopeMesh) => ({ us: [...mesh.us], vs: [...mesh.vs] });

/** The bounds of the mesh with its handles, which the envelope layer takes as its box. */
export function meshBounds(mesh: EnvelopeMesh): Box {
  const points = mesh.nodes.flatMap((n) => [n.point, n.left, n.right, n.up, n.down]);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}
/** The outline of the mesh as a closed path, the shape Release gives back. */
export function meshOutline(mesh: EnvelopeMesh): CurvePath {
  const nodes: CurvePath["nodes"] = [];
  const at = (i: number, j: number) => node(mesh, i, j);
  const push = (n: MeshNode, incoming: Point, outgoing: Point) => nodes.push({ point: { ...n.point }, incoming: { ...incoming }, outgoing: { ...outgoing }, smooth: false });
  const { rows, columns } = mesh;
  // Clockwise: along the top, down the right, back along the bottom and up the left; each
  // corner arrives by the handle of the side before it.
  for (let j = 0; j < columns; j++) { const n = at(0, j); push(n, j > 0 ? n.left : n.down, n.right); }
  for (let i = 0; i < rows; i++) { const n = at(i, columns); push(n, i > 0 ? n.up : n.left, n.down); }
  for (let j = columns; j > 0; j--) { const n = at(rows, j); push(n, j < columns ? n.right : n.up, n.left); }
  for (let i = rows; i > 0; i--) { const n = at(i, 0); push(n, i < rows ? n.down : n.right, n.up); }
  return { closed: true, nodes };
}

/** How many pieces each segment of the contents is split into for a fidelity from 0 to 100. */
export const fidelityPieces = (fidelity: number) => 2 + Math.round((Math.max(0, Math.min(100, fidelity)) / 100) * 14);
/** The bounds of the contents on the page, the box the mesh is laid over. */
export function contentBox(layers: Layer[]): Box | null {
  const points = layers.flatMap((layer) => (worldCurves(layer) ?? []).flatMap((path) => path.nodes.flatMap((n) => [n.point, n.incoming, n.outgoing])));
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}
/**
 * The contents of an envelope drawn through it, each a path keeping its paint. The mesh is
 * in the envelope layer's own coordinates, so moving, turning or scaling the layer carries
 * the distortion with it.
 */
export function envelopeArtwork(layer: Layer, contents = layer.envelope!.contents): Layer[] {
  const envelope = layer.envelope!;
  const source = envelope.editing === "contents" ? contentBox(contents) ?? envelope.source : envelope.source;
  const map = envelopeMap(envelope.mesh, source);
  return mapLayers(contents, (p) => worldPoint(layer, map(p)), fidelityPieces(envelope.fidelity)).map((content, index) => ({
    ...content, id: `${layer.id}::${index}`, opacity: content.opacity * layer.opacity, groupPath: undefined, regroupPath: undefined,
  }));
}
/** Moves every point of a mesh through a function, handles included. */
export function mapMesh(mesh: EnvelopeMesh, f: (p: Point) => Point): EnvelopeMesh {
  return { ...mesh, us: [...mesh.us], vs: [...mesh.vs], nodes: mesh.nodes.map((n) => ({ point: f(n.point), left: f(n.left), right: f(n.right), up: f(n.up), down: f(n.down) })) };
}
/**
 * Refits the box of an envelope layer to its mesh after the mesh changed, as fitCurves does
 * for a path, keeping the mesh where it is on the page.
 */
export function fitEnvelope(layer: Layer): Layer {
  const envelope = layer.envelope!;
  const b = meshBounds(envelope.mesh);
  const centre = worldPoint(layer, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  return {
    ...layer, x: centre.x - b.width / 2, y: centre.y - b.height / 2, width: b.width, height: b.height,
    envelope: { ...envelope, mesh: mapMesh(envelope.mesh, (p) => ({ x: p.x - b.x, y: p.y - b.y })) },
  };
}

/**
 * The document as it is drawn and exported: every envelope replaced by its distorted
 * contents, and contents being edited drawn through their envelope rather than as they are.
 */
export function materializeEnvelopes(document: StudioDocument): StudioDocument {
  if (!document.layers.some((layer) => layer.envelope)) return document;
  const editing = new Map(document.layers.filter((l) => l.envelope?.editing === "contents").map((l) => [l.envelope!.group, l]));
  const members = (group: string) => document.layers.filter((l) => l.groupPath?.[0] === group && !l.envelope);
  const layers: Layer[] = [];
  for (const layer of document.layers) {
    if (layer.groupPath && editing.has(layer.groupPath[0]) && !layer.envelope) continue;
    if (!layer.envelope) { layers.push(layer); continue; }
    if (!layer.visible) continue;
    layers.push(...envelopeArtwork(layer, layer.envelope.editing === "contents" ? members(layer.envelope.group) : layer.envelope.contents));
  }
  return { ...document, layers };
}

const finite = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const point = (value: unknown) => !!value && typeof value === "object" && finite((value as Point).x, -100000, 100000) && finite((value as Point).y, -100000, 100000);
export function validWarp(value: unknown): value is WarpSettings {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  return Object.keys(w).length === 5 && WARP_STYLES.includes(w["style"] as WarpStyle) && ["horizontal", "vertical"].includes(String(w["axis"])) &&
    ["bend", "horizontal", "vertical"].every((key) => finite(w[key], -100, 100));
}
export function validMesh(value: unknown): value is EnvelopeMesh {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  if (Object.keys(m).length !== 5 || !Number.isInteger(m["rows"]) || !Number.isInteger(m["columns"]) || !finite(m["rows"], 1, MAX_MESH) || !finite(m["columns"], 1, MAX_MESH)) return false;
  // The lines run from 0 to 1 in order, one more than the cells.
  const lines = (value: unknown, count: number) => Array.isArray(value) && value.length === count + 1 && value[0] === 0 && value[count] === 1 &&
    value.every((x, i) => finite(x, 0, 1) && (i === 0 || x > value[i - 1]));
  if (!lines(m["us"], m["columns"] as number) || !lines(m["vs"], m["rows"] as number)) return false;
  const nodes = m["nodes"];
  return Array.isArray(nodes) && nodes.length === ((m["rows"] as number) + 1) * ((m["columns"] as number) + 1) &&
    nodes.every((n) => !!n && typeof n === "object" && Object.keys(n).length === 5 && ["point", "left", "right", "up", "down"].every((key) => point((n as Record<string, unknown>)[key])));
}
/**
 * The envelope field without its contents, which the document's layer checks validate
 * with the other layers. Returns the contents to check, or null when the field is invalid.
 */
export function envelopeShell(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  const keys = Object.keys(e).sort().join(",");
  const expected = e["warp"] === undefined ? "contents,editing,fidelity,group,mesh,origin,source" : "contents,editing,fidelity,group,mesh,origin,source,warp";
  if (keys !== expected || !["warp", "grid", "object"].includes(String(e["origin"])) || (e["warp"] !== undefined && !validWarp(e["warp"])) ||
    (e["origin"] === "warp") !== (e["warp"] !== undefined) || !finite(e["fidelity"], 0, 100) || !["envelope", "contents"].includes(String(e["editing"])) ||
    typeof e["group"] !== "string" || (e["group"] as string).length < 1 || (e["group"] as string).length > 100 || !validMesh(e["mesh"])) return null;
  const s = e["source"] as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object" || Object.keys(s).length !== 4 || !finite(s["x"], -100000, 100000) || !finite(s["y"], -100000, 100000) || !finite(s["width"], 1e-3, 100000) || !finite(s["height"], 1e-3, 100000)) return null;
  const contents = e["contents"];
  if (!Array.isArray(contents) || contents.length > MAX_ENVELOPE_CONTENTS || (e["editing"] === "envelope") !== (contents.length > 0)) return null;
  for (const layer of contents as Record<string, unknown>[])
    if (!layer || typeof layer !== "object" || !["rectangle", "ellipse", "path"].includes(String(layer["kind"])) || ["symbolId", "guide", "dimension", "procedural", "envelope", "groupPath", "regroupPath"].some((key) => layer[key] !== undefined)) return null;
  return contents;
}
