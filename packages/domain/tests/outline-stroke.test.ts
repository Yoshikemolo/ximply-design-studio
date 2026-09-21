import { describe, expect, it } from 'vitest';
import { newLayer } from '../src/document';
import { anchor } from '../src/curves';
import { pathArea } from '../src/cut';
import { outlineStroke } from '../src/outline-stroke';

const cap = (value: 'butt' | 'round' | 'square') => ({ cap: value, join: 'round' as const, alignment: 'center' as const });
const line = (width: number, ends: 'butt' | 'round' | 'square' = 'butt') => ({
  ...newLayer('path', 'a', { x: 0, y: 0 }), width: 100, height: 1,
  stroke: '#000000', fill: 'none', strokeWidth: width, strokeStyle: cap(ends),
  curves: [{ closed: false, nodes: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }],
});
const square = (width: number) => ({
  ...newLayer('path', 'b', { x: 0, y: 0 }), width: 100, height: 100,
  stroke: '#000000', fill: 'none', strokeWidth: width, strokeStyle: cap('butt'),
  curves: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }].map(anchor) }],
});

describe('outline stroke', () => {
  it('turns a straight line into the band it paints', () => {
    const curves = outlineStroke(line(10))!;
    expect(curves).toHaveLength(1);
    expect(curves[0].closed).toBe(true);
    const xs = curves[0].nodes.map((node) => node.point.x);
    const ys = curves[0].nodes.map((node) => node.point.y);
    // A hundred long and ten wide, centred on the line, with butt ends.
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(100, 6);
    expect(Math.min(...ys)).toBeCloseTo(-5, 6);
    expect(Math.max(...ys)).toBeCloseTo(5, 6);
    expect(pathArea(curves[0])).toBeCloseTo(1000, 0);
  });

  it('stretches the band for square caps and rounds it for round ones', () => {
    const butt = outlineStroke(line(10))!;
    const squared = outlineStroke(line(10, 'square'))!;
    const rounded = outlineStroke(line(10, 'round'))!;
    // Square caps add half a width at each end, round caps add a half disc.
    expect(pathArea(squared[0])).toBeCloseTo(pathArea(butt[0]) + 100, 0);
    expect(pathArea(rounded[0])).toBeGreaterThan(pathArea(butt[0]));
    expect(pathArea(rounded[0])).toBeLessThan(pathArea(squared[0]));
  });

  it('leaves the hole of a closed contour open, as a ring', () => {
    const curves = outlineStroke(square(10))!;
    // The band of a square is a ring: the outer contour and the inner one.
    expect(curves).toHaveLength(2);
    const areas = curves.map((path) => pathArea(path)).sort((a, b) => b - a);
    // The round joins round the outer corners, so the outer contour is a little under the
    // square of the outer edge; the inner corners stay sharp.
    expect(areas[0]).toBeLessThan(110 * 110);
    expect(areas[0]).toBeGreaterThan(110 * 110 - 4 * 25);
    expect(areas[1]).toBeCloseTo(90 * 90, 0);
    // The band is the four sides at the width of the stroke, less what the rounded
    // corners take away: a little under four thousand.
    expect(areas[0] - areas[1]).toBeGreaterThan(3900);
    expect(areas[0] - areas[1]).toBeLessThan(4000);
  });

  it('refuses a layer with nothing to outline', () => {
    expect(outlineStroke({ ...line(10), stroke: 'none' })).toBeNull();
    expect(outlineStroke({ ...line(0) })).toBeNull();
    expect(outlineStroke({ ...line(10), curves: undefined })).toBeNull();
  });
});
