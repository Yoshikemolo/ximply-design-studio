import type { Point } from "./document";
import { Anchor, CurvePath, cubic, lerp } from "./curves";
import { fitSingleCubic } from "./path-fit";

/**
 * Edits of Bezier paths that follow the rules of Illustrator's path editing: a segment is
 * reshaped by dragging it, an anchor is removed without collapsing the shape around it,
 * endpoints are joined, anchors are averaged, and a path is cut or broken where anchors or
 * segments are removed. Every function returns new paths and leaves its input alone.
 */

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: Point, b: Point, epsilon = 1e-6) => dist(a, b) <= epsilon;
const copy = (node: Anchor): Anchor => structuredClone(node);
const collapsed = (p: Point): Anchor => ({ point: { ...p }, incoming: { ...p }, outgoing: { ...p }, smooth: false });

/** Whether the segment from a to b is a straight line: neither of its handles is out. */
export function isStraight(a: Anchor, b: Anchor): boolean {
  return same(a.outgoing, a.point) && same(b.incoming, b.point);
}

/** The number of segments of a path. */
export const segmentCount = (path: CurvePath) =>
  path.nodes.length < 2 ? 0 : path.closed ? path.nodes.length : path.nodes.length - 1;

/**
 * Drags a curved segment by the point at parameter t so that point follows the pointer.
 * Only the two handles of the segment change, weighted by how much each one pulls the
 * point, which is how a curve is reshaped by its segment in Illustrator. A straight
 * segment has no handles to pull, so it is moved whole with its two anchors.
 */
export function dragSegment(a: Anchor, b: Anchor, t: number, delta: Point): { a: Anchor; b: Anchor } {
  const na = copy(a), nb = copy(b);
  if (isStraight(a, b)) {
    for (const node of [na, nb]) {
      node.point = { x: node.point.x + delta.x, y: node.point.y + delta.y };
      node.incoming = { x: node.incoming.x + delta.x, y: node.incoming.y + delta.y };
      node.outgoing = { x: node.outgoing.x + delta.x, y: node.outgoing.y + delta.y };
    }
    return { a: na, b: nb };
  }
  const u = Math.min(0.95, Math.max(0.05, t));
  const w1 = 3 * (1 - u) * (1 - u) * u, w2 = 3 * (1 - u) * u * u;
  // The handle nearer the grabbed point moves more; together they move the point by delta.
  const share1 = (1 - u), share2 = u;
  const k = 1 / (w1 * share1 + w2 * share2);
  const d1 = { x: delta.x * share1 * k, y: delta.y * share1 * k };
  const d2 = { x: delta.x * share2 * k, y: delta.y * share2 * k };
  na.outgoing = { x: a.outgoing.x + d1.x, y: a.outgoing.y + d1.y };
  nb.incoming = { x: b.incoming.x + d2.x, y: b.incoming.y + d2.y };
  // A smooth anchor keeps its other handle in line, at its own length.
  if (a.smooth) na.incoming = alignedOpposite(na.point, na.outgoing, a.incoming);
  if (b.smooth) nb.outgoing = alignedOpposite(nb.point, nb.incoming, b.outgoing);
  return { a: na, b: nb };
}
function alignedOpposite(point: Point, handle: Point, other: Point): Point {
  const length = dist(other, point);
  const dx = point.x - handle.x, dy = point.y - handle.y, l = Math.hypot(dx, dy);
  if (!l || !length) return { ...other };
  return { x: point.x + (dx / l) * length, y: point.y + (dy / l) * length };
}

function sampleSegment(a: Anchor, b: Anchor, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => cubic(a.point, a.outgoing, b.incoming, b.point, i / steps));
}
const direction = (from: Point, to: Point) => {
  const d = { x: to.x - from.x, y: to.y - from.y }, l = Math.hypot(d.x, d.y);
  return l ? { x: d.x / l, y: d.y / l } : { x: 0, y: 0 };
};

/**
 * Removes one anchor and joins its neighbours with a single segment that follows the
 * two segments it replaces as closely as one cubic can, so the path does not collapse
 * toward a straight line. The outer handles of the neighbours keep their directions.
 */
export function deleteAnchor(path: CurvePath, index: number): CurvePath {
  const n = path.nodes.length;
  if (n <= 1) return { nodes: [], closed: false };
  const nodes = path.nodes.map(copy);
  const isEnd = !path.closed && (index === 0 || index === n - 1);
  if (isEnd || n === 2) {
    nodes.splice(index, 1);
    if (!path.closed && nodes.length) {
      nodes[0].incoming = { ...nodes[0].point };
      nodes[nodes.length - 1].outgoing = { ...nodes[nodes.length - 1].point };
    }
    return { nodes, closed: path.closed && nodes.length > 2 };
  }
  const prevIndex = (index - 1 + n) % n, nextIndex = (index + 1) % n;
  const prev = nodes[prevIndex], node = nodes[index], next = nodes[nextIndex];
  const straight = isStraight(prev, node) && isStraight(node, next);
  if (straight) {
    prev.outgoing = { ...prev.point };
    next.incoming = { ...next.point };
  } else {
    const samples = [...sampleSegment(prev, node, 16), ...sampleSegment(node, next, 16).slice(1)];
    const lengths = [0];
    for (let i = 1; i < samples.length; i++) lengths.push(lengths[i - 1] + dist(samples[i], samples[i - 1]));
    const total = lengths[lengths.length - 1] || 1;
    const parameters = lengths.map((l) => l / total);
    const start = !same(prev.outgoing, prev.point) ? direction(prev.point, prev.outgoing) : direction(prev.point, samples[1]);
    const end = !same(next.incoming, next.point) ? direction(next.point, next.incoming) : direction(next.point, samples[samples.length - 2]);
    const fitted = fitSingleCubic(samples, parameters, start, end);
    prev.outgoing = fitted[1];
    next.incoming = fitted[2];
  }
  nodes.splice(index, 1);
  return { nodes, closed: path.closed && nodes.length > 2 };
}

/**
 * Joins two open paths at the endpoints given. When the endpoints lie on each other they
 * become one anchor, a corner or a smooth point as asked; otherwise a straight segment
 * connects them. The result runs from the far end of the first path to the far end of
 * the second one.
 */
export function joinPaths(
  first: CurvePath,
  firstAtStart: boolean,
  second: CurvePath,
  secondAtStart: boolean,
  kind: "corner" | "smooth" = "corner",
  /** The Pen joins with the handle it is drawing with; Join always draws a straight segment. */
  keepHandles = false,
): CurvePath {
  const a = firstAtStart ? reversePath(first) : structuredClone(first);
  const b = secondAtStart ? structuredClone(second) : reversePath(second);
  const end = a.nodes[a.nodes.length - 1], start = b.nodes[0];
  if (same(end.point, start.point, 0.5)) {
    const merged: Anchor = { point: { ...end.point }, incoming: { ...end.incoming }, outgoing: { ...start.outgoing }, smooth: kind === "smooth" };
    if (kind === "smooth") smoothen(merged);
    return { nodes: [...a.nodes.slice(0, -1), merged, ...b.nodes.slice(1)], closed: false };
  }
  if (!keepHandles) {
    // The joining segment is straight, so the handles that face it go back in.
    end.outgoing = { ...end.point };
    start.incoming = { ...start.point };
    end.smooth = false;
    start.smooth = false;
  }
  return { nodes: [...a.nodes, ...b.nodes], closed: false };
}

/** Closes an open path by joining its own two endpoints. */
export function closeByJoin(path: CurvePath, kind: "corner" | "smooth" = "corner"): CurvePath {
  if (path.closed || path.nodes.length < 2) return structuredClone(path);
  const nodes = path.nodes.map(copy);
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (nodes.length > 2 && same(first.point, last.point, 0.5)) {
    first.incoming = { ...last.incoming };
    first.smooth = kind === "smooth";
    if (kind === "smooth") smoothen(first);
    nodes.pop();
    return { nodes, closed: true };
  }
  // The closing segment is straight, so the handles that face it go back in.
  last.outgoing = { ...last.point };
  first.incoming = { ...first.point };
  return { nodes, closed: true };
}

/** Makes both handles of an anchor collinear, each at its own length. */
function smoothen(node: Anchor) {
  const inLength = dist(node.incoming, node.point), outLength = dist(node.outgoing, node.point);
  if (!inLength && !outLength) return;
  const d = inLength && outLength
    ? direction(node.incoming, node.outgoing)
    : outLength ? direction(node.point, node.outgoing) : direction(node.incoming, node.point);
  node.incoming = { x: node.point.x - d.x * inLength, y: node.point.y - d.y * inLength };
  node.outgoing = { x: node.point.x + d.x * outLength, y: node.point.y + d.y * outLength };
}

export function reversePath(path: CurvePath): CurvePath {
  return {
    closed: path.closed,
    nodes: [...path.nodes].reverse().map((node) => ({ ...copy(node), incoming: { ...node.outgoing }, outgoing: { ...node.incoming } })),
  };
}

/** Moves anchors to their common position along one axis or both. */
export function averagePoints(points: Point[], axis: "horizontal" | "vertical" | "both"): Point[] {
  if (!points.length) return [];
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return points.map((p) => ({
    x: axis === "vertical" ? p.x : x,
    y: axis === "horizontal" ? p.y : y,
  }));
}

/** Moves an anchor with its handles, which is what averaging and nudging do. */
export function placeAnchor(node: Anchor, to: Point): Anchor {
  const dx = to.x - node.point.x, dy = to.y - node.point.y;
  return {
    ...node,
    point: { ...to },
    incoming: { x: node.incoming.x + dx, y: node.incoming.y + dy },
    outgoing: { x: node.outgoing.x + dx, y: node.outgoing.y + dy },
  };
}

/**
 * Removes the anchors and segments given and returns what is left, as open paths. An
 * anchor takes the segments on both of its sides with it; a segment removed from a closed
 * path opens it there. A piece reduced to a lone anchor is dropped.
 */
export function removeParts(path: CurvePath, anchors: number[], segments: number[]): CurvePath[] {
  const n = path.nodes.length, count = segmentCount(path);
  const gone = new Set(anchors.filter((i) => i >= 0 && i < n));
  const cut = new Set(segments.filter((i) => i >= 0 && i < count));
  for (const i of gone) {
    if (path.closed || i > 0) cut.add((i - 1 + n) % n);
    if (path.closed || i < n - 1) cut.add(i);
  }
  if (!gone.size && !cut.size) return [structuredClone(path)];
  const kept = (i: number) => !cut.has(i);
  const pieces: CurvePath[] = [];
  if (path.closed) {
    if (![...Array(count).keys()].some((i) => cut.has(i))) return [structuredClone(path)];
    // Walk the ring from just after a removed segment so every run is met whole.
    const startSegment = [...cut][0];
    let run: Anchor[] = [];
    for (let step = 1; step <= count; step++) {
      const segment = (startSegment + step) % count;
      const from = segment, to = (segment + 1) % n;
      if (kept(segment) && !gone.has(from) && !gone.has(to)) {
        if (!run.length) run.push(copy(path.nodes[from]));
        run.push(copy(path.nodes[to]));
      } else if (run.length) { pieces.push(openRun(run)); run = []; }
    }
    if (run.length) pieces.push(openRun(run));
  } else {
    let run: Anchor[] = [];
    for (let segment = 0; segment < count; segment++) {
      const from = segment, to = segment + 1;
      if (kept(segment) && !gone.has(from) && !gone.has(to)) {
        if (!run.length) run.push(copy(path.nodes[from]));
        run.push(copy(path.nodes[to]));
      } else if (run.length) { pieces.push(openRun(run)); run = []; }
    }
    if (run.length) pieces.push(openRun(run));
  }
  return pieces.filter((piece) => piece.nodes.length > 1);
}
function openRun(nodes: Anchor[]): CurvePath {
  nodes[0].incoming = { ...nodes[0].point };
  nodes[nodes.length - 1].outgoing = { ...nodes[nodes.length - 1].point };
  return { nodes, closed: false };
}

/**
 * Cuts a path at the anchors given. Each cut anchor becomes two endpoints on top of each
 * other; a closed path cut once becomes one open path that starts and ends there.
 */
export function cutAtAnchors(path: CurvePath, anchors: number[]): CurvePath[] {
  const n = path.nodes.length;
  const cuts = [...new Set(anchors)].filter((i) => i >= 0 && i < n && (path.closed || (i > 0 && i < n - 1))).sort((a, b) => a - b);
  if (!cuts.length) return [structuredClone(path)];
  const pieces: CurvePath[] = [];
  if (path.closed) {
    for (let k = 0; k < cuts.length; k++) {
      const from = cuts[k], to = cuts[(k + 1) % cuts.length];
      const run: Anchor[] = [copy(path.nodes[from])];
      let i = from;
      do { i = (i + 1) % n; run.push(copy(path.nodes[i])); } while (i !== to);
      pieces.push(openRun(run));
    }
    return pieces;
  }
  let from = 0;
  for (const cut of [...cuts, n - 1]) {
    pieces.push(openRun(path.nodes.slice(from, cut + 1).map(copy)));
    from = cut;
  }
  return pieces.filter((piece) => piece.nodes.length > 1);
}

/**
 * Removes the stretches of a path given as parameter ranges, where a parameter is the
 * index of a segment plus the position along it, and keeps the rest as Bezier segments.
 * This is how the Path Eraser takes a part of a path away without flattening it.
 */
export function removeRanges(path: CurvePath, ranges: Array<[number, number]>): CurvePath[] {
  const count = segmentCount(path);
  if (!count) return [];
  const merged = mergeRanges(ranges.map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(count, Math.max(a, b))] as [number, number]).filter(([a, b]) => b - a > 1e-6));
  if (!merged.length) return [structuredClone(path)];
  const keep: Array<[number, number]> = [];
  if (path.closed) {
    // The kept stretches go round the ring from the end of one removed range to the start of the next.
    for (let k = 0; k < merged.length; k++) {
      const from = merged[k][1], to = merged[(k + 1) % merged.length][0] + (k + 1 === merged.length ? count : 0);
      if (to - from > 1e-6) keep.push([from, to]);
    }
    if (merged.length === 1 && merged[0][0] <= 1e-6 && merged[0][1] >= count - 1e-6) return [];
  } else {
    let cursor = 0;
    for (const [a, b] of merged) {
      if (a - cursor > 1e-6) keep.push([cursor, a]);
      cursor = b;
    }
    if (count - cursor > 1e-6) keep.push([cursor, count]);
  }
  return keep.map(([from, to]) => stretch(path, from, to, count)).filter((piece) => piece.nodes.length > 1);
}
function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], range[1]);
    else out.push([...range] as [number, number]);
  }
  return out;
}
/** The part of a path between two parameters, as an open path of Bezier segments. */
export function stretch(path: CurvePath, from: number, to: number, count = segmentCount(path)): CurvePath {
  const n = path.nodes.length;
  const nodes: Anchor[] = [];
  let position = from;
  while (position < to - 1e-9) {
    const segment = Math.floor(position + 1e-9) % count;
    const base = Math.floor(position + 1e-9);
    const t0 = position - base;
    const end = Math.min(to, base + 1);
    const t1 = end - base;
    const a = path.nodes[segment], b = path.nodes[(segment + 1) % n];
    const piece = subSegment(a, b, t0, t1);
    if (!nodes.length) nodes.push({ point: piece[0], incoming: { ...piece[0] }, outgoing: piece[1], smooth: false });
    else nodes[nodes.length - 1].outgoing = piece[1];
    const whole = Math.abs(t1 - 1) < 1e-9;
    nodes.push({ point: piece[3], incoming: piece[2], outgoing: { ...piece[3] }, smooth: whole && end < to - 1e-9 ? b.smooth : false });
    position = end;
  }
  return { nodes, closed: false };
}
/** The part of one cubic between two parameters, by de Casteljau. */
export function subSegment(a: Anchor, b: Anchor, t0: number, t1: number): [Point, Point, Point, Point] {
  const split = (p: [Point, Point, Point, Point], t: number): [[Point, Point, Point, Point], [Point, Point, Point, Point]] => {
    const ab = lerp(p[0], p[1], t), bc = lerp(p[1], p[2], t), cd = lerp(p[2], p[3], t);
    const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
    return [[p[0], ab, abc, m], [m, bcd, cd, p[3]]];
  };
  let curve: [Point, Point, Point, Point] = [a.point, a.outgoing, b.incoming, b.point];
  if (t1 < 1 - 1e-12) curve = split(curve, t1)[0];
  if (t0 > 1e-12) curve = split(curve, t1 > 1e-12 ? t0 / t1 : 0)[1];
  return curve.map((p) => ({ ...p })) as [Point, Point, Point, Point];
}

/** The parameter ranges of a path that lie within a radius of any of the given points. */
export function rangesNear(path: CurvePath, points: Point[], radius: number, steps = 48): Array<[number, number]> {
  const count = segmentCount(path), n = path.nodes.length;
  const ranges: Array<[number, number]> = [];
  for (let segment = 0; segment < count; segment++) {
    const a = path.nodes[segment], b = path.nodes[(segment + 1) % n];
    let open: number | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, p = cubic(a.point, a.outgoing, b.incoming, b.point, t);
      const near = points.some((q) => dist(p, q) <= radius);
      if (near && open === null) open = Math.max(0, t - 0.5 / steps);
      if (!near && open !== null) { ranges.push([segment + open, segment + t - 0.5 / steps]); open = null; }
    }
    if (open !== null) ranges.push([segment + open, segment + 1]);
  }
  return ranges;
}

/** The nearest point of a path to a given point, with its segment and parameter. */
export function nearestOnPath(path: CurvePath, point: Point, steps = 64): { segment: number; t: number; point: Point; distance: number } | undefined {
  const count = segmentCount(path), n = path.nodes.length;
  let best: { segment: number; t: number; point: Point; distance: number } | undefined;
  for (let segment = 0; segment < count; segment++) {
    const a = path.nodes[segment], b = path.nodes[(segment + 1) % n];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, p = cubic(a.point, a.outgoing, b.incoming, b.point, t), d = dist(p, point);
      if (!best || d < best.distance) best = { segment, t, point: p, distance: d };
    }
    // Refine around the best sample of this segment.
    if (best && best.segment === segment) {
      let lo = Math.max(0, best.t - 1 / steps), hi = Math.min(1, best.t + 1 / steps);
      for (let k = 0; k < 20; k++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        const d1 = dist(cubic(a.point, a.outgoing, b.incoming, b.point, m1), point);
        const d2 = dist(cubic(a.point, a.outgoing, b.incoming, b.point, m2), point);
        if (d1 < d2) hi = m2; else lo = m1;
      }
      const t = (lo + hi) / 2, p = cubic(a.point, a.outgoing, b.incoming, b.point, t), d = dist(p, point);
      if (d < best.distance) best = { segment, t, point: p, distance: d };
    }
  }
  return best;
}

export { collapsed as cornerAnchor };

/** Joins pieces end to start into one path; ends that meet become one anchor. */
export function concatPieces(pieces: CurvePath[], closed = false): CurvePath {
  const nodes: Anchor[] = [];
  for (const piece of pieces.filter((p) => p.nodes.length)) {
    const first = piece.nodes[0];
    const last = nodes[nodes.length - 1];
    if (last && same(last.point, first.point, 1e-6)) {
      last.outgoing = { ...first.outgoing };
      last.smooth = false;
      nodes.push(...piece.nodes.slice(1).map(copy));
    } else nodes.push(...piece.nodes.map(copy));
  }
  if (closed && nodes.length > 2 && same(nodes[0].point, nodes[nodes.length - 1].point, 1e-6)) {
    const end = nodes.pop()!;
    nodes[0].incoming = { ...end.incoming };
    nodes[0].smooth = false;
  }
  return { nodes, closed: closed && nodes.length > 1 };
}

/** Moves the first and last anchors of a stroke onto two points, handles included. */
function pinEnds(stroke: CurvePath, start: Point | null, end: Point | null): CurvePath {
  const result = structuredClone(stroke);
  if (start && result.nodes.length) result.nodes[0] = placeAnchor(result.nodes[0], start);
  if (end && result.nodes.length > 1) result.nodes[result.nodes.length - 1] = placeAnchor(result.nodes[result.nodes.length - 1], end);
  return result;
}

/** A parameter along a path: the index of the segment plus the position along it. */
export interface PathParameter { segment: number; t: number }
export const parameterValue = (p: PathParameter) => p.segment + p.t;
export function pointAtParameter(path: CurvePath, value: number): Point {
  const count = segmentCount(path), n = path.nodes.length;
  if (!count) return { ...path.nodes[0].point };
  const clamped = path.closed ? ((value % count) + count) % count : Math.max(0, Math.min(count, value));
  const segment = Math.min(count - 1, Math.floor(clamped));
  const a = path.nodes[segment], b = path.nodes[(segment + 1) % n];
  return cubic(a.point, a.outgoing, b.incoming, b.point, clamped - segment);
}

/**
 * Redraws part of a path with a freehand stroke, as the Pencil and the Paintbrush do on
 * a selected path. The stroke starts on the path at `from`. When it ends on the path at
 * `to`, it replaces what lies between the two; a closed path keeps whichever way round
 * the stroke did not follow. When it ends away from the path, it replaces everything past
 * its start in the direction it was drawn, which may open a closed path.
 */
export function redrawPath(path: CurvePath, from: PathParameter, to: PathParameter | null, stroke: CurvePath): CurvePath {
  const count = segmentCount(path);
  if (!count || stroke.nodes.length < 2) return structuredClone(path);
  const s = parameterValue(from);
  const startPoint = pointAtParameter(path, s);
  if (path.closed) {
    if (to) {
      const e = parameterValue(to);
      const endPoint = pointAtParameter(path, e);
      const pinned = pinEnds(stroke, startPoint, endPoint);
      const forwardEnd = e >= s ? e : e + count;
      const middle = pinned.nodes[Math.floor(pinned.nodes.length / 2)].point;
      const forward = stretch(path, s, forwardEnd, count), backward = stretch(path, forwardEnd, s + count, count);
      const near = (piece: CurvePath) => Math.min(...piece.nodes.map((node) => dist(node.point, middle)), Infinity);
      if (near(forward) <= near(backward)) return concatPieces([backward, pinned], true);
      return concatPieces([forward, reversePath(pinned)], true);
    }
    const ring = stretch(path, s, s + count, count);
    return concatPieces([ring, pinEnds(stroke, startPoint, null)], false);
  }
  if (to) {
    const e = parameterValue(to);
    const lo = Math.min(s, e), hi = Math.max(s, e);
    const pinned = pinEnds(stroke, startPoint, pointAtParameter(path, e));
    const oriented = s <= e ? pinned : reversePath(pinned);
    return concatPieces([stretch(path, 0, lo, count), oriented, stretch(path, hi, count, count)]);
  }
  const pinned = pinEnds(stroke, startPoint, null);
  const ahead = pointAtParameter(path, Math.min(count, s + 0.01)), behind = pointAtParameter(path, Math.max(0, s - 0.01));
  const tangent = { x: ahead.x - behind.x, y: ahead.y - behind.y };
  const heading = { x: pinned.nodes[Math.min(2, pinned.nodes.length - 1)].point.x - pinned.nodes[0].point.x, y: pinned.nodes[Math.min(2, pinned.nodes.length - 1)].point.y - pinned.nodes[0].point.y };
  if (tangent.x * heading.x + tangent.y * heading.y >= 0) return concatPieces([stretch(path, 0, s, count), pinned]);
  return concatPieces([reversePath(pinned), stretch(path, s, count, count)]);
}

/**
 * Closes a freehand path as the Pencil does with Alt: when it ends on its start the two
 * ends become one anchor, and otherwise the shortest line goes back to the start.
 */
export function closeFreehand(path: CurvePath, tolerance: number): CurvePath {
  if (path.closed || path.nodes.length < 2) return structuredClone(path);
  const first = path.nodes[0], last = path.nodes[path.nodes.length - 1];
  if (path.nodes.length > 2 && dist(first.point, last.point) <= tolerance) {
    const nodes = path.nodes.slice(0, -1).map(copy);
    const shift = { x: first.point.x - last.point.x, y: first.point.y - last.point.y };
    nodes[0].incoming = { x: last.incoming.x + shift.x, y: last.incoming.y + shift.y };
    nodes[0].smooth = false;
    return { nodes, closed: true };
  }
  return closeByJoin(path);
}
