// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { blankDocument, newLayer, parseDocument, svgExport, MIN_LAYER_SIZE } from '../../../packages/domain/src/document';
import { pdfDocument } from '../../../packages/domain/src/pdf';
import { anchor } from '../../../packages/domain/src/curves';
import { readFileSync } from 'node:fs';

const wedge = () => ({
  ...newLayer('path', 'open', { x: 0, y: 0 }), width: 100, height: 60,
  fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2,
  curves: [{ closed: false, nodes: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 60 })] }],
});
const document = (layers: ReturnType<typeof wedge>[]) => ({ ...blankDocument(), layers });

beforeEach(() => localStorage.clear());
describe('filling an open path', () => {
  it('paints the fill of an open contour and keeps its stroke open, in SVG', () => {
    const svg = svgExport(document([wedge()]));
    const paths = svg.match(/<path[^>]+>/g)!;
    // The first path carries the fill and holds the whole contour; the second strokes it.
    expect(paths[0]).toContain('fill="#ff0000"');
    expect(paths[0]).toContain('100 60');
    expect(paths[0]).not.toContain(' Z');
    expect(paths[1]).toContain('fill="none"');
    expect(paths[1]).toContain('stroke="#0000ff"');
  });

  it('paints it in a PDF as a closed shape, with the stroke left open', () => {
    const { data } = pdfDocument([{ document: { ...document([wedge()]), background: 'none' } }]);
    const content = data.slice(data.indexOf('stream'), data.indexOf('endstream'));
    const fill = content.slice(content.indexOf('1 0 0 rg'), content.indexOf('f*'));
    const stroke = content.slice(content.indexOf('0 0 1 RG'));
    // The filled copy of the contour closes; the stroked one does not.
    expect(fill).toContain(' h');
    expect(stroke.slice(0, stroke.indexOf('S'))).not.toContain(' h');
  });

  it('keeps the canvas painting every contour of a layer that carries a fill', () => {
    const renderer = readFileSync('packages/renderer/src/canvas-renderer.ts', 'utf-8');
    const block = renderer.slice(renderer.indexOf('if (l.curves) {'), renderer.indexOf('if (hasStroke) {'));
    expect(block).toContain('for (const path of drawn) this.curve(ctx, path);');
  });
});

describe('documents of scaled drawings', () => {
  it('accepts a layer thinner than a pixel, which a scaled drawing produces', () => {
    const thin = { ...wedge(), width: 0.78, height: 0.7 };
    expect(() => parseDocument(JSON.stringify(document([thin])))).not.toThrow();
    expect(MIN_LAYER_SIZE).toBeLessThan(1);
    // A size of zero is still refused, since a layer with no extent cannot be drawn.
    const empty = { ...wedge(), width: 0, height: 10 };
    expect(() => parseDocument(JSON.stringify(document([empty])))).toThrow(/layer size/i);
  });
});
