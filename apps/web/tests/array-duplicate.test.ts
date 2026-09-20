// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';
import { DEFAULT_ARRAY } from '../../../packages/domain/src/array-copy';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

const settings = (overrides: Partial<typeof DEFAULT_ARRAY>) => ({ ...DEFAULT_ARRAY, ...overrides });
function withSquare() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({
    ...document,
    layers: [{ ...newLayer('rectangle', 'art', { x: 100, y: 100 }), width: 20, height: 20 }],
  }));
  e.selectLayer('art');
  return e;
}

beforeEach(() => localStorage.clear());
describe('duplicate in series', () => {
  it('lays a linear series out and selects the copies, undone in one step', () => {
    const e = withSquare();
    expect(e.duplicateSeries(settings({ mode: 'linear', copies: 3, stepX: 50, stepY: 0 }))).toBe(true);
    const xs = e.document().layers.map((layer) => layer.x);
    expect(xs).toEqual([100, 150, 200, 250]);
    expect(e.selectedLayers()).toHaveLength(3);
    e.undo();
    expect(e.document().layers).toHaveLength(1);
  });

  it('turns a circular series around the pivot', () => {
    const e = withSquare();
    // The pivot sits away from the selection, which is what the copies turn around.
    e.setPivot({ x: 100, y: 110 });
    expect(e.duplicateSeries(settings({ mode: 'circular', copies: 1, sweep: 180, orient: true }))).toBe(true);
    const copy = e.selectedLayers()[0];
    // Half a turn about (100, 110) sends the centre from (110, 110) to (90, 110).
    expect(copy.x + copy.width / 2).toBeCloseTo(90, 6);
    expect(copy.y + copy.height / 2).toBeCloseTo(110, 6);
    expect(copy.rotation).toBe(180);
  });

  it('fills a grid and refuses settings that do not make a series', () => {
    const e = withSquare();
    expect(e.duplicateSeries(settings({ mode: 'grid', columns: 3, rows: 2, gapX: 30, gapY: 40 }))).toBe(true);
    expect(e.document().layers).toHaveLength(6);
    expect(e.document().layers.map((layer) => [layer.x, layer.y])).toEqual([
      [100, 100], [130, 100], [160, 100], [100, 140], [130, 140], [160, 140],
    ]);
    expect(e.duplicateSeries(settings({ copies: 0 }))).toBe(false);
    e.selectedIds.set([]);
    e.selectedId.set(null);
    expect(e.duplicateSeries(settings({}))).toBe(false);
  });

  it('keeps the pivot of the series on the copies it made', () => {
    const e = withSquare();
    e.setPivot({ x: 100, y: 110 });
    expect(e.duplicateSeries(settings({ mode: 'circular', copies: 1, sweep: 180 }))).toBe(true);
    // The copies inherit the point the series turned around, so a second one repeats it.
    expect(e.pivot()).toEqual({ x: 100, y: 110 });
    expect(e.pivotMoved()).toBe(true);
  });

  it('is bound to its own key and offered on the selected objects', () => {
    const e = withSquare();
    expect(defaultShortcuts()['duplicateSeries']).toEqual(['Mod+Shift+D']);
    const target = e.contextForLayer('art')!;
    expect(e.contextActions(target).some((entry) => entry.id === 'duplicateSeries' && entry.enabled)).toBe(true);
    // The shell owns the dialog, so the action itself changes nothing.
    expect(e.runContextAction(target, 'duplicateSeries')).toBe(false);
  });
});
