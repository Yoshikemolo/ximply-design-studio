import { Layer, Point } from "./document";
import { CurvePath, fitCurves, worldPoint } from "./curves";
import { ellipsePath, polyline } from "./shapes";

/**
 * Distortions that are not affine: a selection mapped through a quadrilateral, as the
 * Free Transform tool's free distort and perspective do. Straight lines stay straight, so
 * the map is a projective one, and curves are subdivided before their points are mapped.
 */
export type Quad = [Point, Point, Point, Point];
export interface Box { x: number; y: number; width: number; height: number }

/** The corners of a box, clockwise from the top left. */
export const boxQuad = (b: Box): Quad => [
  { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height },
];

/**
 * The projective map of a box onto a quadrilateral, taking each corner of the box to the
 * corner of the quad in the same place. It is exact at the corners and keeps lines straight.
 */
export function quadMap(box: Box, quad: Quad): (p: Point) => Point {
  // The unit square onto the quad, after Heckbert; corners tl, tr, br, bl.
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, c: number, d: number, e: number, f: number, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y;
  } else {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-12;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  const w = box.width || 1, ht = box.height || 1;
  return (p) => {
    const u = (p.x - box.x) / w, v = (p.y - box.y) / ht, q = g * u + h * v + 1 || 1e-12;
    return { x: (a * u + b * v + c) / q, y: (d * u + e * v + f) / q };
  };
}

/** The outline of a vector object in page coordinates, or null when it has none to give. */
export function worldCurves(layer: Layer): CurvePath[] | null {
  const local = layer.curves
    ? layer.curves
    : layer.kind === "rectangle"
      ? [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: layer.width, y: 0 }, { x: layer.width, y: layer.height }, { x: 0, y: layer.height }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) }]
      : layer.kind === "ellipse"
        ? [ellipsePath(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2)]
        : layer.kind === "path" && layer.points.length
          ? [polyline(layer.points)]
          : null;
  return local?.map((path) => ({
    closed: path.closed,
    nodes: path.nodes.map((n) => ({ point: worldPoint(layer, n.point), incoming: worldPoint(layer, n.incoming), outgoing: worldPoint(layer, n.outgoing), smooth: n.smooth })),
  })) ?? null;
}

/** Splits every segment into `pieces` of equal parameter, keeping the curve the same. */
export function subdivide(paths: CurvePath[], pieces: number): CurvePath[] {
  const n = Math.max(1, Math.round(pieces));
  const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return paths.map((path) => {
    const nodes = path.nodes.map((node) => structuredClone(node));
    const segments = path.closed ? nodes.length : nodes.length - 1;
    const out: typeof nodes = [];
    for (let i = 0; i < nodes.length; i++) {
      const current = nodes[i];
      out.push(current);
      if (i >= segments) continue;
      const next = nodes[(i + 1) % nodes.length];
      let [p0, p1, p2] = [current.point, current.outgoing, next.incoming];
      const p3 = next.point;
      let last = current;
      for (let k = n; k > 1; k--) {
        // De Casteljau at 1/k of what is left gives pieces of equal parameter.
        const t = 1 / k, ab = lerp(p0, p1, t), bc = lerp(p1, p2, t), cd = lerp(p2, p3, t);
        const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), mid = lerp(abc, bcd, t);
        last.outgoing = ab;
        last = { point: mid, incoming: abc, outgoing: bcd, smooth: true };
        out.push(last);
        [p0, p1, p2] = [mid, bcd, cd];
      }
      last.outgoing = p1;
      next.incoming = p2;
    }
    return { closed: path.closed, nodes: out };
  });
}

/** Objects a distortion cannot reshape, by kind: they are left as they are and named. */
export function distortable(layer: Layer): boolean {
  return ["rectangle", "ellipse", "path"].includes(layer.kind) && !layer.guide && !layer.dimension && !layer.procedural && !layer.symbolId;
}

/**
 * Maps the vector objects among `layers` through `map`, each becoming a path with its
 * paint, after its segments are split into `pieces` so curves bend with the map. The
 * others are returned unchanged.
 */
export function mapLayers(layers: Layer[], map: (p: Point) => Point, pieces = 4): Layer[] {
  return layers.map((layer) => {
    const curves = distortable(layer) ? worldCurves(layer) : null;
    if (!curves) return layer;
    const mapped = subdivide(curves, pieces).map((path) => ({
      closed: path.closed,
      nodes: path.nodes.map((n) => ({ point: map(n.point), incoming: map(n.incoming), outgoing: map(n.outgoing), smooth: n.smooth })),
    }));
    const flat: Layer = { ...layer, kind: "path", x: 0, y: 0, width: 1, height: 1, rotation: 0, skewX: 0, flipX: false, flipY: false, points: [] };
    return fitCurves(flat, mapped);
  });
}
