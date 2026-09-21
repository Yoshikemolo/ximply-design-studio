import type { Layer, Point } from './document';
import { worldPoint } from './curves';
import { WallProcedure } from './procedural';

export type WallOperation = 'union' | 'subtract' | 'intersect' | 'exclude';
export interface WallAxis { layer: Layer; start: Point; end: Point; thickness: number }
export interface WallResult { source: Layer; start: Point; end: Point }
type Interval = [number, number];
const EPSILON = 1e-6;

/** World-space axis and thickness of a wall layer. */
export function wallAxis(layer: Layer): WallAxis | null {
  const procedure = layer.procedural as WallProcedure | undefined;
  if (procedure?.type !== 'wall') return null;
  return { layer, start: worldPoint(layer, procedure.start), end: worldPoint(layer, procedure.end), thickness: procedure.thickness };
}
/**
 * Parameter range of `axis` whose centreline runs inside the body of `other`,
 * clipped against the four sides of that wall.
 */
export function coveredRange(axis: WallAxis, other: WallAxis): Interval | null {
  const dx = axis.end.x - axis.start.x, dy = axis.end.y - axis.start.y;
  const ox = other.end.x - other.start.x, oy = other.end.y - other.start.y;
  const length = Math.hypot(ox, oy);
  if (!length) return null;
  const u = { x: ox / length, y: oy / length }, n = { x: -u.y, y: u.x };
  const relative = { x: axis.start.x - other.start.x, y: axis.start.y - other.start.y };
  const along = relative.x * u.x + relative.y * u.y, across = relative.x * n.x + relative.y * n.y;
  const alongRate = dx * u.x + dy * u.y, acrossRate = dx * n.x + dy * n.y;
  const half = other.thickness / 2;
  let low = 0, high = 1;
  // Four half-planes of the other wall: along its length and across its thickness.
  for (const [rate, limit] of [[-alongRate, along], [alongRate, length - along], [-acrossRate, across + half], [acrossRate, half - across]] as [number, number][]) {
    if (Math.abs(rate) < EPSILON) { if (limit < 0) return null; continue; }
    const t = limit / rate;
    if (rate < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high + EPSILON) return null;
  }
  return high - low > EPSILON ? [low, high] : null;
}
function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]), result: Interval[] = [];
  for (const interval of sorted) {
    const last = result.at(-1);
    if (last && interval[0] <= last[1] + EPSILON) last[1] = Math.max(last[1], interval[1]);
    else result.push([...interval] as Interval);
  }
  return result;
}
function complement(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  let cursor = 0;
  for (const [from, to] of merge(intervals)) {
    if (from - cursor > EPSILON) result.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (1 - cursor > EPSILON) result.push([cursor, 1]);
  return result;
}
function intersect(intervals: Interval[][]): Interval[] {
  return intervals.reduce<Interval[]>((current, next) => {
    const result: Interval[] = [];
    for (const [a0, a1] of current) for (const [b0, b1] of merge(next)) {
      const from = Math.max(a0, b0), to = Math.min(a1, b1);
      if (to - from > EPSILON) result.push([from, to]);
    }
    return result;
  }, [[0, 1]]);
}
const at = (axis: WallAxis, t: number): Point => ({ x: axis.start.x + (axis.end.x - axis.start.x) * t, y: axis.start.y + (axis.end.y - axis.start.y) * t });
const parallel = (a: WallAxis, b: WallAxis) => {
  const ax = a.end.x - a.start.x, ay = a.end.y - a.start.y, bx = b.end.x - b.start.x, by = b.end.y - b.start.y;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return lengths > 0 && Math.abs(ax * by - ay * bx) / lengths < 0.02;
};
/** Where the other wall's ends project onto this axis, used to extend collinear runs. */
function projectedRange(axis: WallAxis, other: WallAxis): Interval {
  const dx = axis.end.x - axis.start.x, dy = axis.end.y - axis.start.y, squared = dx * dx + dy * dy || 1;
  const project = (point: Point) => ((point.x - axis.start.x) * dx + (point.y - axis.start.y) * dy) / squared;
  const a = project(other.start), b = project(other.end);
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Boolean operations that keep walls as walls: every result is a straight run of one of
 * the operands, so the outcome stays parametric instead of collapsing into a plain outline.
 */
export function wallBoolean(axes: WallAxis[], operation: WallOperation): WallResult[] {
  if (axes.length < 2) return [];
  const [first, ...rest] = axes;
  const segments = (axis: WallAxis, ranges: Interval[]): WallResult[] =>
    ranges.map(([from, to]) => ({ source: axis.layer, start: at(axis, from), end: at(axis, to) }));
  if (operation === 'subtract') {
    const covered = rest.map((other) => coveredRange(first, other)).filter((range): range is Interval => !!range);
    return segments(first, complement(covered));
  }
  if (operation === 'intersect') {
    const ranges = rest.map((other) => { const range = coveredRange(first, other); return range ? [range] : []; });
    return ranges.some((entry) => !entry.length) ? [] : segments(first, intersect(ranges));
  }
  if (operation === 'exclude') {
    return axes.flatMap((axis) => {
      const others = axes.filter((entry) => entry !== axis);
      const covered = others.map((other) => coveredRange(axis, other)).filter((range): range is Interval => !!range);
      return segments(axis, complement(covered));
    });
  }
  // Union: collinear runs merge into one wall, crossing walls stay as their own runs.
  const used = new Set<WallAxis>();
  const results: WallResult[] = [];
  for (const axis of axes) {
    if (used.has(axis)) continue;
    used.add(axis);
    let range: Interval = [0, 1];
    for (const other of axes) {
      if (used.has(other) || !parallel(axis, other) || !coveredRange(axis, other)) continue;
      const projected = projectedRange(axis, other);
      range = [Math.min(range[0], projected[0]), Math.max(range[1], projected[1])];
      used.add(other);
    }
    results.push({ source: axis.layer, start: at(axis, range[0]), end: at(axis, range[1]) });
  }
  return results;
}
