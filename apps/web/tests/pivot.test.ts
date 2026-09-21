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

  it('moves the artwork from outside the mark and whenever the pivot is locked', () => {
    const e = withSquare();
    e.setTool('select');
    // Outside the box of the mark the press belongs to the artwork, and the pivot travels with it.
    e.start({ x: 180, y: 150 });
    e.move({ x: 280, y: 150 });
    e.end();
    expect(e.document().layers[0].x).toBe(200);
    expect(e.pivot()).toEqual({ x: 250, y: 150 });
    expect(e.pivotMoved()).toBe(false);
    // A locked pivot hands even a press on the mark to the artwork.
    e.pivotLocked.set(true);
    e.start({ x: 250, y: 150 });
    e.move({ x: 270, y: 150 });
    e.end();
    expect(e.document().layers[0].x).toBe(220);
    const locked = withSquare();
    locked.setTool('rotate');
    locked.pivotLocked.set(true);
    locked.start({ x: 150, y: 150 });
    locked.move({ x: 250, y: 250 });
    locked.end();
    expect(locked.pivot()).toEqual({ x: 150, y: 150 });
  });

  it('takes the mark with the selection tool even where it rests on the artwork', () => {
    const e = withSquare();
    e.setTool('select');
    // The mark sits at the centre of the square: a press on it drags the pivot, not the square.
    e.start({ x: 150, y: 150 });
    e.move({ x: 300, y: 180 });
    e.end();
    expect(e.pivot()).toEqual({ x: 300, y: 180 });
    expect(e.document().layers[0].x).toBe(100);
    // A press away from the mark moves the artwork, and the pivot travels with it.
    e.start({ x: 120, y: 120 });
    e.move({ x: 140, y: 120 });
    e.end();
    expect(e.document().layers[0].x).toBe(120);
    expect(e.pivot()).toEqual({ x: 320, y: 180 });
    // A locked pivot takes no press: a press on the artwork moves it and the pivot travels along.
    e.pivotLocked.set(true);
    e.start({ x: 140, y: 140 });
    e.move({ x: 180, y: 140 });
    e.end();
    expect(e.document().layers[0].x).toBe(160);
    expect(e.pivot()).toEqual({ x: 360, y: 180 });
  });

  it('carries a pivot placed by hand with the selection it belongs to', () => {
    const e = withSquare();
    e.setTool('select');
    e.setPivot({ x: 100, y: 100 });
    // Dragging the artwork keeps the pivot at the same place within the selection.
    e.start({ x: 120, y: 120 });
    e.move({ x: 170, y: 140 });
    e.end();
    expect(e.document().layers[0]).toMatchObject({ x: 150, y: 120 });
    expect(e.pivot()).toEqual({ x: 150, y: 120 });
    // The arrow keys move it the same way.
    e.nudge(10, -20);
    expect(e.pivot()).toEqual({ x: 160, y: 100 });
    // A cancelled drag leaves the pivot where it started.
    e.start({ x: 200, y: 160 });
    e.move({ x: 300, y: 160 });
    e.cancel();
    expect(e.pivot()).toEqual({ x: 160, y: 100 });
    // Rotating about the pivot leaves the pivot itself in place.
    e.rotateSelection(90);
    expect(e.pivot()).toEqual({ x: 160, y: 100 });
  });

  it('sends the pivot back to the centre when its mark is double pressed', () => {
    const e = withSquare();
    e.setTool('select');
    e.setPivot({ x: 100, y: 100 });
    expect(e.pivotMoved()).toBe(true);
    // Away from the mark the double press belongs to the artwork.
    expect(e.resetPivotAt({ x: 150, y: 150 })).toBe(false);
    expect(e.resetPivotAt({ x: 101, y: 99 })).toBe(true);
    expect(e.pivot()).toEqual({ x: 150, y: 150 });
    expect(e.pivotMoved()).toBe(false);
    // With the pivot at the centre already, and with it locked, there is nothing to undo.
    expect(e.resetPivotAt({ x: 150, y: 150 })).toBe(false);
    e.setPivot({ x: 100, y: 100 });
    e.pivotLocked.set(true);
    expect(e.resetPivotAt({ x: 100, y: 100 })).toBe(false);
  });

  it('brings the pivot back with undo and forward again with redo', () => {
    const e = withSquare();
    e.setTool('select');
    e.setPivot({ x: 100, y: 100 });
    // Moving the artwork carries the pivot; undo returns both.
    e.start({ x: 120, y: 120 });
    e.move({ x: 220, y: 120 });
    e.end();
    expect(e.pivot()).toEqual({ x: 200, y: 100 });
    e.undo();
    expect(e.document().layers[0].x).toBe(100);
    expect(e.pivot()).toEqual({ x: 100, y: 100 });
    e.redo();
    expect(e.document().layers[0].x).toBe(200);
    expect(e.pivot()).toEqual({ x: 200, y: 100 });
    // Placing the pivot is a step of its own, with the artwork untouched.
    const artwork = structuredClone(e.document().layers);
    e.start({ x: 200, y: 100 });
    e.move({ x: 330, y: 230 });
    e.end();
    expect(e.pivot()).toEqual({ x: 330, y: 230 });
    e.undo();
    expect(e.pivot()).toEqual({ x: 200, y: 100 });
    expect(e.document().layers).toEqual(artwork);
    e.redo();
    expect(e.pivot()).toEqual({ x: 330, y: 230 });
  });

  it('snaps the pivot to the selection box, its centre and the vertices of other artwork', () => {
    const e = withSquare();
    e.document.update((document) => ({ ...document, layers: [...document.layers, { ...newLayer('rectangle', 'other', { x: 300, y: 300 }), width: 60, height: 60 }] }));
    e.selectLayer('art');
    // Corner of the selection box.
    expect(e.pivotPoint({ x: 103, y: 197 })).toEqual({ x: 100, y: 200 });
    // Middle of one of its sides.
    expect(e.pivotPoint({ x: 151, y: 103 })).toEqual({ x: 150, y: 100 });
    // The sides themselves attract as lines.
    expect(e.pivotPoint({ x: 120, y: 104 })).toEqual({ x: 120, y: 100 });
    // The geometric centre wins over the box when both are near.
    expect(e.pivotPoint({ x: 148, y: 152 })).toEqual({ x: 150, y: 150 });
    // A vertex of another object within the snapping distance.
    expect(e.pivotPoint({ x: 297, y: 302 })).toEqual({ x: 300, y: 300 });
    // Far from everything the point is only aligned by the active aids.
    expect(e.pivotPoint({ x: 500, y: 500 })).toEqual(e.snap({ x: 500, y: 500 }));
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
