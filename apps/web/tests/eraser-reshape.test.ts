// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { flatten, worldPoint } from '../../../packages/domain/src/curves';
import { Layer, newLayer } from '../../../packages/domain/src/document';
import { reshapeWeights } from '../../../packages/domain/src/path-edit';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

beforeEach(() => localStorage.clear());
const paths = (e: EditorService) => e.document().layers.filter((layer) => layer.curves?.length);
function line(e: EditorService, points: Array<[number, number]>) {
  e.zoom.set(1);
  e.setTool('pen');
  for (const [x, y] of points) { e.start({ x, y }); e.end(); }
  e.finishPath();
  return paths(e).at(-1)!;
}
const sampled = (layer: Layer) => layer.curves!.flatMap((c) => flatten(c, 16).map((p) => worldPoint(layer, p)));

describe('the Eraser', () => {
  it('erases what its nib passes over and splits an open path into two objects', () => {
    const e = new EditorService();
    line(e, [[100, 200], [500, 200]]);
    e.selectedId.set(null);
    e.selectedIds.set([]);
    e.setTool('eraser');
    e.start({ x: 300, y: 150 });
    e.move({ x: 300, y: 250 });
    e.end();
    expect(paths(e)).toHaveLength(2);
    for (const layer of paths(e)) expect(sampled(layer).every((p) => Math.abs(p.x - 300) > 4)).toBe(true);
  });

  it('erases only the selected objects when some are selected', () => {
    const e = new EditorService();
    const kept = line(e, [[100, 100], [500, 100]]);
    const erased = line(e, [[100, 300], [500, 300]]);
    e.selectedIds.set([erased.id]);
    e.selectedId.set(erased.id);
    e.setTool('eraser');
    e.start({ x: 300, y: 50 });
    e.move({ x: 300, y: 350 });
    e.end();
    expect(e.document().layers.find((l) => l.id === kept.id)!.curves![0].nodes).toHaveLength(2);
    expect(paths(e).filter((l) => l.id !== kept.id)).toHaveLength(2);
  });

  it('erases a marquee drawn with Alt', () => {
    const e = new EditorService();
    line(e, [[100, 200], [500, 200]]);
    e.selectedId.set(null);
    e.selectedIds.set([]);
    e.setTool('eraser');
    e.start({ x: 200, y: 150 }, { alt: true });
    e.move({ x: 400, y: 250 }, { alt: true });
    e.end();
    const all = paths(e).flatMap(sampled);
    expect(all.every((p) => p.x <= 202 || p.x >= 398)).toBe(true);
  });

  it('takes a filled shape apart by subtraction', () => {
    const e = new EditorService();
    const square = { ...newLayer('rectangle', 'box', { x: 100, y: 100 }), width: 200, height: 200, fill: '#ff0000' };
    e.document.update((d) => ({ ...d, layers: [square] }));
    e.setTool('eraser');
    e.eraserShape.set({ angle: 0, roundness: 100, diameter: 20 });
    e.start({ x: 200, y: 50 });
    e.move({ x: 200, y: 350 });
    e.end();
    const layer = e.document().layers[0];
    expect(layer.kind).toBe('path');
    expect(layer.curves!.length).toBe(2);
  });

  it('grows and shrinks with ] and [, as in Illustrator', () => {
    expect(defaultShortcuts()['eraserLarger']).toEqual([']']);
    expect(defaultShortcuts()['eraserSmaller']).toEqual(['[']);
    const e = new EditorService();
    e.resizeEraser(1);
    expect(e.eraserShape().diameter).toBe(11);
    e.resizeEraser(-20);
    expect(e.eraserShape().diameter).toBe(1);
  });
});

describe('the Reshape tool', () => {
  it('moves the focal point all the way, its neighbours part of the way and the ends not at all', () => {
    const weights = reshapeWeights({
      closed: false,
      nodes: [0, 100, 200, 300, 400].map((x) => ({ point: { x, y: 0 }, incoming: { x, y: 0 }, outgoing: { x, y: 0 }, smooth: false })),
    }, [2]);
    expect(weights[2]).toBe(1);
    expect(weights[0]).toBe(0);
    expect(weights[4]).toBe(0);
    expect(weights[1]).toBeCloseTo(0.5, 6);
  });

  it('stretches a selected path from a focal point added on a segment', () => {
    const e = new EditorService();
    line(e, [[100, 200], [300, 200], [500, 200]]);
    e.setTool('reshape');
    e.start({ x: 200, y: 200 });
    e.move({ x: 200, y: 100 });
    e.end();
    const layer = paths(e)[0];
    const nodes = layer.curves![0].nodes.map((n) => worldPoint(layer, n.point));
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toEqual({ x: 100, y: 200 });
    expect(nodes[3]).toEqual({ x: 500, y: 200 });
    expect(nodes[1].y).toBeCloseTo(100, 6);
    expect(nodes[2].y).toBeGreaterThan(100);
    expect(nodes[2].y).toBeLessThan(200);
  });
});

describe('the Group Selection tool', () => {
  it('takes the object first and the groups around it with each further press', () => {
    const e = new EditorService();
    const shape = (id: string, x: number, groupPath: string[]) => ({ ...newLayer('rectangle', id, { x, y: 100 }), width: 50, height: 50, fill: '#000000', groupPath });
    e.document.update((d) => ({ ...d, layers: [shape('a', 100, ['outer', 'inner']), shape('b', 200, ['outer', 'inner']), shape('c', 300, ['outer'])] }));
    e.setTool('groupSelect');
    const press = () => { e.start({ x: 125, y: 125 }); e.end(); };
    press();
    expect(e.selectedIds()).toEqual(['a']);
    press();
    expect(e.selectedIds().sort()).toEqual(['a', 'b']);
    press();
    expect(e.selectedIds().sort()).toEqual(['a', 'b', 'c']);
  });

  it('is what Alt makes of the Direct Selection tool', () => {
    const e = new EditorService();
    const shape = { ...newLayer('rectangle', 'a', { x: 100, y: 100 }), width: 50, height: 50, fill: '#000000', groupPath: ['g'] };
    const other = { ...shape, id: 'b', x: 200 };
    e.document.update((d) => ({ ...d, layers: [shape, other] }));
    e.setTool('direct');
    e.start({ x: 125, y: 125 }, { alt: true });
    e.end();
    expect(e.selectedIds()).toEqual(['a']);
  });
});
