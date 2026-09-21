import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, it, expect } from 'vitest';
import { blankDocument, newLayer, parseDocument, svgExport, validDashPattern, Layer } from '../../domain/src/document';
import { CanvasRenderer } from '../src/canvas-renderer';

function dashed(dash?: number[]): Layer {
  return { ...newLayer('path', 'line', { x: 0, y: 40 }, 'none', '#ff0000', 4), width: 160, height: 1, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }], strokeStyle: { alignment: 'center', join: 'miter', cap: 'butt', ...(dash ? { dash } : {}) } };
}
async function images(layer: Layer) {
  const doc = { ...blankDocument(), width: 160, height: 80, background: '#ffffff', layers: [layer] };
  const canvas = createCanvas(160, 80);
  new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement, doc, null, () => {});
  const svg = createCanvas(160, 80);
  svg.getContext('2d').drawImage(await loadImage(Buffer.from(svgExport(doc))), 0, 0);
  return [canvas.getContext('2d'), svg.getContext('2d')];
}
const red = (ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, x: number) => ctx.getImageData(x, 40, 1, 1).data[0] === 255 && ctx.getImageData(x, 40, 1, 1).data[1] === 0;

describe('dashed strokes', () => {
  it('draws the dash sequence identically on Canvas and in SVG', async () => {
    // 12 on, 6 off from x=0: x=6 is inside the first dash, x=15 inside the first gap, x=20 inside the second dash.
    for (const ctx of await images(dashed([12, 6]))) {
      expect(red(ctx, 6)).toBe(true);
      expect(red(ctx, 15)).toBe(false);
      expect(red(ctx, 20)).toBe(true);
    }
  });

  it('keeps a solid line when no pattern is set', async () => {
    for (const ctx of await images(dashed())) for (const x of [6, 15, 20]) expect(red(ctx, x)).toBe(true);
  });

  it('accepts up to six alternating lengths and rejects unusable patterns', () => {
    for (const dash of [[4], [4, 2], [24, 6, 4, 6], [1, 2, 3, 4, 5, 6]]) expect(validDashPattern(dash)).toBe(true);
    for (const dash of [[], [0], [0, 4], [-1, 4], [1, 2, 3, 4, 5, 6, 7], [4, '2'], [Infinity, 2], [1001, 2]]) expect(validDashPattern(dash)).toBe(false);
  });

  it('round trips a pattern through the native format and rejects an invalid one', () => {
    const doc = { ...blankDocument(), layers: [dashed([24, 6, 4, 6])] };
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    expect(() => parseDocument(JSON.stringify({ ...blankDocument(), layers: [dashed([0, 0])] }))).toThrow();
    expect(() => parseDocument(JSON.stringify({ ...blankDocument(), version: 1, layers: [dashed([12, 6])] }))).toThrow();
  });
});
