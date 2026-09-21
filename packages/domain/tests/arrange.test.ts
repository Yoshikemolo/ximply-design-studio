import { describe, expect, it } from 'vitest';
import { alignLayers, booleanLayers, selectionBounds, type BooleanOperation } from '../src/arrange';
import { hitTest, newLayer, type Layer } from '../src/document';
import { polyline } from '../src/shapes';

const rectangle = (id: string, x: number, y: number, width: number, height: number): Layer => ({ ...newLayer('rectangle', id, { x, y }), width, height, strokeWidth: 0 });
const area = (layer: Layer) => Math.abs(layer.curves!.reduce((total, path) => total + path.nodes.reduce((sum, node, i) => {
  const next = path.nodes[(i + 1) % path.nodes.length].point;
  return sum + node.point.x * next.y - next.x * node.point.y;
}, 0) / 2, 0));

describe('filled vector booleans', () => {
  it.each<[BooleanOperation, number]>([['union', 15000], ['subtract', 5000], ['intersect', 5000], ['exclude', 10000]])('computes %s area for overlapping rectangles', (operation, expected) => {
    const bottom = rectangle('a', 100, 200, 100, 100), top = rectangle('b', 150, 200, 100, 100);
    bottom.fill = '#ff0000'; bottom.opacity = .5;
    const result = booleanLayers([bottom, top], operation, 'result');
    expect(area(result)).toBeCloseTo(expected, 6);
    expect(result.fill).toBe('#ff0000'); expect(result.opacity).toBe(.5);
    expect(result.rotation).toBe(0); expect(result.id).toBe('result');
    expect(bottom.x).toBe(100); expect(bottom.curves).toBeUndefined();
    if (operation === 'subtract') {
      expect(hitTest(result, { x: 125, y: 250 })).toBe(true);
      expect(hitTest(result, { x: 175, y: 250 })).toBe(false);
    }
  });

  it('preserves holes through another operation using even-odd compound fill', () => {
    const outer = rectangle('outer', 100, 100, 200, 200), inner = rectangle('inner', 150, 150, 100, 100);
    const donut = booleanLayers([outer, inner], 'subtract', 'donut');
    expect(donut.curves).toHaveLength(2);
    expect(area(donut)).toBeCloseTo(30000);
    expect(hitTest(donut, { x: 200, y: 200 })).toBe(false);
    const combined = booleanLayers([donut, rectangle('island', 400, 100, 50, 50)], 'union', 'combined');
    expect(area(combined)).toBeCloseTo(32500);
    expect(hitTest(combined, { x: 200, y: 200 })).toBe(false);
    expect(hitTest(combined, { x: 425, y: 125 })).toBe(true);
  });

  it('uses world coordinates for rotated shapes and clears symbol associations', () => {
    const rotated = rectangle('rotated', 100, 100, 100, 40);
    rotated.rotation = 90; rotated.symbolId = 'symbol'; rotated.traceSourceId = 'image';
    const result = booleanLayers([rotated, rectangle('remote', 300, 300, 10, 10)], 'union', 'result');
    expect(area(result)).toBeCloseTo(4100);
    expect(result.x).toBeCloseTo(130); expect(result.y).toBeCloseTo(70);
    expect(hitTest(result, { x: 150, y: 80 })).toBe(true);
    expect(result.symbolId).toBeUndefined(); expect(result.traceSourceId).toBeUndefined();
  });

  it('approximates curved ellipse fill with bounded polygons', () => {
    const ellipse = { ...rectangle('ellipse', 0, 0, 200, 100), kind: 'ellipse' as const };
    const result = booleanLayers([ellipse, rectangle('remote', 300, 300, 10, 10)], 'union', 'result');
    expect(Math.abs(area(result) - (Math.PI * 100 * 50 + 100))).toBeLessThan(20);
    expect(result.curves!.reduce((count, path) => count + path.nodes.length, 0)).toBeLessThan(200);
  });

  it('rejects unsupported objects, open paths, empty results and invalid identifiers', () => {
    const a = rectangle('a', 0, 0, 100, 100), b = rectangle('b', 200, 0, 100, 100);
    expect(() => booleanLayers([a], 'union', 'result')).toThrow(/two objects/);
    expect(() => booleanLayers([a, b], 'union', 'a')).toThrow(/unique/);
    expect(() => booleanLayers([a, { ...b, kind: 'text' }], 'union', 'result')).toThrow(/vector shapes/);
    expect(() => booleanLayers([a, { ...b, kind: 'image' }], 'union', 'result')).toThrow(/vector shapes/);
    expect(() => booleanLayers([a, { ...b, kind: 'path', curves: [polyline([{ x: 0, y: 0 }, { x: 10, y: 10 }])] }], 'union', 'result')).toThrow(/closed/);
    expect(() => booleanLayers([a, b], 'intersect', 'result')).toThrow(/no filled area/);
  });

  it('rejects excessive tessellation before allocating geometry', () => {
    const path = polyline(Array.from({ length: 20001 }, (_, i) => ({ x: i, y: i % 2 })), true);
    const a = { ...rectangle('a', 0, 0, 100, 100), kind: 'path' as const, curves: [path] };
    expect(() => booleanLayers([a, rectangle('b', 0, 0, 10, 10)], 'union', 'result')).toThrow(/20,000/);
  });
});

describe('object arrangement', () => {
  it('aligns rotated bounding boxes without changing rotation or input order', () => {
    const a = rectangle('a', 100, 100, 100, 40), b = rectangle('b', 300, 300, 40, 60);
    a.rotation = 90;
    const result = alignLayers([a, b], 'left');
    expect(selectionBounds([result[0]]).x).toBeCloseTo(130);
    expect(selectionBounds([result[1]]).x).toBeCloseTo(130);
    expect(result.map(layer => layer.id)).toEqual(['a', 'b']);
    expect(result[0].rotation).toBe(90); expect(b.x).toBe(300);
  });

  it.each(['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as const)('aligns %s to an explicit artboard reference', mode => {
    const [result] = alignLayers([rectangle('a', 300, 300, 40, 60)], mode, { x: 10, y: 20, width: 200, height: 100 });
    const expected = { left: ['x', 10], centerX: ['x', 90], right: ['x', 170], top: ['y', 20], centerY: ['y', 40], bottom: ['y', 60] } as const;
    const [axis, value] = expected[mode];
    expect(result[axis]).toBe(value);
  });

  it('distributes equal horizontal gaps and preserves extremes and stacking order', () => {
    const a = rectangle('a', 0, 0, 20, 20), b = rectangle('b', 35, 40, 30, 30), c = rectangle('c', 150, 80, 50, 40);
    const result = alignLayers([c, a, b], 'distributeX');
    expect(result.map(layer => layer.id)).toEqual(['c', 'a', 'b']);
    expect(result[0].x).toBe(150); expect(result[1].x).toBe(0); expect(result[2].x).toBe(70);
    expect(result[2].y).toBe(40);
  });

  it('anchors the furthest outside edge when unequal widths overlap', () => {
    const objects = [rectangle('a', 0, 0, 20, 20), rectangle('b', 50, 0, 200, 20), rectangle('c', 100, 0, 20, 20)];
    const result = alignLayers(objects, 'distributeX');
    expect(result[0].x).toBe(0); expect(result[1].x).toBe(50);
    expect(selectionBounds(result)).toEqual(selectionBounds(objects));
    expect(result[2].x).toBe(25);
    expect(() => alignLayers([rectangle('outer', 0, 0, 500, 20), ...objects.slice(1)], 'distributeX')).toThrow(/outer edges/);
  });

  it('distributes vertically and handles empty or insufficient selections', () => {
    const result = alignLayers([rectangle('a', 0, 0, 20, 20), rectangle('b', 0, 35, 30, 30), rectangle('c', 0, 150, 50, 50)], 'distributeY');
    expect(result[1].y).toBe(70);
    expect(selectionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(alignLayers([], 'left')).toEqual([]);
    expect(() => alignLayers(result.slice(0, 2), 'distributeX')).toThrow(/three/);
  });
});
