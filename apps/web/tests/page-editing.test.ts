// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
function withArt() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({ ...document, layers: [{ ...newLayer('rectangle', 'art', { x: 200, y: 200 }), width: 100, height: 100 }] }));
  return e;
}
const page = (e: EditorService) => ({ width: e.document().width, height: e.document().height });

describe('page editing on the canvas', () => {
  it('offers eight handles only while resizing the page', () => {
    const e = withArt();
    expect(e.pageHandles()).toHaveLength(0);
    e.setPageMode('resize');
    expect(e.pageHandles().map((handle) => handle.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    e.setPageMode('crop');
    expect(e.pageHandles()).toHaveLength(0);
  });

  it('resizes the page live from a handle and keeps one undo step', () => {
    const e = withArt();
    e.setPageMode('resize');
    e.start({ x: 1200, y: 800 });
    e.move({ x: 1000, y: 700 });
    expect(page(e)).toEqual({ width: 1000, height: 700 });
    e.end();
    expect(page(e)).toEqual({ width: 1000, height: 700 });
    e.undo();
    expect(page(e)).toEqual({ width: 1200, height: 800 });
  });

  it('moves the artwork when the page grows from the top left corner', () => {
    const e = withArt();
    e.setPageMode('resize');
    e.start({ x: 0, y: 0 });
    e.move({ x: -100, y: -50 });
    e.end();
    expect(page(e)).toEqual({ width: 1300, height: 850 });
    expect([e.document().layers[0].x, e.document().layers[0].y]).toEqual([300, 250]);
  });

  it('crops to the dragged area and reports too small an area', () => {
    const e = withArt();
    e.setPageMode('crop');
    e.start({ x: 150, y: 150 });
    e.move({ x: 650, y: 550 });
    expect(e.pageCropArea()).toEqual({ x: 150, y: 150, width: 500, height: 400 });
    e.end();
    expect(page(e)).toEqual({ width: 500, height: 400 });
    expect([e.document().layers[0].x, e.document().layers[0].y]).toEqual([50, 50]);
    expect(e.pageMode()).toBeNull();
    const small = withArt();
    small.setPageMode('crop');
    small.start({ x: 100, y: 100 });
    small.move({ x: 105, y: 105 });
    small.end();
    expect(page(small)).toEqual({ width: 1200, height: 800 });
    expect(small.status()).toContain('smaller than the minimum');
  });

  it('restores the page when the gesture is cancelled', () => {
    const e = withArt();
    e.setPageMode('resize');
    e.start({ x: 1200, y: 800 });
    e.move({ x: 900, y: 600 });
    expect(page(e)).toEqual({ width: 900, height: 600 });
    e.cancel();
    expect(page(e)).toEqual({ width: 1200, height: 800 });
    expect(e.pageMode()).toBeNull();
    expect(e.history.canUndo).toBe(false);
  });

  it('refuses a page outside the supported size', () => {
    const e = withArt();
    e.setPageMode('resize');
    e.start({ x: 1200, y: 800 });
    e.move({ x: 9000, y: 800 });
    expect(page(e)).toEqual({ width: 1200, height: 800 });
  });
});
