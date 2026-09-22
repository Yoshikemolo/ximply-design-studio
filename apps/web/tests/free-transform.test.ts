// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer, newLayer, parseDocument } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';
import { worldCurves } from '../../../packages/domain/src/distort';

/** A 200 by 100 box at (100, 100), selected, with the Free Transform tool. */
function tool(extra: Partial<Layer>[] = [{}]) {
  localStorage.clear();
  const e = new EditorService();
  e.zoom.set(1);
  e.document.update((d) => ({ ...d, layers: extra.map((x, i) => ({ ...newLayer('rectangle', 'l' + i, { x: 100, y: 100 }), width: 200, height: 100, ...x })) }));
  e.selectAll();
  e.setTool('freeTransform');
  return e;
}
const first = (e: EditorService) => e.document().layers[0];
const drag = (e: EditorService, from: { x: number; y: number }, to: { x: number; y: number }, m: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) => {
  e.start(from, m); e.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, m); e.move(to, m); e.end(m);
};
const corner = (l: Layer, u: number, v: number) => worldPoint(l, { x: u * l.width, y: v * l.height });
beforeEach(() => localStorage.clear());

describe('the Free Transform tool', () => {
  it('moves from inside the box and scales against the opposite handle', () => {
    const e = tool();
    drag(e, { x: 150, y: 150 }, { x: 170, y: 160 });
    expect([first(e).x, first(e).y]).toEqual([120, 110]);
    e.undo();
    drag(e, { x: 300, y: 200 }, { x: 400, y: 250 });
    expect([first(e).x, first(e).y, first(e).width, first(e).height]).toEqual([100, 100, 300, 150]);
  });

  it('keeps proportions with Shift and scales from the centre with Alt', () => {
    const e = tool();
    drag(e, { x: 300, y: 200 }, { x: 500, y: 210 }, { shift: true });
    expect(first(e).width / first(e).height).toBeCloseTo(2, 9);
    const f = tool();
    drag(f, { x: 300, y: 150 }, { x: 350, y: 150 }, { alt: true });
    expect([first(f).x, first(f).width]).toEqual([50, 300]);
  });

  it('rotates from outside the box, by 45 degrees with Shift', () => {
    const e = tool();
    // About 40 degrees round the centre (200, 150), which Shift rounds to 45.
    drag(e, { x: 350, y: 150 }, { x: 315, y: 246 }, { shift: true });
    expect(Math.abs(first(e).rotation)).toBeCloseTo(45, 6);
  });

  it('shears along a side with Ctrl+Alt, keeping the height with Shift', () => {
    const e = tool();
    drag(e, { x: 200, y: 100 }, { x: 260, y: 90 }, { ctrl: true, alt: true, shift: true });
    const l = first(e);
    expect(l.kind).toBe('rectangle');
    expect(corner(l, 0, 0).x).toBeCloseTo(160, 6);
    expect(corner(l, 0, 0).y).toBeCloseTo(100, 6);
    expect(corner(l, 0, 1).x).toBeCloseTo(100, 6);
  });

  it('distorts freely from a corner with Ctrl, moving that corner alone', () => {
    const e = tool();
    drag(e, { x: 300, y: 100 }, { x: 330, y: 60 }, { ctrl: true });
    const l = first(e);
    expect(l.kind).toBe('path');
    const nodes = worldCurves(l)![0].nodes.filter((_, i) => i % 8 === 0).map((n) => n.point);
    expect(nodes[1].x).toBeCloseTo(330, 6);
    expect(nodes[1].y).toBeCloseTo(60, 6);
    expect(nodes[0].x).toBeCloseTo(100, 6);
    expect(nodes[2].y).toBeCloseTo(200, 6);
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
    e.undo();
    expect(first(e).kind).toBe('rectangle');
  });

  it('distorts in perspective with Shift+Alt+Ctrl, widening one side evenly', () => {
    const e = tool();
    drag(e, { x: 300, y: 100 }, { x: 340, y: 102 }, { ctrl: true, alt: true, shift: true });
    const nodes = worldCurves(first(e))![0].nodes.filter((_, i) => i % 8 === 0).map((n) => n.point);
    expect(nodes[1].x).toBeCloseTo(340, 6);
    expect(nodes[0].x).toBeCloseTo(60, 6);
    expect(nodes[2].x).toBeCloseTo(300, 6);
    expect(nodes[1].y).toBeCloseTo(100, 6);
  });

  it('leaves text alone when it distorts and says so', () => {
    const e = tool([{}, { kind: 'text', text: 'A' }]);
    drag(e, { x: 300, y: 100 }, { x: 330, y: 60 }, { ctrl: true });
    expect(e.document().layers[1].kind).toBe('text');
    expect(e.status()).toContain('cannot reshape');
  });

  it('shows its box at the bounds of the selection and follows the drag', () => {
    const e = tool();
    expect(e.freeTransformQuad()).toEqual([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }]);
    e.start({ x: 300, y: 100 }, { ctrl: true });
    e.move({ x: 330, y: 60 }, { ctrl: true });
    expect(e.freeQuad()![1]).toEqual({ x: 330, y: 60 });
    e.cancel();
    expect(first(e).kind).toBe('rectangle');
    expect(e.freeQuad()).toBeNull();
  });
});

describe('Ctrl during a Free Transform drag', () => {
  it('keeps the tool instead of switching to the temporary selection tool', async () => {
    await import('@angular/compiler');
    const { signal } = await import('@angular/core');
    const { AppComponent } = await import('../src/app/app.component');
    const e = tool();
    const app = Object.create(AppComponent.prototype) as InstanceType<typeof AppComponent>;
    Object.assign(app, { editor: e, temporarySelect: signal(true) });
    e.start({ x: 300, y: 100 });
    e.move({ x: 320, y: 90 }, { ctrl: true });
    expect(app.activeTool()).toBe('freeTransform');
    e.end();
    expect(app.activeTool()).not.toBe('freeTransform');
  });
});
