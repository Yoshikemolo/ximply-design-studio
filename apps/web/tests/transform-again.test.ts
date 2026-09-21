// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';

function withSquare() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({
    ...document,
    layers: [{ ...newLayer('rectangle', 'art', { x: 100, y: 100 }), width: 100, height: 100 }],
  }));
  e.selectLayer('art');
  e.setTool('select');
  return e;
}
const box = (e: EditorService, index = 0) => {
  const layer = e.document().layers[index];
  return [layer.x, layer.y];
};

beforeEach(() => localStorage.clear());
describe('transform again', () => {
  it('repeats the move that was just made', () => {
    const e = withSquare();
    e.start({ x: 120, y: 180 });
    e.move({ x: 170, y: 210 });
    e.end();
    const [movedX, movedY] = box(e);
    // The drag lands where the aids allow; the repeat applies the same step again.
    const step = [movedX - 100, movedY - 100];
    expect(step[0]).toBeGreaterThan(0);
    expect(e.transformAgain()).toBe(true);
    expect(box(e)).toEqual([movedX + step[0], movedY + step[1]]);
    e.undo();
    expect(box(e)).toEqual([movedX, movedY]);
  });

  it('repeats a turn around the pivot and a scaling', () => {
    const e = withSquare();
    e.setPivot({ x: 100, y: 100 });
    e.rotateSelection(90);
    expect(e.transformAgain()).toBe(true);
    // Two quarter turns about the corner leave the square rotated by half a turn.
    expect(e.document().layers[0].rotation).toBe(180);
    const scaled = withSquare();
    scaled.setPivot({ x: 100, y: 100 });
    scaled.transformBy(0, 2);
    expect(scaled.document().layers[0].width).toBe(200);
    expect(scaled.transformAgain()).toBe(true);
    expect(scaled.document().layers[0].width).toBe(400);
  });

  it('repeats around the pivot of the original transformation, not of the new copies', () => {
    const e = withSquare();
    // A turn of ninety degrees around the corner of the square, leaving a copy behind.
    e.setPivot({ x: 100, y: 100 });
    e.duplicate();
    e.rotateSelection(90);
    const first = e.selectedLayers()[0];
    expect(e.lastTransform()?.pivot).toEqual({ x: 100, y: 100 });
    // The copies have their own centre, but the repeat still turns around the same corner.
    expect(e.transformAgain()).toBe(true);
    const second = e.selectedLayers()[0];
    const distance = (layer: { x: number; y: number; width: number; height: number }) =>
      Math.hypot(layer.x + layer.width / 2 - 100, layer.y + layer.height / 2 - 100);
    expect(distance(second)).toBeCloseTo(distance(first), 6);
    expect(second.rotation).toBe(first.rotation + 90);
    expect(e.transformAgain()).toBe(true);
    expect(distance(e.selectedLayers()[0])).toBeCloseTo(distance(first), 6);
  });

  it('records the pivot the selection had before the drag, not after it', () => {
    const e = withSquare();
    // The square spans 100 to 200, so its centre is at 150, 150 before it moves.
    e.start({ x: 120, y: 180 });
    e.move({ x: 220, y: 180 });
    e.end();
    expect(e.lastTransform()?.pivot).toEqual({ x: 150, y: 150 });
    // A pivot placed by hand is the one that is kept instead.
    const placed = withSquare();
    placed.setPivot({ x: 100, y: 100 });
    placed.start({ x: 120, y: 180 });
    placed.move({ x: 220, y: 180 });
    placed.end();
    expect(placed.lastTransform()?.pivot).toEqual({ x: 100, y: 100 });
  });

  it('says so when there is nothing to repeat', () => {
    const e = withSquare();
    expect(e.transformAgain()).toBe(false);
    expect(e.status()).toContain('no transformation to repeat');
  });
});

describe('duplicating while transforming', () => {
  it('leaves the original behind when Alt is held during the drag', () => {
    const e = withSquare();
    e.start({ x: 120, y: 180 });
    e.move({ x: 220, y: 180 }, { alt: true });
    expect(e.duplicatingDrag()).toBe(true);
    e.end();
    expect(e.duplicatingDrag()).toBe(false);
    const layers = e.document().layers;
    expect(layers).toHaveLength(2);
    // The original stays where it was and the copy carries the move.
    expect([layers[0].x, layers[0].y]).toEqual([100, 100]);
    expect(layers[1].x).toBeGreaterThan(150);
    expect(layers[1].y).toBe(100);
    expect(e.selectedLayers().map((layer) => layer.id)).toEqual([layers[1].id]);
    e.undo();
    expect(e.document().layers).toHaveLength(1);
    expect(box(e)).toEqual([100, 100]);
  });

  it('repeats the duplication with the same transformation', () => {
    const e = withSquare();
    e.start({ x: 120, y: 180 });
    e.move({ x: 220, y: 180 }, { alt: true });
    e.end();
    expect(e.transformAgain()).toBe(true);
    const layers = e.document().layers;
    expect(layers).toHaveLength(3);
    // Three squares evenly spaced: the original, the copy and the copy of the repeat.
    const step = layers[1].x - layers[0].x;
    expect(step).toBeGreaterThan(0);
    expect(layers[2].x - layers[1].x).toBeCloseTo(step, 6);
    expect(e.status()).toContain('with a copy');
  });

  it('shows the original in its place while the copy is dragged', () => {
    const e = withSquare();
    e.start({ x: 120, y: 180 });
    e.move({ x: 220, y: 180 }, { alt: true });
    const preview = e.previewDocument().layers;
    // Two shapes are drawn: the original where it was and the copy under the pointer.
    expect(preview).toHaveLength(2);
    expect([preview[0].x, preview[0].y]).toEqual([100, 100]);
    expect(preview[0].id.endsWith('__origin')).toBe(true);
    expect(preview[1].x).toBeGreaterThan(150);
    // The document itself still holds one object until the button is released.
    expect(e.document().layers).toHaveLength(1);
    e.move({ x: 220, y: 180 });
    expect(e.previewDocument().layers).toHaveLength(1);
  });

  it('decides the duplication with the keys held at the release', () => {
    const e = withSquare();
    e.start({ x: 120, y: 180 });
    e.move({ x: 220, y: 180 });
    // Alt pressed without moving the pointer again still duplicates.
    e.setDuplicatingDrag(true);
    expect(e.duplicatingDrag()).toBe(true);
    e.end({ alt: true });
    expect(e.document().layers).toHaveLength(2);
    const other = withSquare();
    other.start({ x: 120, y: 180 });
    other.move({ x: 220, y: 180 }, { alt: true });
    // Alt released before the button leaves an ordinary move.
    other.end({ alt: false });
    expect(other.document().layers).toHaveLength(1);
  });

  it('keeps the drag ordinary while Alt is not held', () => {
    const e = withSquare();
    e.start({ x: 120, y: 180 });
    e.move({ x: 170, y: 180 }, { alt: true });
    e.move({ x: 170, y: 180 });
    expect(e.duplicatingDrag()).toBe(false);
    e.end();
    expect(e.document().layers).toHaveLength(1);
  });
});
