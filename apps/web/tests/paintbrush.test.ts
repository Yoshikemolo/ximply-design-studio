// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Point, parseDocument, svgExport } from '../../../packages/domain/src/document';
import { brushOutline, nibHalfWidth, validBrushStroke, DEFAULT_BRUSH_STROKE } from '../../../packages/domain/src/brush-stroke';
import { defaultShortcuts, matchShortcut, validateShortcuts } from '../../../packages/domain/src/shortcuts';

beforeEach(() => localStorage.clear());
const wave = (from = 100, to = 500, y = 200): Point[] =>
  Array.from({ length: Math.round((to - from) / 2) + 1 }, (_, i) => ({ x: from + i * 2, y: y + Math.sin(i / 20) * 40 }));
function stroke(e: EditorService, points: Point[], modifiers: { alt?: boolean } = {}) {
  e.start(points[0]);
  for (const p of points.slice(1)) e.move(p, modifiers);
  e.end();
}
const brushed = (e: EditorService) => e.document().layers.filter((l) => l.brushStroke);

describe('the Paintbrush', () => {
  it('answers to B, as in Illustrator, and moves B over from settings that still gave it to the raster brush', () => {
    expect(defaultShortcuts()['tool.paintbrush']).toEqual(['B']);
    expect(defaultShortcuts()['tool.brush']).toEqual([]);
    const key = { key: 'b', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(matchShortcut(defaultShortcuts(), key)).toBe('tool.paintbrush');
    const saved = { ...defaultShortcuts() } as Record<string, string[]>;
    delete saved['tool.paintbrush'];
    saved['tool.brush'] = ['B'];
    const migrated = validateShortcuts(saved);
    expect(migrated['tool.paintbrush']).toEqual(['B']);
    expect(migrated['tool.brush']).toEqual([]);
    // A key the person chose themselves stays theirs.
    saved['tool.brush'] = ['Shift+B'];
    expect(validateShortcuts(saved)['tool.brush']).toEqual(['Shift+B']);
  });

  it('draws a fitted vector path that carries the brush, unfilled and deselected by default', () => {
    const e = new EditorService();
    e.setTool('paintbrush');
    stroke(e, wave());
    const [layer] = brushed(e);
    expect(layer).toBeDefined();
    expect(layer.kind).toBe('path');
    expect(layer.brushStroke).toEqual(DEFAULT_BRUSH_STROKE);
    expect(layer.fill).toBe('none');
    expect(layer.curves![0].nodes.length).toBeLessThan(40);
    expect(e.selectedId()).toBeNull();
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
  });

  it('closes the stroke with Alt and edits a selected brushed path it starts on', () => {
    const e = new EditorService();
    e.setTool('paintbrush');
    const ring = Array.from({ length: 140 }, (_, i) => ({ x: 300 + Math.cos(i / 25) * 100, y: 300 + Math.sin(i / 25) * 100 }));
    stroke(e, ring, { alt: true });
    const [layer] = brushed(e);
    expect(layer.curves![0].closed).toBe(true);
    e.selectedId.set(layer.id);
    e.selectedIds.set([layer.id]);
    const redraw = Array.from({ length: 60 }, (_, i) => ({ x: 400 - i, y: 300 - Math.sin(i / 20) * 20 + i * 0.1 }));
    stroke(e, redraw);
    expect(brushed(e)).toHaveLength(1);
  });

  it('writes the swept area of the brush into SVG, filled with the stroke colour', () => {
    const e = new EditorService();
    e.setTool('paintbrush');
    stroke(e, wave());
    const svg = svgExport(e.document());
    const layer = brushed(e)[0];
    expect(svg).toContain(`fill="${layer.stroke}" fill-rule="nonzero" stroke="none"`);
  });
});

describe('the calligraphic nib', () => {
  it('paints the diameter across a round nib in every direction', () => {
    const round = { kind: 'calligraphic' as const, angle: 0, roundness: 100, diameter: 10 };
    for (const direction of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) expect(nibHalfWidth(round, direction)).toBeCloseTo(5, 9);
  });

  it('paints thin along the flat of the nib and full across it', () => {
    const flat = { kind: 'calligraphic' as const, angle: 0, roundness: 0, diameter: 10 };
    expect(nibHalfWidth(flat, { x: 1, y: 0 })).toBeLessThan(0.2);
    expect(nibHalfWidth(flat, { x: 0, y: 1 })).toBeCloseTo(5, 9);
    // Turning the nib a right angle swaps the two.
    const turned = { ...flat, angle: 90 };
    expect(nibHalfWidth(turned, { x: 1, y: 0 })).toBeCloseTo(5, 9);
  });

  it('scales with the stroke weight', () => {
    expect(nibHalfWidth(DEFAULT_BRUSH_STROKE, { x: 1, y: 0 }, 4)).toBeCloseTo(6, 9);
  });

  it('outlines an open path as a band with the nib at each end, and a closed one as a ring', () => {
    const line = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }].map((p) => ({ point: p, incoming: { ...p }, outgoing: { ...p }, smooth: false })) };
    const rings = brushOutline(line, { kind: 'calligraphic', angle: 0, roundness: 100, diameter: 10 });
    expect(rings).toHaveLength(3);
    const ys = rings[0].map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-5, 6);
    const square = { ...line, closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }].map((p) => ({ point: p, incoming: { ...p }, outgoing: { ...p }, smooth: false })) };
    expect(brushOutline(square, DEFAULT_BRUSH_STROKE)).toHaveLength(2);
  });

  it('accepts only a complete calligraphic brush inside its ranges', () => {
    expect(validBrushStroke(DEFAULT_BRUSH_STROKE)).toBe(true);
    expect(validBrushStroke({ ...DEFAULT_BRUSH_STROKE, roundness: 101 })).toBe(false);
    expect(validBrushStroke({ ...DEFAULT_BRUSH_STROKE, kind: 'art' })).toBe(false);
    expect(validBrushStroke({ ...DEFAULT_BRUSH_STROKE, extra: 1 })).toBe(false);
  });
});
