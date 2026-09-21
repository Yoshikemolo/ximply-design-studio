import {
  difference,
  xor,
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import { CurvePath, cubic, flatten } from "./curves";
import { removeRanges, segmentCount } from "./path-edit";
import { polyline } from "./shapes";
import type { Point } from "./document";
/** Filled vector erasure uses polygon subtraction; curved edges are sampled at 24 steps. */
export function eraseFilled(
  paths: CurvePath[],
  point: Point,
  radius: number,
): CurvePath[] {
  const polygons: Polygon[] = paths
    .filter((p) => p.closed && p.nodes.length >= 3)
    .map((p) => [flatten(p).map((q) => [q.x, q.y] as [number, number])]);
  if (!polygons.length) return paths;
  let shape: MultiPolygon = [polygons[0]];
  for (const polygon of polygons.slice(1)) shape = xor(shape, polygon);
  const circle: Polygon = [
    Array.from(
      { length: 49 },
      (_, i) =>
        [
          point.x + radius * Math.cos((i * Math.PI * 2) / 48),
          point.y + radius * Math.sin((i * Math.PI * 2) / 48),
        ] as [number, number],
    ),
  ];
  return difference(shape, circle).flatMap((polygon) =>
    polygon.map((ring) =>
      polyline(
        ring.slice(0, -1).map(([x, y]) => ({ x, y })),
        true,
      ),
    ),
  );
}
export function eraseStroke(
  paths: CurvePath[],
  point: Point,
  radius: number,
): CurvePath[] {
  const result: CurvePath[] = [];
  for (const path of paths) {
    const points = flatten(path),
      segments: Point[][] = [];
    let run: Point[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        fx = a.x - point.x,
        fy = a.y - point.y,
        A = dx * dx + dy * dy,
        B = 2 * (fx * dx + fy * dy),
        C = fx * fx + fy * fy - radius * radius,
        D = B * B - 4 * A * C;
      const cuts = [0, 1];
      if (A && D >= 0)
        for (const t of [
          (-B - Math.sqrt(D)) / (2 * A),
          (-B + Math.sqrt(D)) / (2 * A),
        ])
          if (t > 0 && t < 1) cuts.push(t);
      cuts.sort((u, v) => u - v);
      for (let j = 1; j < cuts.length; j++) {
        const lo = cuts[j - 1],
          hi = cuts[j],
          mid = (lo + hi) / 2;
        if (
          Math.hypot(a.x + dx * mid - point.x, a.y + dy * mid - point.y) >=
          radius
        ) {
          const start = { x: a.x + dx * lo, y: a.y + dy * lo },
            end = { x: a.x + dx * hi, y: a.y + dy * hi };
          if (!run.length) run.push(start);
          run.push(end);
        } else if (run.length) {
          segments.push(run);
          run = [];
        }
      }
    }
    if (run.length) segments.push(run);
    if (segments.length === 1 && segments[0].length === points.length)
      result.push(path);
    else
      result.push(
        ...segments.filter((s) => s.length > 1).map((s) => polyline(s)),
      );
  }
  return result;
}

/**
 * Erases an area of any shape, as the Eraser does with its nib or with a marquee: closed
 * contours lose the area by subtraction, and open ones lose the stretches that fall inside
 * it while the rest keeps its Bezier segments.
 */
export function eraseArea(paths: CurvePath[], area: Point[]): CurvePath[] {
  if (area.length < 3) return paths;
  const closedPaths = paths.filter((p) => p.closed && p.nodes.length >= 3);
  const openPaths = paths.filter((p) => !(p.closed && p.nodes.length >= 3));
  const result: CurvePath[] = [];
  if (closedPaths.length) {
    const polygons: Polygon[] = closedPaths.map((p) => [flatten(p).map((q) => [q.x, q.y] as [number, number])]);
    let shape: MultiPolygon = [polygons[0]];
    for (const polygon of polygons.slice(1)) shape = xor(shape, polygon);
    const cutter: Polygon = [[...area.map((p) => [snap(p.x), snap(p.y)] as [number, number]), [snap(area[0].x), snap(area[0].y)]]];
    const touched = closedPaths.some((p) => flatten(p, 8).some((q) => insideArea(q, area)))
      || area.some((q) => closedPaths.some((p) => insideArea(q, flatten(p, 8))));
    if (!touched) result.push(...closedPaths);
    else {
      try {
        const snapped: MultiPolygon = shape.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [snap(x), snap(y)] as [number, number])));
        result.push(...difference(snapped, cutter).flatMap((polygon) =>
          polygon.map((ring) => polyline(ring.slice(0, -1).map(([x, y]) => ({ x, y })), true)),
        ));
      } catch {
        // The clipping library can fail on nearly coincident edges; the shape then stays as it was.
        result.push(...closedPaths);
      }
    }
  }
  for (const path of openPaths) result.push(...removeRanges(path, rangesInsideArea(path, area)));
  return result;
}
/** The parameter ranges of a path that lie inside an area. */
export function rangesInsideArea(path: CurvePath, area: Point[], steps = 48): Array<[number, number]> {
  const count = segmentCount(path), n = path.nodes.length;
  const ranges: Array<[number, number]> = [];
  for (let segment = 0; segment < count; segment++) {
    const a = path.nodes[segment], b = path.nodes[(segment + 1) % n];
    let open: number | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, p = cubic(a.point, a.outgoing, b.incoming, b.point, t);
      const inside = insideArea(p, area);
      if (inside && open === null) open = Math.max(0, t - 0.5 / steps);
      if (!inside && open !== null) { ranges.push([segment + open, segment + t - 0.5 / steps]); open = null; }
    }
    if (open !== null) ranges.push([segment + open, segment + 1]);
  }
  return ranges;
}
function insideArea(p: Point, area: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const a = area[i], b = area[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Coordinates on a fine grid, which keeps the clipping library away from near-coincident edges. */
const snap = (value: number) => Math.round(value * 1e4) / 1e4;

/** The convex hull of a set of points, which is the area a round or oval nib sweeps in a straight move. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: Point[] = [];
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
