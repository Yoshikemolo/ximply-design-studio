// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { defaultProcedural, generateProcedural, StairProcedure } from '../../../packages/domain/src/procedural';
import { dimensionGeometry } from '../../../packages/domain/src/dimensions';
import { newLayer, parseDocument, blankDocument } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const stair = (patch: Partial<StairProcedure> = {}) => generateProcedural({
  ...newLayer('path', 's', { x: 0, y: 0 }, 'none', '#000000', 1),
  width: 100, height: 280,
  procedural: { ...(defaultProcedural('stair') as StairProcedure), ...patch },
});

describe('stair tool', () => {
  it('draws the outline, one line per riser and a walking arrow', () => {
    const flight = stair({ steps: 6 });
    // Outline, five internal treads, the walking line and its two arrow strokes.
    expect(flight.curves).toHaveLength(1 + 5 + 3);
    expect(flight.curves![0].closed).toBe(true);
    expect(stair({ steps: 12 }).curves).toHaveLength(1 + 11 + 3);
  });

  it('points the arrow towards the exit of the flight', () => {
    const tip = (direction: 'up' | 'down') => {
      const curves = stair({ direction }).curves!;
      const walking = curves[curves.length - 3];
      return walking.nodes[1].point.y;
    };
    expect(tip('up')).toBeLessThan(tip('down'));
  });

  it('creates a flight by dragging and keeps its parameters valid', () => {
    const e = new EditorService();
    e.setTool('stair');
    e.start({ x: 20, y: 20 });
    e.move({ x: 140, y: 300 });
    e.end();
    const layer = e.selected()!;
    expect(layer.procedural?.type).toBe('stair');
    expect((layer.procedural as StairProcedure).width).toBeCloseTo(120);
    expect((layer.procedural as StairProcedure).length).toBeCloseTo(280);
    expect(parseDocument(JSON.stringify(e.document())).layers).toHaveLength(1);
  });

  it('rejects impossible step counts', () => {
    const broken = (steps: unknown) => ({ ...blankDocument(), layers: [{ ...stair(), procedural: { ...defaultProcedural('stair'), steps } }] });
    for (const steps of [1, 0, 2.5, 200, '6']) expect(() => parseDocument(JSON.stringify(broken(steps)))).toThrow();
  });
});

describe('chain dimension tool', () => {
  it('measures each span against one shared offset line in a single history entry', () => {
    const e = new EditorService();
    e.setTool('dimensionChain');
    for (const x of [100, 200, 360]) { e.start({ x, y: 100 }); e.end(); }
    e.start({ x: 360, y: 100 });
    e.end();
    expect(e.dimensionDraft()?.ready).toBe(true);
    e.start({ x: 220, y: 40 });
    e.end();
    const dimensions = e.document().layers.filter((l) => l.dimension);
    expect(dimensions).toHaveLength(2);
    const values = dimensions.map((l) => dimensionGeometry(l).value);
    expect(values[0]).toBeCloseTo(dimensionGeometry(dimensions[0]).value);
    expect(values.map((v) => Math.round(v * 100) / 100)).toEqual([100 / 96 * 25.4, 160 / 96 * 25.4].map((v) => Math.round(v * 100) / 100));
    const offsets = dimensions.map((l) => dimensionGeometry(l).labelPosition.y);
    expect(offsets[0]).toBeCloseTo(offsets[1]);
    e.undo();
    expect(e.document().layers.filter((l) => l.dimension)).toHaveLength(0);
  });

  it('needs at least three points and abandons the chain on cancel', () => {
    const e = new EditorService();
    e.setTool('dimensionChain');
    for (const x of [100, 200]) { e.start({ x, y: 100 }); e.end(); }
    e.start({ x: 200, y: 100 });
    e.end();
    expect(e.dimensionDraft()?.ready).toBeUndefined();
    e.cancel();
    expect(e.dimensionDraft()).toBeNull();
    expect(e.document().layers).toHaveLength(0);
  });
});
