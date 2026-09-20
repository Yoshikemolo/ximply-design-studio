// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer, Layer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
function withSquare() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({ ...document, layers: [{ ...newLayer('rectangle', 'art', { x: 100, y: 100 }), width: 100, height: 100 }] }));
  e.selectLayer('art');
  return e;
}
const box = (layer: Layer) => ({ x: layer.x, y: layer.y, width: layer.width, height: layer.height });

describe('transform pivot', () => {
  it('starts at the geometric centre of the selection', () => {
    const e = withSquare();
    expect(e.pivot()).toEqual({ x: 150, y: 150 });
    expect(e.pivotMoved()).toBe(false);
  });

  it('is dragged with a transform tool, snaps and can be cancelled', () => {
    const e = withSquare();
    e.setTool('rotate');
    e.start({ x: 150, y: 150 });
    e.move({ x: 203, y: 197 });
    // A vertex of the artwork is within the snapping radius.
    expect(e.pivot()).toEqual({ x: 200, y: 200 });
    e.end();
    expect(e.pivotMoved()).toBe(true);
    e.setTool('rotate');
    e.start({ x: 200, y: 200 });
    e.move({ x: 260, y: 260 });
    e.cancel();
    expect(e.pivot()).toEqual({ x: 200, y: 200 });
  });

  it('leaves the artwork alone when another tool is active or the pivot is locked', () => {
    const e = withSquare();
    e.setTool('select');
    e.start({ x: 150, y: 150 });
    e.move({ x: 250, y: 150 });
    e.end();
    expect(e.document().layers[0].x).toBe(200);
    expect(e.pivotMoved()).toBe(false);
    const locked = withSquare();
    locked.setTool('rotate');
    locked.pivotLocked.set(true);
    locked.start({ x: 150, y: 150 });
    locked.move({ x: 250, y: 250 });
    locked.end();
    expect(locked.pivot()).toEqual({ x: 150, y: 150 });
  });

  it('ignores magnetism when it is switched off', () => {
    const e = withSquare();
    e.pivotSnap.set(false);
    e.setTool('rotate');
    e.start({ x: 150, y: 150 });
    e.move({ x: 203, y: 197 });
    expect(e.pivot()).toEqual({ x: 203, y: 197 });
  });

  it('mirrors about the pivot instead of the selection centre', () => {
    const e = withSquare();
    e.setPivot({ x: 100, y: 100 });
    e.reflect('horizontal');
    // Mirroring about the left edge moves the square to the other side of it.
    expect(box(e.document().layers[0])).toEqual({ x: 0, y: 100, width: 100, height: 100 });
    e.reflect('vertical');
    expect(box(e.document().layers[0])).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('scales and rotates about the pivot', () => {
    const e = withSquare();
    e.setPivot({ x: 100, y: 100 });
    e.transformBy(0, 2);
    // A corner used as pivot stays put while the square doubles.
    expect(box(e.document().layers[0])).toEqual({ x: 100, y: 100, width: 200, height: 200 });
    const rotated = withSquare();
    rotated.setPivot({ x: 100, y: 100 });
    rotated.rotateSelection(90);
    const layer = rotated.document().layers[0];
    expect(layer.x).toBeCloseTo(0);
    expect(layer.y).toBeCloseTo(100);
  });

  it('uses the centre for another selection and remembers the moved pivot of this one', () => {
    const e = withSquare();
    e.document.update((document) => ({ ...document, layers: [...document.layers, { ...newLayer('rectangle', 'other', { x: 400, y: 400 }), width: 40, height: 40 }] }));
    e.setPivot({ x: 100, y: 100 });
    expect(e.pivot()).toEqual({ x: 100, y: 100 });
    e.selectLayer('other');
    expect(e.pivot()).toEqual({ x: 420, y: 420 });
    e.selectLayer('art');
    expect(e.pivot()).toEqual({ x: 100, y: 100 });
    e.resetPivot();
    expect(e.pivot()).toEqual({ x: 150, y: 150 });
  });
});
