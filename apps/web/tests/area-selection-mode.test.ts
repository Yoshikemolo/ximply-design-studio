// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { layerInsideArea, layerIntersectsArea } from '../../../packages/domain/src/selection-area';
import { newLayer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const square = (id: string, x: number, y: number, size = 60) => ({ ...newLayer('rectangle', id, { x, y }), width: size, height: size });
const area = (x1: number, y1: number, x2: number, y2: number) => ({ kind: 'rectangle' as const, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, points: [{ x: x1, y: y1 }] });

function withSquares() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({ ...document, layers: [square('inside', 120, 120), square('crossing', 240, 120)] }));
  e.setTool('selectRectangle');
  return e;
}
const drag = (e: EditorService, from: { x: number; y: number }, to: { x: number; y: number }) => { e.start(from); e.move(to); e.end(); };

describe('area selection modes', () => {
  it('separates touched objects from enclosed ones', () => {
    const enclosed = square('inside', 120, 120), touched = square('crossing', 240, 120);
    const frame = area(100, 100, 260, 260);
    expect(layerIntersectsArea(enclosed, frame)).toBe(true);
    expect(layerIntersectsArea(touched, frame)).toBe(true);
    expect(layerInsideArea(enclosed, frame)).toBe(true);
    expect(layerInsideArea(touched, frame)).toBe(false);
  });

  it('selects touched objects by default and only enclosed ones in inner mode', () => {
    const e = withSquares();
    drag(e, { x: 100, y: 100 }, { x: 260, y: 260 });
    expect(e.selectedIds().sort()).toEqual(['crossing', 'inside']);
    e.areaSelectionMode.set('inside');
    const inner = withSquares();
    inner.areaSelectionMode.set('inside');
    drag(inner, { x: 100, y: 100 }, { x: 260, y: 260 });
    expect(inner.selectedIds()).toEqual(['inside']);
  });

  it('persists the chosen mode', () => {
    const preferences = new PreferencesService();
    expect(preferences.areaSelectionMode()).toBe('intersect');
    expect(preferences.setMeasurement('areaSelectionMode', 'inside')).toBe(true);
    expect(new PreferencesService().areaSelectionMode()).toBe('inside');
    expect(preferences.setMeasurement('areaSelectionMode', 'partial' as 'inside')).toBe(false);
    expect(preferences.areaSelectionMode()).toBe('inside');
  });
});
