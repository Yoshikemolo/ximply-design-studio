// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { parseDocument, newLayer, Layer } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';
import { WallProcedure } from '../../../packages/domain/src/procedural';
import { coveredRange, wallAxis, wallBoolean } from '../../../packages/domain/src/wall-boolean';

beforeEach(() => localStorage.clear());
const wall = (id: string, start: { x: number; y: number }, end: { x: number; y: number }, thickness = 16): Layer => ({
  ...newLayer('path', id, { x: 0, y: 0 }, '#3f4753', '#161b22', 1),
  width: 1, height: 1, procedural: { type: 'wall', start, end, thickness },
});
function walls(...layers: Layer[]) {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({ ...document, layers }));
  e.selectAll();
  return e;
}
const runs = (e: EditorService) => e.document().layers.filter((layer) => layer.procedural?.type === 'wall').map((layer) => {
  const p = layer.procedural as WallProcedure;
  const a = worldPoint(layer, p.start), b = worldPoint(layer, p.end);
  return { from: { x: Math.round(a.x), y: Math.round(a.y) }, to: { x: Math.round(b.x), y: Math.round(b.y) }, thickness: p.thickness };
});

describe('walls keep being walls', () => {
  it('merges collinear walls that overlap into a single run', () => {
    const e = walls(wall('a', { x: 100, y: 100 }, { x: 300, y: 100 }), wall('b', { x: 250, y: 100 }, { x: 500, y: 100 }));
    e.boolean('union');
    const result = runs(e);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ from: { x: 100, y: 100 }, to: { x: 500, y: 100 }, thickness: 16 });
    expect(e.document().layers.every((layer) => layer.procedural?.type === 'wall')).toBe(true);
    expect(parseDocument(JSON.stringify(e.document())).layers).toHaveLength(1);
  });

  it('keeps crossing walls as their own runs when united', () => {
    const e = walls(wall('a', { x: 100, y: 200 }, { x: 400, y: 200 }), wall('b', { x: 250, y: 60 }, { x: 250, y: 360 }));
    e.boolean('union');
    expect(runs(e)).toHaveLength(2);
    expect(e.document().layers.every((layer) => layer.procedural?.type === 'wall')).toBe(true);
  });

  it('splits a wall where another one crosses it when subtracting', () => {
    const e = walls(wall('a', { x: 100, y: 200 }, { x: 400, y: 200 }), wall('b', { x: 250, y: 60 }, { x: 250, y: 360 }));
    e.boolean('subtract');
    const result = runs(e);
    expect(result).toHaveLength(2);
    // The gap is the thickness of the crossing wall, centred on it.
    expect(result[0].from).toEqual({ x: 100, y: 200 });
    expect(result[0].to).toEqual({ x: 242, y: 200 });
    expect(result[1].from).toEqual({ x: 258, y: 200 });
    expect(result[1].to).toEqual({ x: 400, y: 200 });
    e.undo();
    expect(runs(e)).toHaveLength(2);
    expect(e.document().layers.map((layer) => layer.id)).toEqual(['a', 'b']);
  });

  it('keeps only the crossing piece when intersecting and every arm when excluding', () => {
    const crossing = () => [wall('a', { x: 100, y: 200 }, { x: 400, y: 200 }), wall('b', { x: 250, y: 60 }, { x: 250, y: 360 })] as const;
    const inner = walls(...crossing());
    inner.boolean('intersect');
    const piece = runs(inner);
    expect(piece).toHaveLength(1);
    expect(piece[0].to.x - piece[0].from.x).toBe(16);
    const excluded = walls(...crossing());
    excluded.boolean('exclude');
    expect(runs(excluded)).toHaveLength(4);
  });

  it('reports when an operation leaves no wall and changes nothing', () => {
    const e = walls(wall('a', { x: 100, y: 100 }, { x: 300, y: 100 }), wall('b', { x: 100, y: 500 }, { x: 300, y: 500 }));
    e.boolean('intersect');
    expect(e.status()).toContain('leaves no wall');
    expect(runs(e)).toHaveLength(2);
    expect(e.history.canUndo).toBe(false);
  });

  it('measures how far one wall covers another', () => {
    const axis = wallAxis(wall('a', { x: 0, y: 0 }, { x: 100, y: 0 }))!;
    const crossing = wallAxis(wall('b', { x: 50, y: -50 }, { x: 50, y: 50 }, 20))!;
    const range = coveredRange(axis, crossing)!;
    expect(range[0]).toBeCloseTo(0.4);
    expect(range[1]).toBeCloseTo(0.6);
    expect(coveredRange(axis, wallAxis(wall('c', { x: 0, y: 400 }, { x: 100, y: 400 }))!)).toBeNull();
    expect(wallBoolean([axis], 'union')).toEqual([]);
  });

  it('still combines ordinary artwork into one plain object', () => {
    localStorage.clear();
    const e = new EditorService();
    e.document.update((document) => ({ ...document, layers: [
      { ...newLayer('rectangle', 'one', { x: 0, y: 0 }), width: 100, height: 100 },
      { ...newLayer('rectangle', 'two', { x: 50, y: 50 }), width: 100, height: 100 },
    ] }));
    e.selectAll();
    e.boolean('union');
    expect(e.document().layers).toHaveLength(1);
    expect(e.document().layers[0].procedural).toBeUndefined();
  });

  it('offers an icon for every action in the flyout', () => {
    const app = Object.create(AppComponent.prototype) as AppComponent;
    for (const id of ['union', 'subtract', 'intersect', 'exclude', 'alignLeft', 'group', 'ungroup', 'mirrorH', 'rotateCW', 'scaleUp']) {
      expect(app.commandIcon(id), id).not.toBe('');
    }
    expect(app.commandIcon('unknownCommand')).toBe('');
  });
});
