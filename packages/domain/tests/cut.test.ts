import { describe, expect, it } from 'vitest';
import { anchor, CurvePath } from '../src/curves';
import { cutCrossings, knifeCut, pathArea, scissorCut } from '../src/cut';

/** A 100 by 100 square with straight sides, the shape the oracles are computed from. */
const square = (): CurvePath => ({
  closed: true,
  nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }].map((point) => {
    const node = anchor(point);
    return node;
  }),
});
const straight = (path: CurvePath): CurvePath => ({
  ...path,
  nodes: path.nodes.map((node, index, nodes) => {
    const next = nodes[(index + 1) % nodes.length], previous = nodes[(index - 1 + nodes.length) % nodes.length];
    return {
      ...node,
      outgoing: { x: node.point.x + (next.point.x - node.point.x) / 3, y: node.point.y + (next.point.y - node.point.y) / 3 },
      incoming: { x: node.point.x + (previous.point.x - node.point.x) / 3, y: node.point.y + (previous.point.y - node.point.y) / 3 },
    };
  }),
});

describe('scissors', () => {
  it('opens a closed path into the two arcs between the cuts', () => {
    const pieces = scissorCut(straight(square()), { segment: 0, t: 0.5 }, { segment: 2, t: 0.5 })!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => !piece.closed)).toBe(true);
    // The cuts sit at the middle of the top and bottom sides.
    const ends = pieces.map((piece) => [piece.nodes[0].point, piece.nodes[piece.nodes.length - 1].point]);
    for (const [first, last] of ends) {
      for (const value of [first.x, last.x]) expect(value).toBeCloseTo(50, 6);
      expect([first.y, last.y].sort((a, b) => a - b)).toEqual([0, 100]);
    }
    // Each arc keeps the two corners of its own side.
    expect(pieces[0].nodes).toHaveLength(4);
    expect(pieces[1].nodes).toHaveLength(4);
  });

  it('opens a line into the piece between the cuts and the two ends', () => {
    const line: CurvePath = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 60, y: 0 }].map(anchor) };
    const pieces = scissorCut(straight(line), { segment: 0, t: 0.5 }, { segment: 1, t: 0.5 })!;
    expect(pieces).toHaveLength(3);
    expect(pieces.map((piece) => piece.nodes[0].point.x)).toEqual([0, 15, 45]);
    expect(pieces.map((piece) => piece.nodes[piece.nodes.length - 1].point.x)).toEqual([15, 45, 60]);
    expect(scissorCut(straight(line), { segment: 0, t: 0.5 }, { segment: 0, t: 0.5 })).toBeNull();
  });
});

describe('knife', () => {
  it('divides a closed shape into two closed shapes of the expected areas', () => {
    const shape = straight(square());
    expect(pathArea(shape)).toBeCloseTo(10000, 0);
    const pieces = knifeCut(shape, { x: -20, y: 30 }, { x: 120, y: 30 })!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => piece.closed)).toBe(true);
    // A horizontal cut at y = 30 leaves 100 by 30 and 100 by 70.
    const areas = pieces.map((piece) => pathArea(piece)).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(3000, 0);
    expect(areas[1]).toBeCloseTo(7000, 0);
    expect(areas[0] + areas[1]).toBeCloseTo(pathArea(shape), 0);
  });

  it('cuts along a diagonal and keeps the corners on their own side', () => {
    const pieces = knifeCut(straight(square()), { x: -10, y: -10 }, { x: 110, y: 110 })!;
    const areas = pieces.map((piece) => pathArea(piece));
    for (const area of areas) expect(area).toBeCloseTo(5000, 0);
    const corners = pieces.map((piece) => piece.nodes.map((node) => `${Math.round(node.point.x)},${Math.round(node.point.y)}`));
    expect(corners[0]).toContain('100,0');
    expect(corners[1]).toContain('0,100');
  });

  it('leaves the shape alone when the line does not cross it exactly twice', () => {
    const shape = straight(square());
    expect(knifeCut(shape, { x: 200, y: 200 }, { x: 300, y: 300 })).toBeNull();
    // A line that stops inside the shape crosses once.
    expect(cutCrossings(shape, { x: -20, y: 50 }, { x: 50, y: 50 })).toHaveLength(1);
    expect(knifeCut(shape, { x: -20, y: 50 }, { x: 50, y: 50 })).toBeNull();
    expect(knifeCut({ ...shape, closed: false }, { x: -20, y: 30 }, { x: 120, y: 30 })).toBeNull();
  });

  it('crosses curved sides where the curve actually meets the line', () => {
    // A circle of radius 50 around (50, 50) as four cubic quarters.
    const kappa = 0.5522847498307936;
    const circle: CurvePath = {
      closed: true,
      nodes: [
        { point: { x: 100, y: 50 }, outgoing: { x: 100, y: 50 + 50 * kappa }, incoming: { x: 100, y: 50 - 50 * kappa }, smooth: true },
        { point: { x: 50, y: 100 }, outgoing: { x: 50 - 50 * kappa, y: 100 }, incoming: { x: 50 + 50 * kappa, y: 100 }, smooth: true },
        { point: { x: 0, y: 50 }, outgoing: { x: 0, y: 50 - 50 * kappa }, incoming: { x: 0, y: 50 + 50 * kappa }, smooth: true },
        { point: { x: 50, y: 0 }, outgoing: { x: 50 + 50 * kappa, y: 0 }, incoming: { x: 50 - 50 * kappa, y: 0 }, smooth: true },
      ],
    };
    const pieces = knifeCut(circle, { x: -10, y: 50 }, { x: 110, y: 50 })!;
    expect(pieces).toHaveLength(2);
    // Cutting a circle through its centre gives two halves of the same area.
    const areas = pieces.map((piece) => pathArea(piece, 48));
    expect(areas[0]).toBeCloseTo(areas[1], 0);
    expect(areas[0] + areas[1]).toBeCloseTo(Math.PI * 2500, -1);
  });
});
