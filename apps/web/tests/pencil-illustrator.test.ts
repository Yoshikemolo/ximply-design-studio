// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { flatten, worldPoint } from '../../../packages/domain/src/curves';
import { Layer, Point } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const paths = (e: EditorService) => e.document().layers.filter((layer) => layer.curves?.length);
const ends = (layer: Layer) => {
  const nodes = layer.curves![0].nodes;
  return [worldPoint(layer, nodes[0].point), worldPoint(layer, nodes[nodes.length - 1].point)];
};
/** A wavy stroke with a little tremor, sampled the way pointer events arrive. */
const wave = (from = 100, to = 500, y = 200): Point[] =>
  Array.from({ length: Math.round((to - from) / 2) + 1 }, (_, i) => ({ x: from + i * 2, y: y + Math.sin(i / 20) * 40 + Math.sin(i * 1.3) }));
function stroke(e: EditorService, points: Point[], modifiers: { alt?: boolean; ctrl?: boolean } = {}, pressModifiers: { alt?: boolean } = {}) {
  e.start(points[0], pressModifiers);
  for (const p of points.slice(1)) e.move(p, modifiers);
  e.end();
}
function pencil() {
  const e = new EditorService();
  e.setTool('path');
  return e;
}

describe('the Pencil', () => {
  it('fits the stroke with Bezier curves instead of keeping every sample', () => {
    const e = pencil();
    const points = wave();
    stroke(e, points);
    const layer = paths(e)[0];
    expect(layer.curves![0].nodes.length).toBeLessThan(points.length / 8);
    expect(layer.curves![0].nodes.some((n) => n.smooth)).toBe(true);
    const [start, end] = ends(layer);
    expect(start.x).toBeCloseTo(points[0].x, 3);
    expect(end.x).toBeCloseTo(points.at(-1)!.x, 3);
  });

  it('keeps the new path selected and unfilled by default, as the options say', () => {
    const e = pencil();
    stroke(e, wave());
    const layer = paths(e)[0];
    expect(e.selectedId()).toBe(layer.id);
    expect(layer.fill).toBe('none');
    localStorage.clear();
    const f = pencil();
    f.pencilOptions.update((o) => ({ ...o, keepSelected: false, fill: true }));
    stroke(f, wave());
    expect(f.selectedId()).toBeNull();
    expect(paths(f)[0].fill).not.toBe('none');
  });

  it('sets down fewer anchors as the fidelity rises', () => {
    const counts = [0.5, 20].map((fidelity) => {
      localStorage.clear();
      const e = pencil();
      e.pencilOptions.update((o) => ({ ...o, fidelity }));
      stroke(e, wave());
      return paths(e)[0].curves![0].nodes.length;
    });
    expect(counts[1]).toBeLessThan(counts[0]);
  });

  it('closes the path when Alt is held as the button is released', () => {
    const e = pencil();
    const arc = Array.from({ length: 120 }, (_, i) => ({ x: 300 + Math.cos(i / 22) * 100, y: 300 + Math.sin(i / 22) * 100 }));
    stroke(e, arc, { alt: true });
    expect(paths(e)[0].curves![0].closed).toBe(true);
  });

  it('extends a selected open path from the end it starts at', () => {
    const e = pencil();
    stroke(e, wave(100, 300));
    const before = paths(e)[0].curves![0].nodes.length;
    stroke(e, wave(300, 500).map((p) => ({ x: p.x, y: p.y - wave(300, 500)[0].y + ends(paths(e)[0])[1].y })));
    expect(paths(e)).toHaveLength(1);
    const layer = paths(e)[0];
    expect(layer.curves![0].nodes.length).toBeGreaterThan(before);
    expect(ends(layer)[1].x).toBeCloseTo(500, 0);
  });

  it('redraws a selected path from the point the stroke starts on to the point it ends on', () => {
    const e = pencil();
    const line = Array.from({ length: 201 }, (_, i) => ({ x: 100 + i * 2, y: 200 }));
    stroke(e, line);
    const redraw = Array.from({ length: 101 }, (_, i) => ({ x: 200 + i * 2, y: 200 - Math.sin((i / 100) * Math.PI) * 60 }));
    stroke(e, redraw);
    expect(paths(e)).toHaveLength(1);
    const layer = paths(e)[0];
    const [start, end] = ends(layer);
    expect(start.x).toBeCloseTo(100, 0);
    expect(end.x).toBeCloseTo(500, 0);
    // The curve itself rises where the stroke did, whatever its anchors do.
    const top = Math.min(...flatten(layer.curves![0], 24).map((p) => worldPoint(layer, p).y));
    expect(top).toBeLessThan(170);
  });

  it('draws a new path when editing selected paths is turned off', () => {
    const e = pencil();
    stroke(e, wave(100, 300));
    e.pencilOptions.update((o) => ({ ...o, editSelected: false }));
    stroke(e, wave(300, 500));
    expect(paths(e)).toHaveLength(2);
  });

  it('becomes the Smooth tool while Alt is held as the stroke starts', () => {
    const e = pencil();
    const jagged = Array.from({ length: 201 }, (_, i) => ({ x: 100 + i * 2, y: 200 + (i % 2 ? 6 : -6) }));
    e.pencilOptions.update((o) => ({ ...o, fidelity: 0.5 }));
    stroke(e, jagged);
    const before = paths(e)[0].curves![0].nodes.length;
    stroke(e, Array.from({ length: 101 }, (_, i) => ({ x: 150 + i * 3, y: 200 })), {}, { alt: true });
    expect(paths(e)).toHaveLength(1);
    expect(paths(e)[0].curves![0].nodes.length).toBeLessThan(before);
  });
});

describe('the Smooth tool', () => {
  it('smooths only the stretch it is dragged along and keeps the ends', () => {
    const e = pencil();
    e.pencilOptions.update((o) => ({ ...o, fidelity: 0.5 }));
    const jagged = Array.from({ length: 201 }, (_, i) => ({ x: 100 + i * 2, y: 200 + (i % 2 ? 6 : -6) }));
    stroke(e, jagged);
    const [startBefore, endBefore] = ends(paths(e)[0]);
    const before = paths(e)[0].curves![0].nodes.length;
    e.setTool('smooth');
    stroke(e, Array.from({ length: 51 }, (_, i) => ({ x: 200 + i * 4, y: 200 })));
    const layer = paths(e)[0];
    expect(layer.curves![0].nodes.length).toBeLessThan(before);
    const [start, end] = ends(layer);
    expect(start.x).toBeCloseTo(startBefore.x, 3);
    expect(end.x).toBeCloseTo(endBefore.x, 3);
  });
});
