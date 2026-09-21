import { describe, expect, it } from 'vitest';
import type { Point } from '../src/document';
import { CurvePath, flatten } from '../src/curves';
import {
  anchorAngle, fitFreehand, fitPoints, pathDeviation, registerMovement, simplifyPath, simplifyTolerance,
} from '../src/path-fit';

const circle = (r: number, count: number, centre = { x: 100, y: 100 }): Point[] =>
  Array.from({ length: count + 1 }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
  });
/** The farthest a sampled point lies from the true circle. */
const circleError = (path: CurvePath, r: number, centre = { x: 100, y: 100 }) =>
  Math.max(...flatten(path, 32).map((p) => Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - r)));

describe('freehand fitting', () => {
  it('follows a circle within the tolerance with a handful of anchors', () => {
    const path = fitPoints(circle(80, 240).slice(0, -1), 0.5, true);
    expect(path.closed).toBe(true);
    expect(path.nodes.length).toBeLessThanOrEqual(12);
    expect(circleError(path, 80)).toBeLessThan(1);
    expect(path.nodes.every((node) => node.smooth)).toBe(true);
  });

  it('turns a straight stroke into one segment', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: 10 }));
    const path = fitPoints(line, 1);
    expect(path.nodes).toHaveLength(2);
    expect(path.nodes[0].point).toEqual({ x: 0, y: 10 });
    expect(path.nodes[1].point).toEqual({ x: 196, y: 10 });
  });

  it('keeps a sharp turn as a corner anchor where the turn is', () => {
    const l = [
      ...Array.from({ length: 31 }, (_, i) => ({ x: i * 4, y: 0 })),
      ...Array.from({ length: 30 }, (_, i) => ({ x: 120, y: (i + 1) * 4 })),
    ];
    const path = fitPoints(l, 1);
    const corner = path.nodes.find((node, i) => i > 0 && i < path.nodes.length - 1 && !node.smooth);
    expect(corner).toBeDefined();
    expect(Math.hypot(corner!.point.x - 120, corner!.point.y - 0)).toBeLessThan(8);
    const drawn: CurvePath = {
      closed: false,
      nodes: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }].map((p) => ({ point: p, incoming: { ...p }, outgoing: { ...p }, smooth: false })),
    };
    expect(pathDeviation(path, drawn)).toBeLessThan(2);
  });

  it('does not register movements shorter than the fidelity', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }];
    expect(registerMovement(points, 2.5)).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }]);
  });

  it('gives fewer anchors as the fidelity and the smoothness rise', () => {
    // A wavy stroke with a little tremor, as a hand draws it.
    const stroke = Array.from({ length: 400 }, (_, i) => ({
      x: i * 1.5,
      y: 60 + Math.sin(i / 25) * 40 + Math.sin(i * 1.7) * 1.2,
    }));
    const counts = [0.5, 2.5, 10, 20].map((fidelity) => fitFreehand(stroke, { fidelity, smoothness: 0 }).nodes.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeGreaterThan(counts[3]);
    const smooth = [0, 50, 100].map((smoothness) => fitFreehand(stroke, { fidelity: 2.5, smoothness }).nodes.length);
    expect(smooth[2]).toBeLessThanOrEqual(smooth[0]);
  });

  it('keeps the values inside the ranges Illustrator allows', () => {
    const stroke = Array.from({ length: 50 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 5) * 20 }));
    expect(() => fitFreehand(stroke, { fidelity: 999, smoothness: -5 })).not.toThrow();
    expect(fitFreehand(stroke, { fidelity: 999, smoothness: -5 }).nodes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('simplify', () => {
  /** A circle carried by many smooth anchors, as a traced or imported shape often is. */
  const dense = (): CurvePath => {
    const points = circle(80, 64).slice(0, -1);
    const k = (4 / 3) * Math.tan(Math.PI / 128);
    return {
      closed: true,
      nodes: points.map((p) => {
        const a = Math.atan2(p.y - 100, p.x - 100);
        const t = { x: -Math.sin(a) * 80 * k, y: Math.cos(a) * 80 * k };
        return { point: p, incoming: { x: p.x - t.x, y: p.y - t.y }, outgoing: { x: p.x + t.x, y: p.y + t.y }, smooth: true };
      }),
    };
  };

  it('removes anchors while the shape stays inside the precision', () => {
    const original = dense();
    const simplified = simplifyPath(original, { precision: 50, angleThreshold: 0, straightLines: false });
    expect(simplified.nodes.length).toBeLessThan(original.nodes.length / 4);
    const tolerance = simplifyTolerance(50, Math.hypot(160, 160));
    expect(circleError(simplified, 80)).toBeLessThan(tolerance * 1.5);
  });

  it('keeps more anchors at a higher precision', () => {
    const low = simplifyPath(dense(), { precision: 10, angleThreshold: 0, straightLines: false });
    const high = simplifyPath(dense(), { precision: 95, angleThreshold: 0, straightLines: false });
    expect(high.nodes.length).toBeGreaterThanOrEqual(low.nodes.length);
  });

  it('keeps the corners of a square', () => {
    const square: CurvePath = {
      closed: true,
      nodes: [
        { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 },
        { x: 50, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 50 },
      ].map((p) => ({ point: p, incoming: { ...p }, outgoing: { ...p }, smooth: false })),
    };
    const simplified = simplifyPath(square, { precision: 50, angleThreshold: 0, straightLines: false });
    const corners = simplified.nodes.map((n) => n.point).filter((p) => [0, 100].includes(Math.round(p.x)) && [0, 100].includes(Math.round(p.y)));
    expect(corners).toHaveLength(4);
    expect(simplified.nodes.length).toBe(4);
  });

  it('draws straight lines between the anchors it keeps', () => {
    const simplified = simplifyPath(dense(), { precision: 60, angleThreshold: 0, straightLines: true });
    expect(simplified.nodes.every((n) => n.incoming.x === n.point.x && n.outgoing.y === n.point.y)).toBe(true);
    expect(simplified.nodes.length).toBeLessThan(64);
    expect(simplified.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('measures the angle at an anchor', () => {
    const corner: CurvePath = {
      closed: false,
      nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }].map((p) => ({ point: p, incoming: { ...p }, outgoing: { ...p }, smooth: false })),
    };
    expect(anchorAngle(corner, 1)).toBeCloseTo(90, 5);
  });
});
