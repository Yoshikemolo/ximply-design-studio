import { describe, expect, it } from 'vitest';
import { flatten } from '../src/curves';
import { importDxf, parseDxf } from '../src/dxf-import';

/** Builds the group-code text of a drawing from pairs, the way a DXF file is written. */
const dxf = (...pairs: (string | number)[][]) =>
  ['0', 'SECTION', '2', 'ENTITIES', ...pairs.flatMap((pair) => pair.map(String)), '0', 'ENDSEC', '0', 'EOF'].join('\n');
const box = (layer: { x: number; y: number; width: number; height: number }) =>
  ({ x: Math.round(layer.x), y: Math.round(layer.y), width: Math.round(layer.width), height: Math.round(layer.height) });

describe('dxf import', () => {
  it('reads lines and polylines with the drawing mirrored into screen coordinates', () => {
    const result = importDxf(dxf(
      [0, 'LINE'], [8, 'walls'], [10, 0], [20, 0], [11, 100], [21, 50],
      [0, 'LWPOLYLINE'], [8, 'walls'], [70, 1], [10, 0], [20, 0], [10, 40], [20, 0], [10, 40], [20, 30],
    ));
    expect(result.layers).toHaveLength(2);
    const [line, polygon] = result.layers;
    // DXF measures upwards, so a segment to (100, 50) arrives spanning y from -50 to 0.
    expect(box(line)).toEqual({ x: 0, y: -50, width: 100, height: 50 });
    expect(line.curves![0].closed).toBe(false);
    expect(polygon.curves![0].nodes).toHaveLength(3);
    expect(polygon.curves![0].closed).toBe(true);
    expect(box(polygon)).toEqual({ x: 0, y: -30, width: 40, height: 30 });
    expect(result.layers.every((layer) => layer.groupPath?.[0] === 'Imported drawing')).toBe(true);
    expect(line.groupPath?.[1]).toBe('walls');
    expect(line.fill).toBe('none');
  });

  it('reads circles, arcs and ellipses as curves of the size they declare', () => {
    const result = importDxf(dxf(
      [0, 'CIRCLE'], [10, 50], [20, 50], [40, 20],
      [0, 'ARC'], [10, 0], [20, 0], [40, 10], [50, 0], [51, 90],
      [0, 'ELLIPSE'], [10, 0], [20, 0], [11, 20], [21, 0], [40, 0.5],
    ));
    const [circle, arc, ellipse] = result.layers;
    // A circle of radius 20 at (50, 50) spans 30 to 70, mirrored to y from -70 to -30.
    expect(box(circle)).toEqual({ x: 30, y: -70, width: 40, height: 40 });
    for (const point of flatten(circle.curves![0], 24)) {
      expect(Math.hypot(point.x - 20, point.y - 20)).toBeCloseTo(20, 1);
    }
    // A quarter arc from zero to ninety degrees spans one radius in each direction.
    expect(box(arc)).toEqual({ x: 0, y: -10, width: 10, height: 10 });
    expect(arc.curves![0].closed).toBe(false);
    // An ellipse with a major axis of 20 and a ratio of a half is 40 by 20.
    expect(box(ellipse)).toEqual({ x: -20, y: -10, width: 40, height: 20 });
    expect(ellipse.curves![0].closed).toBe(true);
  });

  it('reads text and the fixed index colours', () => {
    const result = importDxf(dxf(
      [0, 'TEXT'], [8, 'notes'], [10, 10], [20, 40], [40, 5], [1, 'Kitchen'], [62, 1],
      [0, 'LINE'], [10, 0], [20, 0], [11, 10], [21, 0], [62, 5],
    ));
    const [text, line] = result.layers;
    expect(text.kind).toBe('text');
    expect(text.text).toBe('Kitchen');
    expect(text.fontSize).toBe(5);
    expect(text.fill).toBe('#ff0000');
    // The baseline sits at the declared point, so the frame starts one size above it.
    expect(text.y).toBe(-45);
    expect(line.stroke).toBe('#0000ff');
  });

  it('reports the entities it cannot represent and refuses what is not a drawing', () => {
    const result = importDxf(dxf(
      [0, 'LINE'], [10, 0], [20, 0], [11, 10], [21, 0],
      [0, 'SPLINE'], [10, 0], [20, 0],
      [0, 'INSERT'], [2, 'block'],
      [0, 'HATCH'], [10, 0], [20, 0],
    ));
    expect(result.layers).toHaveLength(1);
    expect(result.skipped.sort()).toEqual(['hatch', 'insert', 'spline']);
    expect(() => importDxf('not a drawing')).toThrow(/ASCII DXF/);
    expect(() => importDxf(dxf([0, 'LINE'], [10, 0], [20, 0], [11, 1], [21, 1]), {
      limits: { maxCharacters: 10, maxElements: 100, maxNodes: 100 },
    })).toThrow(/size limit/i);
  });

  it('keeps only the entities section and ignores the rest of the file', () => {
    const text = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '0', '20', '0', '11', '5', '21', '5',
      '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const entities = parseDxf(text);
    expect(entities.map((entity) => entity.type)).toEqual(['LINE']);
    expect(importDxf(text).layers).toHaveLength(1);
  });
});
