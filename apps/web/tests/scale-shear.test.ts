// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer, newLayer, parseDocument } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';

/** A 200 by 100 box at (100, 100), selected, with a stroke of 2. */
function withBox(extra: Partial<Layer> = {}) {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((d) => ({ ...d, layers: [{ ...newLayer('rectangle', 'art', { x: 100, y: 100 }, '#000000', '#000000', 2), width: 200, height: 100, ...extra }] }));
  e.selectLayer('art');
  return e;
}
const art = (e: EditorService) => e.document().layers.find((l) => l.id === 'art')!;
const corner = (l: Layer, x: number, y: number) => worldPoint(l, { x: x * l.width, y: y * l.height });
const drag = (e: EditorService, from: { x: number; y: number }, to: { x: number; y: number }, modifiers: { shift?: boolean; alt?: boolean } = {}) => {
  e.start(from, modifiers);
  e.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, modifiers);
  e.move(to, modifiers);
  e.end(modifiers);
};
beforeEach(() => localStorage.clear());

describe('the Scale dialog', () => {
  it('scales non-uniformly about the pivot and keeps strokes unless asked', () => {
    const e = withBox();
    expect(e.scaleSelection(50, 200)).toBe(true);
    // About the centre (200, 150): 100 wide and 200 high around the same centre.
    expect([art(e).x, art(e).y, art(e).width, art(e).height]).toEqual([150, 50, 100, 200]);
    expect(art(e).strokeWidth).toBe(2);
    e.undo();
    e.scaleSelection(200, 200, { scaleStrokes: true });
    expect(art(e).strokeWidth).toBeCloseTo(4, 9);
  });

  it('scales a copy and leaves the original where it was', () => {
    const e = withBox();
    e.scaleSelection(50, 50, { copy: true });
    expect(e.document().layers).toHaveLength(2);
    expect(art(e).width).toBe(200);
    expect(e.selected()!.width).toBe(100);
  });

  it('refuses a scale of zero', () => {
    const e = withBox();
    expect(e.scaleSelection(0, 100)).toBe(false);
  });
});

describe('the Shear dialog', () => {
  it('shears along the horizontal axis clockwise about the pivot, keeping the kind', () => {
    const e = withBox();
    e.setPivot({ x: 100, y: 200 });
    e.shearSelection(45, 0);
    const l = art(e);
    expect(l.kind).toBe('rectangle');
    // The top left corner, 100 above the pivot, moves right by 100; the bottom stays.
    expect(corner(l, 0, 0).x).toBeCloseTo(200, 6);
    expect(corner(l, 0, 1).x).toBeCloseTo(100, 6);
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
  });

  it('shears along the vertical axis and refuses a right angle', () => {
    const e = withBox();
    e.setPivot({ x: 100, y: 100 });
    e.shearSelection(30, 90);
    expect(corner(art(e), 1, 0).y).toBeCloseTo(100 + 200 * Math.tan(Math.PI / 6), 6);
    expect(e.shearSelection(90, 0)).toBe(false);
    expect(e.shearSelection(400, 0)).toBe(false);
  });
});

describe('the Shear tool', () => {
  it('shears along the axis the drag starts in, the pressed point following the pointer', () => {
    const e = withBox();
    e.setTool('shear');
    e.setPivot({ x: 100, y: 200 });
    drag(e, { x: 200, y: 100 }, { x: 250, y: 100 });
    const l = art(e);
    // Sideways from 100 above the pivot: a horizontal shear that moves the top by 50.
    expect(corner(l, 0, 0).x).toBeCloseTo(150, 6);
    expect(corner(l, 0, 1).x).toBeCloseTo(100, 6);
    e.undo();
    expect(art(e).skewX ?? 0).toBe(0);
  });

  it('keeps the original height with Shift, and stretches without it', () => {
    const free = withBox();
    free.setTool('shear');
    free.setPivot({ x: 100, y: 200 });
    drag(free, { x: 200, y: 100 }, { x: 250, y: 50 });
    expect(corner(art(free), 0, 0).y).toBeCloseTo(50, 6);
    const held = withBox();
    held.setTool('shear');
    held.setPivot({ x: 100, y: 200 });
    drag(held, { x: 200, y: 100 }, { x: 250, y: 50 }, { shift: true });
    expect(corner(art(held), 0, 0).y).toBeCloseTo(100, 6);
  });

  it('sets the reference point with a click', () => {
    const e = withBox();
    e.setTool('shear');
    e.start({ x: 120, y: 130 });
    e.end();
    expect(e.pivot()).toEqual({ x: 120, y: 130 });
    expect(art(e).x).toBe(100);
  });
});

describe('the Scale tool', () => {
  it('scales each axis so the pressed point follows the pointer', () => {
    const e = withBox();
    e.setTool('scale');
    e.setPivot({ x: 100, y: 100 });
    drag(e, { x: 300, y: 200 }, { x: 200, y: 300 });
    expect([art(e).x, art(e).y, art(e).width, art(e).height]).toEqual([100, 100, 100, 200]);
  });

  it('keeps proportions on a diagonal Shift drag and one axis on a straight one', () => {
    const e = withBox();
    e.setTool('scale');
    e.setPivot({ x: 100, y: 100 });
    drag(e, { x: 300, y: 200 }, { x: 400, y: 300 }, { shift: true });
    expect(art(e).width / art(e).height).toBeCloseTo(2, 9);
    const f = withBox();
    f.setTool('scale');
    f.setPivot({ x: 100, y: 100 });
    drag(f, { x: 300, y: 200 }, { x: 400, y: 205 }, { shift: true });
    expect([art(f).width, art(f).height]).toEqual([300, 100]);
  });
});

describe('Transform Each and Transform Again', () => {
  it('scales every object about its own centre', () => {
    const e = withBox();
    e.document.update((d) => ({ ...d, layers: [...d.layers, { ...newLayer('rectangle', 'two', { x: 400, y: 100 }), width: 100, height: 100 }] }));
    e.selectAll();
    e.transformEach({ scaleX: 50, scaleY: 50, moveX: 10, moveY: 0, rotation: 0 });
    const [a, b] = e.document().layers;
    expect([a.x, a.y, a.width]).toEqual([160, 125, 100]);
    expect([b.x, b.y, b.width]).toEqual([435, 125, 50]);
  });

  it('turns about a corner of each object when that reference point is chosen', () => {
    const e = withBox();
    e.transformEach({ scaleX: 100, scaleY: 100, moveX: 0, moveY: 0, rotation: 90, reference: 'top-left' });
    // A positive angle turns counterclockwise on screen: the box now hangs above its corner.
    expect(corner(art(e), 1, 0).x).toBeCloseTo(100, 6);
    expect(corner(art(e), 1, 0).y).toBeCloseTo(-100, 6);
  });

  it('repeats a shear with Ctrl+D about the same point', () => {
    const e = withBox();
    e.setPivot({ x: 100, y: 200 });
    e.shearSelection(20, 0);
    e.transformAgain();
    const expected = 100 + 100 * Math.tan((20 * Math.PI) / 180) * 2;
    expect(corner(art(e), 0, 0).x).toBeCloseTo(expected, 3);
  });
});
