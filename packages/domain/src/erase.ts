import {
  difference,
  xor,
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import { CurvePath, flatten } from "./curves";
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
