import { describe, it, expect } from 'vitest';
import { blankDocument, newLayer, parseDocument, svgExport, Layer } from '../src/document';
import { defaultProcedural, generateProcedural, projectionCurves, projectionDash, leafType, DoorProcedure, WindowProcedure } from '../src/procedural';

function opening(patch: Record<string, unknown> = {}): Layer {
  const type = (patch['type'] as 'door' | 'window') ?? 'door';
  const procedural = { ...defaultProcedural(type), ...patch, type } as DoorProcedure | WindowProcedure;
  return generateProcedural({ ...newLayer('path', 'opening', { x: 0, y: 0 }, 'none', '#000000', 2), width: 80, height: 16, procedural });
}
const ys = (layer: Layer, index: number) => layer.curves![index].nodes.map((node) => node.point.y);

describe('door and window leaves', () => {
  it('swings the leaf towards the chosen wall face', () => {
    const front = opening({ side: 'front' }), back = opening({ side: 'back' });
    const leaf = (layer: Layer) => layer.curves!.find((path) => path.nodes.length === 2 && Math.abs(path.nodes[0].point.x - path.nodes[1].point.x) > 1)!;
    // The hinge sits on the wall centre line; the open leaf reaches the opposite face of its own opening box.
    expect(Math.min(...leaf(front).nodes.map((n) => n.point.y))).toBeLessThan(leaf(front).nodes[0].point.y);
    expect(Math.max(...leaf(back).nodes.map((n) => n.point.y))).toBeGreaterThan(leaf(back).nodes[0].point.y);
  });

  it('marks only leaf travel as a projection and scales the broken pattern with the stroke', () => {
    const layer = opening();
    const flags = projectionCurves(layer);
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags.length).toBe(layer.curves!.length);
    expect(projectionCurves(opening({ openingAngle: 0 }))).toEqual([]);
    expect(projectionDash(2)).toEqual([6, 4]);
    expect(projectionDash(0.5)).toEqual([3, 2]);
    expect(svgExport({ ...blankDocument(), layers: [layer] })).toContain('stroke-dasharray="6 4"');
  });

  it('gives each leaf its own mechanism and falls back to the opening mechanism', () => {
    const mixed = { ...defaultProcedural('window'), leafWidths: [50, 50], operation: 'fixed', leafTypes: ['fixed', 'sliding'] } as WindowProcedure;
    expect(leafType(mixed, 0)).toBe('fixed');
    expect(leafType(mixed, 1)).toBe('sliding');
    expect(leafType({ ...mixed, leafTypes: undefined }, 1)).toBe('fixed');
    expect(leafType({ ...mixed, operation: 'opening' }, 1)).toBe('opening');
  });

  it('draws a passage without leaves and a folding leaf with two panels', () => {
    const passage = opening({ operation: 'opening' }), folding = opening({ operation: 'folding' });
    expect(passage.curves).toHaveLength(2);
    expect(projectionCurves(passage)).toEqual([]);
    expect(folding.curves!.length).toBeGreaterThan(opening({ operation: 'swing' }).curves!.length);
  });

  it('round trips the new parameters and rejects unusable ones', () => {
    const layer = opening({ leafWidths: [40, 40], leafTypes: ['swing', 'folding'], side: 'back' });
    const doc = { ...blankDocument(), layers: [layer] };
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    for (const invalid of [{ leafTypes: ['swing'] }, { leafTypes: ['unknown', 'swing'] }, { side: 'middle' }, { operation: 'tilt' }]) {
      const broken = { ...blankDocument(), layers: [{ ...layer, procedural: { ...layer.procedural, leafWidths: [40, 40], ...invalid } }] };
      expect(() => parseDocument(JSON.stringify(broken))).toThrow();
    }
  });

  it('keeps geometry stable for the leaf count and widths', () => {
    const single = opening(), double = opening({ leafWidths: [40, 40] });
    const jamb = ys(single, 0);
    expect(Math.abs(jamb[1] - jamb[0])).toBe(16);
    expect(double.curves!.filter((path) => path.nodes.length === 2).length).toBeGreaterThan(single.curves!.filter((path) => path.nodes.length === 2).length);
  });
});
