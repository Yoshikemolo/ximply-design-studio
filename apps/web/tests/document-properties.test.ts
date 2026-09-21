// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { readPageSetup } from '../../../packages/domain/src/page-setup';

beforeEach(() => localStorage.clear());

describe('document properties', () => {
  it('reads back the margins and registration marks that page setup wrote', () => {
    const e = new EditorService();
    const margins = { top: 40, right: 30, bottom: 20, left: 10, edges: true, centerX: true, centerY: false };
    expect(e.applyPageSetup({ size: { width: 800, height: 1200 }, margins, marks: 'file4' })).toBe(true);
    expect(readPageSetup(e.document())).toEqual({ margins, marks: 'file4' });
  });

  it('reports no margins and no marks on a plain page', () => {
    const e = new EditorService();
    expect(e.pageSetup()).toEqual({ margins: { top: 0, right: 0, bottom: 0, left: 0, edges: false, centerX: false, centerY: false }, marks: 'none' });
  });

  it('changes one part of the page setup and keeps the rest', () => {
    const e = new EditorService();
    const margins = { top: 40, right: 30, bottom: 20, left: 10, edges: true, centerX: false, centerY: false };
    e.applyPageSetup({ size: { width: 800, height: 1200 }, margins, marks: 'file2' });
    expect(e.updatePageSetup({ width: 1000 })).toBe(true);
    expect(e.document().width).toBe(1000);
    expect(e.pageSetup()).toEqual({ margins, marks: 'file2' });
    expect(e.updatePageSetup({ marks: 'none' })).toBe(true);
    expect(e.pageSetup().marks).toBe('none');
    expect(e.pageSetup().margins).toEqual(margins);
    // Swapping the sides turns the page, as the orientation buttons do.
    expect(e.updatePageSetup({ width: 1200, height: 1000 })).toBe(true);
    expect([e.document().width, e.document().height]).toEqual([1200, 1000]);
  });

  it('allows as many layers as a document may hold when the page changes', () => {
    const e = new EditorService();
    e.document.update((d) => ({ ...d, layers: Array.from({ length: 300 }, (_, i) => ({ id: 'l' + i, name: 'Box', kind: 'rectangle' as const, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, blend: 'source-over' as const, fill: '#000000', stroke: 'none', strokeWidth: 0, points: [], text: '', fontSize: 16, source: '', adjustments: { brightness: 100, contrast: 100, saturation: 100, blur: 0 } })) }));
    expect(e.updatePageSetup({ width: 900 })).toBe(true);
  });
});
