// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { commandsToCurves } from '../src/app/font-outlines';
import { newLayer } from '../../../packages/domain/src/document';
import { anchor } from '../../../packages/domain/src/curves';
import { bundledFace, faceFile } from '../../../packages/domain/src/text-layout';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

function withLine() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({
    ...document,
    layers: [{
      ...newLayer('path', 'line', { x: 0, y: 0 }), width: 100, height: 1,
      stroke: '#ff0000', fill: 'none', strokeWidth: 10,
      strokeStyle: { cap: 'butt' as const, join: 'round' as const, alignment: 'center' as const },
      curves: [{ closed: false, nodes: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }],
    }],
  }));
  e.selectLayer('line');
  return e;
}

beforeEach(() => localStorage.clear());
describe('outline stroke', () => {
  it('replaces the line with the shape it painted, in one step', () => {
    const e = withLine();
    expect(e.outlineStrokeSelection()).toBe(true);
    const [shape] = e.document().layers;
    expect(shape.kind).toBe('path');
    // The band carries the colour the stroke had and no stroke of its own.
    expect(shape.fill).toBe('#ff0000');
    expect(shape.stroke).toBe('none');
    expect(shape.curves![0].closed).toBe(true);
    expect(Math.round(shape.height)).toBe(10);
    expect(Math.round(shape.width)).toBe(100);
    expect(e.selectedLayers().map((layer) => layer.id)).toEqual([shape.id]);
    e.undo();
    expect(e.document().layers[0].id).toBe('line');
  });

  it('keeps the fill of a shape as the object under its new band', () => {
    const e = withLine();
    e.document.update((document) => ({
      ...document,
      layers: document.layers.map((layer) => ({
        ...layer, fill: '#0000ff',
        curves: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }].map(anchor) }],
      })),
    }));
    e.selectLayer('line');
    expect(e.outlineStrokeSelection()).toBe(true);
    const layers = e.document().layers;
    expect(layers).toHaveLength(2);
    expect(layers[0].fill).toBe('#0000ff');
    expect(layers[0].stroke).toBe('none');
    expect(layers[1].fill).toBe('#ff0000');
  });

  it('says so when there is no stroke to outline', () => {
    const e = withLine();
    e.setPaint('stroke', 'none');
    expect(e.outlineStrokeSelection()).toBe(false);
    expect(e.status()).toContain('no stroke to outline');
  });
});

describe('text outlines', () => {
  it('reads the commands of a font as cubic contours', () => {
    const curves = commandsToCurves([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'Q', x1: 15, y1: 5, x: 10, y: 10 },
      { type: 'C', x1: 8, y1: 12, x2: 2, y2: 12, x: 0, y: 10 },
      { type: 'Z' },
    ]);
    expect(curves).toHaveLength(1);
    expect(curves[0].closed).toBe(true);
    expect(curves[0].nodes).toHaveLength(4);
    // A quadratic apex at (15, 5) gives cubic controls two thirds of the way there.
    expect(curves[0].nodes[1].outgoing.x).toBeCloseTo(10 + (2 / 3) * 5, 6);
    expect(curves[0].nodes[2].incoming.y).toBeCloseTo(10 - (2 / 3) * 5, 6);
    expect(curves[0].nodes[3].incoming).toEqual({ x: 2, y: 12 });
  });

  it('carries the faces it outlines with and names them by family, weight and style', () => {
    expect(bundledFace('Arial')).toEqual({ face: 'Arimo', exact: true });
    expect(bundledFace('Times New Roman')).toEqual({ face: 'Tinos', exact: true });
    expect(bundledFace('monospace')).toEqual({ face: 'Cousine', exact: true });
    // A family with no carried twin is outlined with the closest one, which is reported.
    expect(bundledFace('Verdana')).toEqual({ face: 'Arimo', exact: false });
    expect(faceFile('Arimo', 700, 'italic')).toBe('arimo-700-italic.woff');
    expect(faceFile('Tinos', 400, 'normal')).toBe('tinos-400-normal.woff');
    for (const file of ['arimo-400-normal.woff', 'tinos-700-normal.woff', 'cousine-400-italic.woff']) {
      expect(readFileSync(`apps/web/public/assets/fonts/${file}`).length).toBeGreaterThan(1000);
    }
  });

  it('uses the Illustrator key and refuses a selection without text', async () => {
    expect(defaultShortcuts()['outlineText']).toEqual(['Mod+Shift+O']);
    const e = withLine();
    expect(await e.outlineTextSelection()).toBe(false);
    expect(e.status()).toContain('Select the text');
  });
});
