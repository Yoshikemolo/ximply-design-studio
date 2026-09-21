import type { Point } from "./document";
import { Anchor, CurvePath, cubic, flatten } from "./curves";

/**
 * Freehand input turned into Bezier curves, and Bezier paths reduced to fewer anchors.
 *
 * The fitting is the least-squares method Philip Schneider described for digitized
 * curves: each run of points gets one cubic whose end tangents are fixed, the parameter
 * of every point is refined by Newton steps, and a run that cannot be followed within
 * the tolerance is split at its worst point with a tangent that keeps the join smooth.
 */

type Vec = Point;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Vec): Vec => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/** The options the freehand tools share, in the ranges Illustrator gives them. */
export interface FreehandOptions {
  /** How far the pointer must travel, in screen pixels, before a new point counts: 0.5 to 20. */
  fidelity: number;
  /** How much the input is smoothed before it is fitted, in percent: 0 to 100. */
  smoothness: number;
}
export const FIDELITY_RANGE = { min: 0.5, max: 20 } as const;
export const SMOOTHNESS_RANGE = { min: 0, max: 100 } as const;
export const clampFreehand = (options: FreehandOptions): FreehandOptions => ({
  fidelity: Math.min(FIDELITY_RANGE.max, Math.max(FIDELITY_RANGE.min, Number.isFinite(options.fidelity) ? options.fidelity : 2.5)),
  smoothness: Math.min(SMOOTHNESS_RANGE.max, Math.max(SMOOTHNESS_RANGE.min, Number.isFinite(options.smoothness) ? options.smoothness : 0)),
});

/**
 * Drops the points that lie closer than the fidelity to the last point kept, so a small
 * movement is not registered. The last point of the input always stays.
 */
export function registerMovement(points: Point[], fidelity: number): Point[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const kept = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    if (dist(points[i], kept[kept.length - 1]) >= fidelity) kept.push({ ...points[i] });
  }
  const last = points[points.length - 1];
  if (dist(last, kept[kept.length - 1]) > 1e-9) kept.push({ ...last });
  else kept[kept.length - 1] = { ...last };
  return kept;
}

/** Evens the input out; the ends stay where they are unless the run is closed. */
export function smoothPoints(points: Point[], smoothness: number, closed = false): Point[] {
  const passes = Math.round((Math.max(0, Math.min(100, smoothness)) / 100) * 8);
  let current = points.map((p) => ({ ...p }));
  if (current.length < 3) return current;
  for (let pass = 0; pass < passes; pass++) {
    const next = current.map((p) => ({ ...p }));
    for (let i = 0; i < current.length; i++) {
      if (!closed && (i === 0 || i === current.length - 1)) continue;
      const a = current[(i - 1 + current.length) % current.length];
      const b = current[(i + 1) % current.length];
      next[i] = { x: (a.x + 2 * current[i].x + b.x) / 4, y: (a.y + 2 * current[i].y + b.y) / 4 };
    }
    current = next;
  }
  return current;
}

function chordParameters(points: Point[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + dist(points[i], points[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((value) => value / total);
}

const B0 = (u: number) => (1 - u) ** 3;
const B1 = (u: number) => 3 * u * (1 - u) ** 2;
const B2 = (u: number) => 3 * u * u * (1 - u);
const B3 = (u: number) => u ** 3;

type Bezier = [Point, Point, Point, Point];

/** One cubic from p0 to p3 with its end tangents fixed, fitted to the samples by least squares. */
export function fitSingleCubic(
  points: Point[],
  parameters: number[],
  tangentStart: Vec,
  tangentEnd: Vec,
): Bezier {
  const p0 = points[0], p3 = points[points.length - 1];
  const c = [[0, 0], [0, 0]], x = [0, 0];
  for (let i = 0; i < points.length; i++) {
    const u = parameters[i];
    const a1 = scale(tangentStart, B1(u)), a2 = scale(tangentEnd, B2(u));
    c[0][0] += dot(a1, a1);
    c[0][1] += dot(a1, a2);
    c[1][0] = c[0][1];
    c[1][1] += dot(a2, a2);
    const tmp = sub(points[i], add(add(scale(p0, B0(u)), scale(p0, B1(u))), add(scale(p3, B2(u)), scale(p3, B3(u)))));
    x[0] += dot(a1, tmp);
    x[1] += dot(a2, tmp);
  }
  const det = c[0][0] * c[1][1] - c[1][0] * c[0][1];
  let alphaL = det ? (x[0] * c[1][1] - x[1] * c[0][1]) / det : 0;
  let alphaR = det ? (c[0][0] * x[1] - c[1][0] * x[0]) / det : 0;
  const segment = dist(p0, p3);
  const epsilon = 1e-6 * segment;
  if (!det || alphaL < epsilon || alphaR < epsilon) {
    // The least-squares answer is unusable, so the handles take a third of the chord.
    alphaL = alphaR = segment / 3;
  }
  return [p0, add(p0, scale(tangentStart, alphaL)), add(p3, scale(tangentEnd, alphaR)), p3];
}

function bezierAt(b: Bezier, t: number): Point {
  return cubic(b[0], b[1], b[2], b[3], t);
}
function bezierDerivative(b: Bezier, t: number): Vec {
  const u = 1 - t;
  return {
    x: 3 * u * u * (b[1].x - b[0].x) + 6 * u * t * (b[2].x - b[1].x) + 3 * t * t * (b[3].x - b[2].x),
    y: 3 * u * u * (b[1].y - b[0].y) + 6 * u * t * (b[2].y - b[1].y) + 3 * t * t * (b[3].y - b[2].y),
  };
}
function bezierSecond(b: Bezier, t: number): Vec {
  const u = 1 - t;
  return {
    x: 6 * u * (b[2].x - 2 * b[1].x + b[0].x) + 6 * t * (b[3].x - 2 * b[2].x + b[1].x),
    y: 6 * u * (b[2].y - 2 * b[1].y + b[0].y) + 6 * t * (b[3].y - 2 * b[2].y + b[1].y),
  };
}
function newtonStep(b: Bezier, point: Point, u: number): number {
  const d = sub(bezierAt(b, u), point), d1 = bezierDerivative(b, u), d2 = bezierSecond(b, u);
  const numerator = dot(d, d1), denominator = dot(d1, d1) + dot(d, d2);
  if (Math.abs(denominator) < 1e-12) return u;
  const next = u - numerator / denominator;
  return Math.min(1, Math.max(0, next));
}
function maxError(points: Point[], b: Bezier, parameters: number[]): { error: number; index: number } {
  let error = 0, index = Math.floor(points.length / 2);
  for (let i = 1; i < points.length - 1; i++) {
    const d = dist(bezierAt(b, parameters[i]), points[i]);
    if (d > error) { error = d; index = i; }
  }
  return { error, index };
}

function fitRun(points: Point[], tangentStart: Vec, tangentEnd: Vec, tolerance: number, depth = 0): Bezier[] {
  if (points.length === 2) {
    const d = dist(points[0], points[1]) / 3;
    return [[points[0], add(points[0], scale(tangentStart, d)), add(points[1], scale(tangentEnd, d)), points[1]]];
  }
  let parameters = chordParameters(points, 0, points.length - 1);
  let bezier = fitSingleCubic(points, parameters, tangentStart, tangentEnd);
  let { error, index } = maxError(points, bezier, parameters);
  if (error <= tolerance) return [bezier];
  if (error <= tolerance * 4) {
    for (let iteration = 0; iteration < 12; iteration++) {
      parameters = parameters.map((u, i) => newtonStep(bezier, points[i], u));
      bezier = fitSingleCubic(points, parameters, tangentStart, tangentEnd);
      ({ error, index } = maxError(points, bezier, parameters));
      if (error <= tolerance) return [bezier];
    }
  }
  if (depth > 40) return [bezier];
  index = Math.max(1, Math.min(points.length - 2, index));
  const centre = unit(sub(points[index - 1], points[index + 1]));
  const safeCentre = len(centre) ? centre : unit(sub(points[index - 1], points[index]));
  return [
    ...fitRun(points.slice(0, index + 1), tangentStart, safeCentre, tolerance, depth + 1),
    ...fitRun(points.slice(index), scale(safeCentre, -1), tangentEnd, tolerance, depth + 1),
  ];
}

/** The indices where the input turns sharper than the corner angle, in degrees of turn. */
export function cornerIndices(points: Point[], cornerTurn = 70, reach = 3): number[] {
  const turns = points.map((_, i) => {
    if (i < reach || i >= points.length - reach) return 0;
    const before = unit(sub(points[i], points[i - reach]));
    const after = unit(sub(points[i + reach], points[i]));
    if (!len(before) || !len(after)) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, dot(before, after)))) * 180) / Math.PI;
  });
  // A turn is seen by several samples around it; the corner is where it is sharpest.
  const corners: number[] = [];
  for (let i = reach; i < points.length - reach; i++) {
    if (turns[i] < cornerTurn) continue;
    let peak = true;
    for (let k = Math.max(0, i - reach); k <= Math.min(points.length - 1, i + reach); k++) {
      if (turns[k] > turns[i] || (turns[k] === turns[i] && k < i)) { peak = false; break; }
    }
    if (peak) corners.push(i);
  }
  return corners;
}

/** Whether a closed run turns sharply where it starts, measured across the join. */
function startIsCorner(run: Point[], cornerTurn = 70, reach = 3): boolean {
  if (run.length < 2 * reach + 2) return false;
  const before = unit(sub(run[0], run[run.length - 1 - reach]));
  const after = unit(sub(run[reach], run[0]));
  if (!len(before) || !len(after)) return false;
  return (Math.acos(Math.max(-1, Math.min(1, dot(before, after)))) * 180) / Math.PI >= cornerTurn;
}

function bezierToNodes(beziers: Bezier[], closed: boolean, corners: Set<number>): Anchor[] {
  const nodes: Anchor[] = [];
  beziers.forEach((b, i) => {
    if (i === 0) nodes.push({ point: { ...b[0] }, incoming: { ...b[0] }, outgoing: { ...b[1] }, smooth: false });
    else nodes[nodes.length - 1].outgoing = { ...b[1] };
    nodes.push({ point: { ...b[3] }, incoming: { ...b[2] }, outgoing: { ...b[3] }, smooth: !corners.has(i) });
  });
  if (!nodes.length) return nodes;
  nodes[nodes.length - 1].smooth = false;
  if (closed && nodes.length > 2 && dist(nodes[0].point, nodes[nodes.length - 1].point) < 1e-6) {
    const last = nodes.pop()!;
    nodes[0].incoming = last.incoming;
    nodes[0].smooth = !corners.has(-1);
  }
  return nodes;
}

/**
 * Fits Bezier curves to a run of points with a tolerance in the units of the points.
 * Sharp turns become corner anchors; everything between them is joined smoothly.
 */
export function fitPoints(input: Point[], tolerance: number, closed = false): CurvePath {
  const points = input.filter((p, i) => i === 0 || dist(p, input[i - 1]) > 1e-9);
  if (points.length < 2) return { nodes: points.map((p) => ({ point: { ...p }, incoming: { ...p }, outgoing: { ...p }, smooth: false })), closed: false };
  const run = closed && dist(points[0], points[points.length - 1]) > 1e-6 ? [...points, { ...points[0] }] : points;
  const cuts = [0, ...cornerIndices(run), run.length - 1];
  const beziers: Bezier[] = [];
  const cornerJoins = new Set<number>();
  for (let c = 0; c < cuts.length - 1; c++) {
    const piece = run.slice(cuts[c], cuts[c + 1] + 1);
    if (piece.length < 2) continue;
    const reach = Math.min(3, piece.length - 1);
    const start = unit(sub(piece[reach], piece[0]));
    const end = unit(sub(piece[piece.length - 1 - reach], piece[piece.length - 1]));
    const fitted = fitRun(piece, start, end, Math.max(0.01, tolerance));
    beziers.push(...fitted);
    if (c < cuts.length - 2) cornerJoins.add(beziers.length - 1);
  }
  // A closed run whose start is not a corner joins smoothly back to itself.
  if (closed && startIsCorner(run)) cornerJoins.add(-1);
  const nodes = bezierToNodes(beziers, closed, cornerJoins);
  if (closed && nodes.length > 1 && !cornerJoins.has(-1)) {
    const first = nodes[0];
    const direction = unit(sub(first.outgoing, first.incoming));
    if (len(direction)) {
      const inLength = dist(first.incoming, first.point), outLength = dist(first.outgoing, first.point);
      first.incoming = sub(first.point, scale(direction, inLength));
      first.outgoing = add(first.point, scale(direction, outLength));
      first.smooth = true;
    }
  }
  return { nodes, closed: closed && nodes.length > 2 };
}

/**
 * The freehand pipeline the Pencil, Smooth and Paintbrush tools share: movements under the
 * fidelity are not registered, the input is smoothed by the smoothness, and the result is
 * fitted with a tolerance that grows with both, so a higher value gives a smoother path
 * with fewer anchors. `pixel` is the size of a screen pixel in the units of the points.
 */
export function fitFreehand(points: Point[], options: FreehandOptions, pixel = 1, closed = false): CurvePath {
  const { fidelity, smoothness } = clampFreehand(options);
  const registered = registerMovement(points, fidelity * pixel);
  const smoothed = smoothPoints(registered, smoothness, closed);
  const tolerance = fidelity * pixel * (0.6 + smoothness / 50);
  return fitPoints(smoothed, tolerance, closed);
}

/** Options of Simplify, in the ranges Illustrator gives them. */
export interface SimplifyOptions {
  /** How closely the result follows the original, in percent: 0 to 100. */
  precision: number;
  /** Corners sharper than this angle, in degrees, stay corners: 0 to 180. */
  angleThreshold: number;
  /** Straight lines between the anchors that are kept, instead of curves. */
  straightLines: boolean;
}
export const DEFAULT_SIMPLIFY: SimplifyOptions = { precision: 50, angleThreshold: 0, straightLines: false };

/** The angle at an anchor between the two segments it joins, 180 for a straight run. */
export function anchorAngle(path: CurvePath, index: number): number {
  const n = path.nodes.length;
  const node = path.nodes[index];
  const hasPrev = path.closed || index > 0, hasNext = path.closed || index < n - 1;
  if (!hasPrev || !hasNext) return 0;
  const prev = path.nodes[(index - 1 + n) % n], next = path.nodes[(index + 1) % n];
  const inHandle = dist(node.incoming, node.point) > 1e-6 ? node.incoming : dist(prev.outgoing, node.point) > 1e-6 ? prev.outgoing : prev.point;
  const outHandle = dist(node.outgoing, node.point) > 1e-6 ? node.outgoing : dist(next.incoming, node.point) > 1e-6 ? next.incoming : next.point;
  const a = unit(sub(inHandle, node.point)), b = unit(sub(outHandle, node.point));
  if (!len(a) || !len(b)) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
}
const isCorner = (path: CurvePath, index: number) => !path.nodes[index].smooth && anchorAngle(path, index) < 179;

function sizeOf(path: CurvePath): number {
  const points = path.nodes.flatMap((n) => [n.point]);
  if (!points.length) return 1;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return Math.max(1, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
}

/** The tolerance a precision stands for on a path of a given size. */
export function simplifyTolerance(precision: number, size: number): number {
  const p = Math.max(0, Math.min(100, precision)) / 100;
  return Math.max(0.02, size * 0.04 * (1 - p) ** 2);
}

/**
 * Removes anchors without changing the shape more than the precision allows. Endpoints
 * and corners are kept; with an angle threshold, only corners sharper than it are.
 */
export function simplifyPath(path: CurvePath, options: SimplifyOptions = DEFAULT_SIMPLIFY): CurvePath {
  const n = path.nodes.length;
  if (n < 3) return structuredClone(path);
  const keep = new Set<number>();
  if (!path.closed) { keep.add(0); keep.add(n - 1); }
  for (let i = 0; i < n; i++) {
    if (!isCorner(path, i)) continue;
    if (options.angleThreshold <= 0 || anchorAngle(path, i) < options.angleThreshold) keep.add(i);
  }
  const tolerance = simplifyTolerance(options.precision, sizeOf(path));
  if (options.straightLines) {
    // Straight lines join the original anchors; the precision decides which are needed.
    const indices = path.closed ? [...Array(n).keys(), 0] : [...Array(n).keys()];
    const points = indices.map((i) => path.nodes[i].point);
    const chosen = new Set<number>(keep);
    const walk = (from: number, to: number) => {
      let far = -1, farDistance = 0;
      for (let k = from + 1; k < to; k++) {
        const d = distanceToSegment(points[k], points[from], points[to]);
        if (d > farDistance) { farDistance = d; far = k; }
      }
      if (far >= 0 && farDistance > tolerance) { chosen.add(indices[far]); walk(from, far); walk(far, to); }
    };
    const anchors = [...new Set([0, ...[...keep].sort((a, b) => a - b), indices.length - 1])].sort((a, b) => a - b);
    for (let k = 0; k < anchors.length - 1; k++) walk(anchors[k], anchors[k + 1]);
    if (!path.closed) { chosen.add(0); chosen.add(n - 1); }
    if (chosen.size < 2) { chosen.add(0); chosen.add(Math.floor(n / 2)); }
    const nodes = [...chosen].sort((a, b) => a - b).map((i) => {
      const p = path.nodes[i].point;
      return { point: { ...p }, incoming: { ...p }, outgoing: { ...p }, smooth: false };
    });
    return { nodes, closed: path.closed && nodes.length > 2 };
  }
  // Each run between two kept anchors is sampled and fitted again.
  const starts = [...keep].sort((a, b) => a - b);
  const runs: number[][] = [];
  if (path.closed) {
    const ring = starts.length ? starts : [0];
    for (let k = 0; k < ring.length; k++) {
      const from = ring[k], to = ring[(k + 1) % ring.length];
      const run = [from];
      let i = from;
      do { i = (i + 1) % n; run.push(i); } while (i !== to);
      runs.push(run);
    }
  } else {
    for (let k = 0; k < starts.length - 1; k++) {
      const run: number[] = [];
      for (let i = starts[k]; i <= starts[k + 1]; i++) run.push(i);
      runs.push(run);
    }
  }
  const nodes: Anchor[] = [];
  for (const run of runs) {
    const piece: CurvePath = { nodes: run.map((i) => path.nodes[i]), closed: false };
    const samples = flatten(piece, 16);
    const first = path.nodes[run[0]], last = path.nodes[run[run.length - 1]];
    const tangentStart = unit(sub(dist(first.outgoing, first.point) > 1e-6 ? first.outgoing : samples[1], first.point));
    const tangentEnd = unit(sub(dist(last.incoming, last.point) > 1e-6 ? last.incoming : samples[samples.length - 2], last.point));
    const beziers = fitRun(samples, tangentStart, tangentEnd, tolerance);
    beziers.forEach((b, i) => {
      if (i === 0) {
        if (!nodes.length) nodes.push({ point: { ...b[0] }, incoming: { ...first.incoming }, outgoing: { ...b[1] }, smooth: first.smooth });
        else nodes[nodes.length - 1].outgoing = { ...b[1] };
      } else nodes[nodes.length - 1].outgoing = { ...b[1] };
      nodes.push({ point: { ...b[3] }, incoming: { ...b[2] }, outgoing: { ...b[3] }, smooth: i < beziers.length - 1 });
    });
    nodes[nodes.length - 1].smooth = last.smooth && keep.has(run[run.length - 1]) ? last.smooth : nodes[nodes.length - 1].smooth;
    nodes[nodes.length - 1].outgoing = { ...last.outgoing };
  }
  if (path.closed && nodes.length > 1) {
    const end = nodes.pop()!;
    nodes[0].incoming = end.incoming;
  }
  return { nodes, closed: path.closed && nodes.length > 1 };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const d = sub(b, a), l = dot(d, d);
  const t = l ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l)) : 0;
  return dist(p, add(a, scale(d, t)));
}

/** The largest distance between two paths, measured from samples of the first. */
export function pathDeviation(from: CurvePath, to: CurvePath, steps = 24): number {
  const a = flatten(from, steps), b = flatten(to, steps * 4);
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) best = Math.min(best, distanceToSegment(p, b[i - 1], b[i]));
    worst = Math.max(worst, best);
  }
  return worst;
}

/** The options of the Pencil and the Paintbrush, as their option dialogs present them. */
export interface FreehandToolOptions extends FreehandOptions {
  /** Fill new strokes with the current fill. */
  fill: boolean;
  /** Keep the path selected after drawing it. */
  keepSelected: boolean;
  /** Redraw, extend or join a selected path that the stroke starts near. */
  editSelected: boolean;
  /** How near, in screen pixels, a stroke must start to edit a selected path: 2 to 20. */
  within: number;
}
/** Illustrator's defaults for the Pencil. */
export const PENCIL_DEFAULTS: FreehandToolOptions = { fidelity: 2.5, smoothness: 0, fill: false, keepSelected: true, editSelected: true, within: 12 };
/** Illustrator's defaults for the Paintbrush. */
export const PAINTBRUSH_DEFAULTS: FreehandToolOptions = { fidelity: 4, smoothness: 0, fill: false, keepSelected: false, editSelected: true, within: 12 };
/** Illustrator's defaults for the Smooth tool. */
export const SMOOTH_DEFAULTS: FreehandOptions = { fidelity: 2.5, smoothness: 0 };
export const WITHIN_RANGE = { min: 2, max: 20 } as const;

/** Validates stored options, falling back to the defaults for anything missing or out of range. */
export function validFreehandTool(value: unknown, defaults: FreehandToolOptions): FreehandToolOptions {
  const input = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof FreehandToolOptions, unknown>>;
  const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    fidelity: number(input.fidelity, defaults.fidelity, FIDELITY_RANGE.min, FIDELITY_RANGE.max),
    smoothness: number(input.smoothness, defaults.smoothness, SMOOTHNESS_RANGE.min, SMOOTHNESS_RANGE.max),
    fill: flag(input.fill, defaults.fill),
    keepSelected: flag(input.keepSelected, defaults.keepSelected),
    editSelected: flag(input.editSelected, defaults.editSelected),
    within: Math.round(number(input.within, defaults.within, WITHIN_RANGE.min, WITHIN_RANGE.max)),
  };
}
