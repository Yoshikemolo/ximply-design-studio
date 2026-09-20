import type { Point } from './document';
import { CurvePath, anchor, cubic, splitSegment } from './curves';

/**
 * Cutting a path in two ways. The scissors open a path at two of its own points, which
 * leaves the pieces open; the knife crosses a closed shape with a straight line, which
 * leaves two closed shapes sharing that line. Both work on the geometry alone.
 */
export interface CutPosition {
  segment: number;
  t: number;
}
const EPSILON = 1e-9;

/** A cut this close to an end of its segment lands on the node itself, which is not split. */
const NODE_TOLERANCE = 1e-6;
/** Splits the path at every position, taking the later ones first so earlier indexes hold. */
export function splitAt(path: CurvePath, positions: CutPosition[]): { path: CurvePath; indexes: number[] } {
  const ordered = [...positions].sort((a, b) => b.segment - a.segment || b.t - a.t);
  let result = path;
  const indexes: number[] = [];
  for (const position of ordered) {
    if (position.t <= NODE_TOLERANCE) {
      indexes.push(position.segment);
      continue;
    }
    if (position.t >= 1 - NODE_TOLERANCE) {
      indexes.push((position.segment + 1) % result.nodes.length);
      continue;
    }
    result = splitSegment(result, position.segment, position.t);
    // The inserted node sits right after the segment that was split.
    indexes.push(position.segment + 1);
    for (let index = 0; index < indexes.length - 1; index++) {
      if (indexes[index] > position.segment) indexes[index]++;
    }
  }
  return { path: result, indexes: indexes.reverse() };
}
/**
 * Opens a path at two of its own points. A closed path becomes the two arcs between the
 * cuts; an open one becomes the piece between them and the two ends that remain.
 */
export function scissorCut(path: CurvePath, first: CutPosition, second: CutPosition): CurvePath[] | null {
  if (path.nodes.length < 2) return null;
  const same = first.segment === second.segment && Math.abs(first.t - second.t) < 1e-6;
  if (same) return null;
  const { path: split, indexes } = splitAt(path, [first, second]);
  const [low, high] = [...indexes].sort((a, b) => a - b);
  const groups = path.closed
    ? [split.nodes.slice(low, high + 1), [...split.nodes.slice(high), ...split.nodes.slice(0, low + 1)]]
    : [split.nodes.slice(0, low + 1), split.nodes.slice(low, high + 1), split.nodes.slice(high)];
  return groups.filter((nodes) => nodes.length > 1).map((nodes) => openEnds({ nodes, closed: false }));
}

/**
 * The ends of an open piece keep only the handles that belong to it; the ones left pointing
 * at the part that was cut away are collapsed, so the piece measures what it draws.
 */
function openEnds(path: CurvePath): CurvePath {
  const nodes = path.nodes.map((node) => ({ ...node, point: { ...node.point }, incoming: { ...node.incoming }, outgoing: { ...node.outgoing } }));
  nodes[0].incoming = { ...nodes[0].point };
  nodes[nodes.length - 1].outgoing = { ...nodes[nodes.length - 1].point };
  return { ...path, nodes };
}
/** Where a straight cut crosses one cubic segment, as parameters of that segment. */
function segmentCrossings(a: Point, b: Point, c: Point, d: Point, from: Point, to: Point, steps = 48): number[] {
  const side = (point: Point) => (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  const within = (point: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const along = ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / (length * length);
    return along >= -EPSILON && along <= 1 + EPSILON;
  };
  const crossings: number[] = [];
  const first = cubic(a, b, c, d, 0);
  let previousSide = side(first);
  // A crossing exactly at the start node belongs to this segment, not to the previous one.
  if (previousSide === 0 && within(first)) crossings.push(0);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps, value = side(cubic(a, b, c, d, t));
    if (value === 0) {
      // The sample sits on the line itself, which a strict sign change would miss.
      if (t < 1 + EPSILON && within(cubic(a, b, c, d, t))) crossings.push(Math.min(t, 1));
    } else if (previousSide * value < 0) {
      // Bisect between the two samples to land on the line itself.
      let low = (step - 1) / steps, high = t;
      for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (low + high) / 2;
        if (side(cubic(a, b, c, d, low)) * side(cubic(a, b, c, d, middle)) <= 0) high = middle;
        else low = middle;
      }
      const crossing = (low + high) / 2;
      if (crossing > EPSILON && crossing < 1 - EPSILON && within(cubic(a, b, c, d, crossing))) crossings.push(crossing);
    }
    previousSide = value;
  }
  return crossings;
}
/** Every place where the straight cut from `from` to `to` crosses the path. */
export function cutCrossings(path: CurvePath, from: Point, to: Point): CutPosition[] {
  const count = path.closed ? path.nodes.length : path.nodes.length - 1;
  const positions: CutPosition[] = [];
  const points: Point[] = [];
  for (let index = 0; index < count; index++) {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length];
    for (const t of segmentCrossings(a.point, a.outgoing, b.incoming, b.point, from, to)) {
      const point = cubic(a.point, a.outgoing, b.incoming, b.point, t);
      // A crossing at a node belongs to both of its segments; it is one crossing.
      if (points.some((seen) => Math.hypot(seen.x - point.x, seen.y - point.y) < 1e-6)) continue;
      points.push(point);
      positions.push({ segment: index, t });
    }
  }
  return positions;
}
/**
 * Divides a closed shape with a straight line into two closed shapes that share the cut.
 * A line that does not cross the shape exactly twice leaves it alone.
 */
export function knifeCut(path: CurvePath, from: Point, to: Point): CurvePath[] | null {
  if (!path.closed || path.nodes.length < 2) return null;
  const crossings = cutCrossings(path, from, to);
  if (crossings.length !== 2) return null;
  const { path: split, indexes } = splitAt(path, crossings);
  const [low, high] = [...indexes].sort((a, b) => a - b);
  const first = split.nodes.slice(low, high + 1);
  const second = [...split.nodes.slice(high), ...split.nodes.slice(0, low + 1)];
  if (first.length < 2 || second.length < 2) return null;
  // Each piece closes along the cut, so the two new sides are straight.
  return [first, second].map((nodes) => {
    const shape = nodes.map((node) => ({ ...node, point: { ...node.point }, incoming: { ...node.incoming }, outgoing: { ...node.outgoing } }));
    const last = shape[shape.length - 1], start = shape[0];
    last.outgoing = { ...last.point };
    start.incoming = { ...start.point };
    // The repeated cut point is the same node once the piece is closed.
    if (Math.hypot(last.point.x - start.point.x, last.point.y - start.point.y) < 1e-6 && shape.length > 2) shape.pop();
    return { nodes: shape, closed: true };
  });
}
/** Area enclosed by a path, used to tell the pieces of a cut apart. */
export function pathArea(path: CurvePath, steps = 24): number {
  const points: Point[] = [];
  const count = path.closed ? path.nodes.length : path.nodes.length - 1;
  for (let index = 0; index < count; index++) {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length];
    for (let step = 0; step < steps; step++) points.push(cubic(a.point, a.outgoing, b.incoming, b.point, step / steps));
  }
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}
export const cutAnchor = anchor;
