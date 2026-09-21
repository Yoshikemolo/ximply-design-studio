import { describe, expect, it } from 'vitest';
import type { Point } from '../src/document';
import { Anchor, CurvePath, cubic, flatten } from '../src/curves';
import {
  averagePoints, closeByJoin, cutAtAnchors, deleteAnchor, dragSegment, joinPaths, nearestOnPath,
  rangesNear, redrawPath, removeParts, removeRanges, reversePath,
} from '../src/path-edit';
import { pathDeviation } from '../src/path-fit';

const corner = (x: number, y: number): Anchor => ({ point: { x, y }, incoming: { x, y }, outgoing: { x, y }, smooth: false });
const open = (...points: Array<[number, number]>): CurvePath => ({ nodes: points.map(([x, y]) => corner(x, y)), closed: false });
/** A circle drawn with four smooth anchors, the usual Bezier approximation. */
const circle = (r = 50, c = { x: 100, y: 100 }): CurvePath => {
  const k = 0.5522847498 * r;
  const node = (px: number, py: number, tx: number, ty: number): Anchor => ({
    point: { x: px, y: py }, incoming: { x: px - tx, y: py - ty }, outgoing: { x: px + tx, y: py + ty }, smooth: true,
  });
  return {
    closed: true,
    nodes: [node(c.x + r, c.y, 0, k), node(c.x, c.y + r, -k, 0), node(c.x - r, c.y, 0, -k), node(c.x, c.y - r, k, 0)],
  };
};
const radiusError = (path: CurvePath, r = 50, c = { x: 100, y: 100 }) =>
  Math.max(...flatten(path, 32).map((p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)));

describe('dragging a segment', () => {
  it('moves the grabbed point of a curve exactly with the pointer', () => {
    const a: Anchor = { point: { x: 0, y: 0 }, incoming: { x: 0, y: 0 }, outgoing: { x: 30, y: -40 }, smooth: false };
    const b: Anchor = { point: { x: 100, y: 0 }, incoming: { x: 70, y: -40 }, outgoing: { x: 100, y: 0 }, smooth: false };
    for (const t of [0.25, 0.5, 0.7]) {
      const before = cubic(a.point, a.outgoing, b.incoming, b.point, t);
      const { a: na, b: nb } = dragSegment(a, b, t, { x: 5, y: 12 });
      const after = cubic(na.point, na.outgoing, nb.incoming, nb.point, t);
      expect(after.x).toBeCloseTo(before.x + 5, 6);
      expect(after.y).toBeCloseTo(before.y + 12, 6);
      expect(na.point).toEqual(a.point);
      expect(nb.point).toEqual(b.point);
    }
  });

  it('moves a straight segment whole, anchors included', () => {
    const { a, b } = dragSegment(corner(0, 0), corner(100, 0), 0.5, { x: 0, y: 20 });
    expect(a.point).toEqual({ x: 0, y: 20 });
    expect(b.point).toEqual({ x: 100, y: 20 });
  });

  it('keeps the other handle of a smooth anchor in line', () => {
    const a: Anchor = { point: { x: 0, y: 0 }, incoming: { x: -20, y: 0 }, outgoing: { x: 20, y: 0 }, smooth: true };
    const b: Anchor = { point: { x: 100, y: 0 }, incoming: { x: 80, y: -20 }, outgoing: { x: 100, y: 0 }, smooth: false };
    const { a: na } = dragSegment(a, b, 0.4, { x: 0, y: -30 });
    const out = { x: na.outgoing.x - na.point.x, y: na.outgoing.y - na.point.y };
    const inn = { x: na.incoming.x - na.point.x, y: na.incoming.y - na.point.y };
    expect(out.x * inn.y - out.y * inn.x).toBeCloseTo(0, 6);
    expect(Math.hypot(inn.x, inn.y)).toBeCloseTo(20, 6);
  });
});

describe('deleting an anchor', () => {
  it('keeps the shape of a circle close when one of its anchors goes', () => {
    const result = deleteAnchor(circle(), 1);
    expect(result.nodes).toHaveLength(3);
    expect(result.closed).toBe(true);
    // One cubic cannot trace half a circle exactly, but it must not collapse to a chord.
    expect(radiusError(result)).toBeLessThan(6);
  });

  it('removes a corner between straight segments without curving them', () => {
    const result = deleteAnchor(open([0, 0], [50, 50], [100, 0]), 1);
    expect(result.nodes.map((n) => n.point)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(result.nodes[0].outgoing).toEqual({ x: 0, y: 0 });
  });

  it('shortens an open path when an endpoint goes', () => {
    expect(deleteAnchor(open([0, 0], [10, 0], [20, 0]), 0).nodes.map((n) => n.point.x)).toEqual([10, 20]);
  });
});

describe('joining', () => {
  it('connects two paths with a straight segment between the chosen endpoints', () => {
    const joined = joinPaths(open([0, 0], [10, 0]), false, open([30, 0], [40, 0]), true);
    expect(joined.nodes.map((n) => n.point.x)).toEqual([0, 10, 30, 40]);
    expect(joined.closed).toBe(false);
  });

  it('turns the paths round so the chosen endpoints meet', () => {
    const joined = joinPaths(open([10, 0], [0, 0]), true, open([40, 0], [30, 0]), false);
    expect(joined.nodes.map((n) => n.point.x)).toEqual([0, 10, 30, 40]);
  });

  it('merges endpoints that lie on each other into one anchor, a corner by default', () => {
    const joined = joinPaths(open([0, 0], [10, 0]), false, open([10, 0], [10, 10]), true);
    expect(joined.nodes).toHaveLength(3);
    expect(joined.nodes[1].smooth).toBe(false);
    const smooth = joinPaths(open([0, 0], [10, 0]), false, open([10, 0], [10, 10]), true, 'smooth');
    expect(smooth.nodes[1].smooth).toBe(true);
  });

  it('closes a path by joining its own endpoints', () => {
    const closed = closeByJoin(open([0, 0], [10, 0], [10, 10]));
    expect(closed.closed).toBe(true);
    expect(closed.nodes).toHaveLength(3);
    const coincident = closeByJoin(open([0, 0], [10, 0], [10, 10], [0, 0]));
    expect(coincident.nodes).toHaveLength(3);
  });

  it('reverses a path with its handles swapped', () => {
    const path: CurvePath = { closed: false, nodes: [{ point: { x: 0, y: 0 }, incoming: { x: 0, y: 0 }, outgoing: { x: 5, y: 5 }, smooth: false }, corner(10, 0)] };
    const reversed = reversePath(path);
    expect(reversed.nodes[1].incoming).toEqual({ x: 5, y: 5 });
    expect(pathDeviation(path, reversed)).toBeLessThan(1e-6);
  });
});

describe('averaging', () => {
  const points: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }];
  it('averages along one axis or both, as the dialog offers', () => {
    expect(averagePoints(points, 'horizontal')).toEqual([{ x: 5, y: 0 }, { x: 5, y: 20 }]);
    expect(averagePoints(points, 'vertical')).toEqual([{ x: 0, y: 10 }, { x: 10, y: 10 }]);
    expect(averagePoints(points, 'both')).toEqual([{ x: 5, y: 10 }, { x: 5, y: 10 }]);
  });
});

describe('removing and cutting', () => {
  it('takes an anchor away with the segments on both of its sides', () => {
    const pieces = removeParts(open([0, 0], [10, 0], [20, 0], [30, 0], [40, 0]), [2], []);
    expect(pieces.map((p) => p.nodes.map((n) => n.point.x))).toEqual([[0, 10], [30, 40]]);
  });

  it('opens a closed path where a segment is removed', () => {
    const square: CurvePath = { ...open([0, 0], [10, 0], [10, 10], [0, 10]), closed: true };
    const pieces = removeParts(square, [], [1]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].closed).toBe(false);
    expect(pieces[0].nodes.map((n) => [n.point.x, n.point.y])).toEqual([[10, 10], [0, 10], [0, 0], [10, 0]]);
  });

  it('leaves no lone anchors behind', () => {
    expect(removeParts(open([0, 0], [10, 0], [20, 0]), [1], [])).toEqual([]);
  });

  it('cuts at an anchor into two paths whose endpoints lie on each other', () => {
    const pieces = cutAtAnchors(open([0, 0], [10, 0], [20, 0]), [1]);
    expect(pieces.map((p) => p.nodes.map((n) => n.point.x))).toEqual([[0, 10], [10, 20]]);
  });

  it('opens a closed path cut once, starting and ending at the cut', () => {
    const pieces = cutAtAnchors(circle(), [2]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].nodes[0].point).toEqual(pieces[0].nodes.at(-1)!.point);
    expect(pieces[0].nodes).toHaveLength(5);
  });
});

describe('erasing along a path', () => {
  it('removes the part near the eraser and keeps the rest as curves', () => {
    const c = circle();
    const ranges = rangesNear(c, [{ x: 150, y: 100 }], 15);
    const pieces = removeRanges(c, ranges);
    expect(pieces).toHaveLength(1);
    expect(radiusError(pieces[0])).toBeLessThan(0.5);
    const ends = [pieces[0].nodes[0].point, pieces[0].nodes.at(-1)!.point];
    for (const end of ends) expect(Math.hypot(end.x - 150, end.y - 100)).toBeGreaterThan(12);
  });

  it('splits an open path in two when its middle is erased', () => {
    const pieces = removeRanges(open([0, 0], [100, 0]), [[0.4, 0.6]]);
    // With both handles in, x(t) = 100 (3 (1 - t) t² + t³), so the cut falls at x(0.4) and x(0.6).
    const x = (t: number) => 100 * (3 * (1 - t) * t * t + t ** 3);
    const ends = pieces.map((p) => [p.nodes[0].point.x, p.nodes.at(-1)!.point.x]);
    expect(ends).toHaveLength(2);
    expect(ends[0][0]).toBe(0);
    expect(ends[0][1]).toBeCloseTo(x(0.4), 6);
    expect(ends[1][0]).toBeCloseTo(x(0.6), 6);
    expect(ends[1][1]).toBe(100);
  });

  it('finds the nearest point of a path', () => {
    const near = nearestOnPath(circle(), { x: 100, y: 170 });
    expect(near!.distance).toBeCloseTo(20, 1);
  });
});

describe('redrawing with a freehand stroke', () => {
  const line = () => open([0, 0], [100, 0], [200, 0], [300, 0]);
  const bump = (from: number, to: number, height = -40): CurvePath =>
    open([from, 0], [from + (to - from) / 3, height], [from + (2 * (to - from)) / 3, height], [to, 0]);

  it('replaces what lies between the two points where the stroke meets the path', () => {
    const result = redrawPath(line(), { segment: 0, t: 0.5 }, { segment: 2, t: 0.5 }, bump(50, 250));
    const xs = result.nodes.map((n) => Math.round(n.point.x));
    expect(result.nodes[0].point.x).toBe(0);
    expect(result.nodes.at(-1)!.point.x).toBe(300);
    expect(result.nodes.some((n) => n.point.y < -30)).toBe(true);
    // Nothing of the original survives between the two meeting points.
    expect(result.nodes.filter((n) => n.point.y === 0 && n.point.x > 60 && n.point.x < 240)).toHaveLength(0);
    expect(xs.length).toBeGreaterThan(3);
  });

  it('follows the stroke when it is drawn backwards over the path', () => {
    const result = redrawPath(line(), { segment: 2, t: 0.5 }, { segment: 0, t: 0.5 }, reversePath(bump(50, 250)));
    expect(result.nodes[0].point.x).toBe(0);
    expect(result.nodes.at(-1)!.point.x).toBe(300);
  });

  it('replaces everything past the start when the stroke leaves the path', () => {
    const stroke = open([150, 0], [200, -50], [260, -80]);
    const result = redrawPath(line(), { segment: 1, t: 0.5 }, null, stroke);
    expect(result.nodes[0].point.x).toBe(0);
    expect(result.nodes.at(-1)!.point).toEqual({ x: 260, y: -80 });
  });

  it('keeps a closed path closed when the stroke starts and ends on it', () => {
    const square: CurvePath = { ...open([0, 0], [100, 0], [100, 100], [0, 100]), closed: true };
    const stroke = open([50, 0], [50, -40], [100, -40], [100, 50]);
    const result = redrawPath(square, { segment: 0, t: 0.5 }, { segment: 1, t: 0.5 }, stroke);
    expect(result.closed).toBe(true);
    // The corner at (100, 0) the stroke went round is gone; the far corners stay.
    expect(result.nodes.some((n) => n.point.x === 100 && n.point.y === 0)).toBe(false);
    expect(result.nodes.some((n) => n.point.x === 0 && n.point.y === 100)).toBe(true);
  });

  it('opens a closed path when the stroke ends away from it', () => {
    const square: CurvePath = { ...open([0, 0], [100, 0], [100, 100], [0, 100]), closed: true };
    const result = redrawPath(square, { segment: 0, t: 0.5 }, null, open([50, 0], [50, -60]));
    expect(result.closed).toBe(false);
    expect(result.nodes.at(-1)!.point).toEqual({ x: 50, y: -60 });
  });
});
