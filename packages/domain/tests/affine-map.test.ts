import { describe, expect, it } from 'vitest';
import { Layer, newLayer } from '../src/document';
import { worldPoint } from '../src/curves';
import { about, affineLayers, applyAffine, scaleLinear, shearLinear } from '../src/affine';

const box = (extra: Partial<Layer> = {}): Layer => ({ ...newLayer('rectangle', 'b', { x: 100, y: 100 }, '#000000', '#000000', 2), width: 200, height: 100, ...extra });
const corners = (l: Layer) => [{ x: 0, y: 0 }, { x: l.width, y: 0 }, { x: l.width, y: l.height }, { x: 0, y: l.height }].map((p) => worldPoint(l, p));
/** Every corner of the result must be where the map sends the corner of the original. */
function expectMapped(before: Layer, after: Layer, m: ReturnType<typeof about>) {
  corners(before).map((p) => applyAffine(m, p)).forEach((p, i) => {
    expect(corners(after)[i].x).toBeCloseTo(p.x, 6);
    expect(corners(after)[i].y).toBeCloseTo(p.y, 6);
  });
}

describe('affine maps of layers', () => {
  it('scale non-uniformly about a point', () => {
    const m = about(scaleLinear(0.5, 2), { x: 200, y: 150 });
    const [after] = affineLayers([box()], m);
    expect([after.x, after.y, after.width, after.height]).toEqual([150, 50, 100, 200]);
    expectMapped(box(), after, m);
  });

  it('shear along the horizontal axis as the Shear dialog does, clockwise', () => {
    // 45 degrees about the bottom left: the top edge moves right by the height.
    const m = about(shearLinear(45, 0), { x: 100, y: 200 });
    expect(applyAffine(m, { x: 100, y: 100 }).x).toBeCloseTo(200, 9);
    const [after] = affineLayers([box()], m);
    expect(after.kind).toBe('rectangle');
    expectMapped(box(), after, m);
  });

  it('shear along the vertical and an angled axis, and keep a turned and sheared layer exact', () => {
    const vertical = about(shearLinear(30, 90), { x: 100, y: 100 });
    // The right side goes down for a clockwise slant.
    expect(applyAffine(vertical, { x: 300, y: 100 }).y).toBeGreaterThan(100);
    const turned = box({ rotation: 35, skewX: 20 });
    for (const m of [vertical, about(shearLinear(-20, 30), { x: 0, y: 0 }), about(scaleLinear(-1, 1), { x: 200, y: 150 })])
      expectMapped(turned, affineLayers([turned], m)[0], m);
  });

  it('turns the layer over when the map reflects it', () => {
    const m = about(scaleLinear(1, -1), { x: 200, y: 150 });
    const [after] = affineLayers([box()], m);
    expect(after.flipY).toBe(true);
    expectMapped(box(), after, m);
  });

  it('keeps stroke weights unless strokes are scaled by the square root of the area', () => {
    const m = about(scaleLinear(2, 8), { x: 0, y: 0 });
    expect(affineLayers([box()], m)[0].strokeWidth).toBe(2);
    expect(affineLayers([box()], m, { scaleStrokes: true })[0].strokeWidth).toBeCloseTo(8, 9);
  });

  it('maps the curves of a path with the layer', () => {
    const path: Layer = { ...box(), kind: 'path', curves: [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 200, y: 100 }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) }] };
    const m = about(shearLinear(25, 0), { x: 50, y: 60 });
    const [after] = affineLayers([path], m);
    const end = worldPoint(after, after.curves![0].nodes[1].point);
    const expected = applyAffine(m, worldPoint(path, { x: 200, y: 100 }));
    expect(end.x).toBeCloseTo(expected.x, 6);
    expect(end.y).toBeCloseTo(expected.y, 6);
  });
});
