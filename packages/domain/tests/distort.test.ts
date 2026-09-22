import { describe, expect, it } from 'vitest';
import { Layer, newLayer } from '../src/document';
import { cubic, CurvePath } from '../src/curves';
import { Quad, boxQuad, mapLayers, quadMap, subdivide, worldCurves } from '../src/distort';

const box = { x: 0, y: 0, width: 100, height: 50 };
const trapezoid: Quad = [{ x: 20, y: 0 }, { x: 80, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
const at = (path: CurvePath, segment: number, t: number) => {
  const a = path.nodes[segment], b = path.nodes[(segment + 1) % path.nodes.length];
  return cubic(a.point, a.outgoing, b.incoming, b.point, t);
};

describe('the quadrilateral map', () => {
  it('takes every corner of the box to the corner of the quad', () => {
    const map = quadMap(box, trapezoid);
    boxQuad(box).forEach((corner, i) => {
      expect(map(corner).x).toBeCloseTo(trapezoid[i].x, 9);
      expect(map(corner).y).toBeCloseTo(trapezoid[i].y, 9);
    });
  });

  it('keeps straight lines straight', () => {
    const map = quadMap(box, [{ x: 10, y: 5 }, { x: 90, y: -10 }, { x: 120, y: 70 }, { x: -5, y: 40 }]);
    // Points of the box diagonal land on the line through the mapped ends.
    const a = map({ x: 0, y: 0 }), b = map({ x: 100, y: 50 });
    for (const t of [0.2, 0.5, 0.7]) {
      const p = map({ x: 100 * t, y: 50 * t });
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      expect(Math.abs(cross)).toBeLessThan(1e-6);
    }
  });

  it('is the identity for the box itself', () => {
    const map = quadMap(box, boxQuad(box));
    expect(map({ x: 33, y: 17 }).x).toBeCloseTo(33, 9);
    expect(map({ x: 33, y: 17 }).y).toBeCloseTo(17, 9);
  });
});

describe('subdivision', () => {
  it('keeps the curve where it was, in pieces of equal parameter', () => {
    const path = worldCurves({ ...newLayer('ellipse', 'e', { x: 0, y: 0 }), width: 100, height: 60 })!;
    const split = subdivide(path, 4)[0];
    expect(split.nodes).toHaveLength(path[0].nodes.length * 4);
    for (let s = 0; s < path[0].nodes.length; s++)
      for (let k = 0; k < 4; k++)
        for (const u of [0.25, 0.5, 0.75]) {
          const original = at(path[0], s, (k + u) / 4), piece = at(split, s * 4 + k, u);
          expect(piece.x).toBeCloseTo(original.x, 9);
          expect(piece.y).toBeCloseTo(original.y, 9);
        }
  });
});

describe('distorting objects', () => {
  it('turns a rectangle into a path through the mapped corners', () => {
    const rect: Layer = { ...newLayer('rectangle', 'r', { x: 0, y: 0 }, '#ff0000', '#000000', 3), width: 100, height: 50 };
    const [out] = mapLayers([rect], quadMap(box, trapezoid));
    expect(out.kind).toBe('path');
    expect(out.fill).toBe('#ff0000');
    const corners = worldCurves(out)![0].nodes.filter((_, i) => i % 4 === 0).map((n) => n.point);
    corners.forEach((p, i) => { expect(p.x).toBeCloseTo(trapezoid[i].x, 6); expect(p.y).toBeCloseTo(trapezoid[i].y, 6); });
  });

  it('keeps a distorted curve within half a pixel of the exact map', () => {
    const ellipse: Layer = { ...newLayer('ellipse', 'e', { x: 0, y: 0 }), width: 100, height: 50 };
    const map = quadMap(box, trapezoid);
    const original = worldCurves(ellipse)![0];
    const out = worldCurves(mapLayers([ellipse], map, 8)[0])![0];
    for (let s = 0; s < original.nodes.length; s++)
      for (let k = 0; k < 8; k++)
        for (const u of [0.25, 0.5, 0.75]) {
          const exact = map(at(original, s, (k + u) / 8)), drawn = at(out, s * 8 + k, u);
          expect(Math.hypot(exact.x - drawn.x, exact.y - drawn.y)).toBeLessThan(0.5);
        }
  });

  it('leaves text and pictures as they are', () => {
    const text: Layer = { ...newLayer('text', 't', { x: 0, y: 0 }), text: 'A' };
    expect(mapLayers([text], quadMap(box, trapezoid))[0]).toBe(text);
  });
});
