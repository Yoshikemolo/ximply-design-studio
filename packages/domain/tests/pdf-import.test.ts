import { describe, expect, it } from 'vitest';
import { blankDocument, newLayer } from '../src/document';
import { pdfDocument } from '../src/pdf';
import { pdfArtwork, pdfColour, pdfFirstPage, pdfObjects } from '../src/pdf-import';

const bytes = (text: string) => Uint8Array.from([...text].map((character) => character.charCodeAt(0) & 0xff));
const page = { mediaBox: [0, 0, 300, 150] as [number, number, number, number], contents: [1] };
const POINTS = 96 / 72;

describe('pdf reader', () => {
  it('finds the objects and the page of a file written by this editor', () => {
    const document = { ...blankDocument(), width: 400, height: 200, background: '#ffffff',
      layers: [{ ...newLayer('rectangle', 'a', { x: 10, y: 20 }), width: 100, height: 50, fill: '#ff0000', stroke: 'none' }] };
    const { data } = pdfDocument([{ document }]);
    const objects = pdfObjects(bytes(data));
    const found = pdfFirstPage(objects);
    // The page is the exported document, in points.
    expect(found.mediaBox).toEqual([0, 0, 300, 150]);
    expect(found.contents).toHaveLength(1);
    expect(objects.get(found.contents[0])?.stream).toBeTruthy();
  });

  it('reads back the artwork this editor wrote, with its place and colour', () => {
    const document = { ...blankDocument(), width: 400, height: 200, background: 'none',
      layers: [{ ...newLayer('rectangle', 'a', { x: 10, y: 20 }), width: 100, height: 50, fill: '#ff0000', stroke: 'none' }] };
    const { data } = pdfDocument([{ document }]);
    const objects = pdfObjects(bytes(data));
    const found = pdfFirstPage(objects);
    const stream = objects.get(found.contents[0])!.stream!;
    const content = data.slice(stream.start, stream.end);
    const result = pdfArtwork(content, found, { name: 'Round trip.pdf' });
    expect(result.layers).toHaveLength(1);
    const [layer] = result.layers;
    // The square returns to the pixels it was drawn at.
    expect([Math.round(layer.x), Math.round(layer.y)]).toEqual([10, 20]);
    expect([Math.round(layer.width), Math.round(layer.height)]).toEqual([100, 50]);
    expect(layer.fill).toBe('#ff0000');
    expect(layer.stroke).toBe('none');
    expect(layer.groupPath).toEqual(['Round trip.pdf']);
    expect(result.size).toEqual({ width: 300 * POINTS, height: 150 * POINTS });
  });

  it('reads paths, colours and strokes of a handwritten stream', () => {
    const content = [
      '1 0 0 RG 0 0 1 rg 2 w',
      '10 10 m 110 10 l 110 60 l h B',
      'q 2 0 0 2 0 0 cm 0.5 g 5 5 m 5 15 15 15 15 5 c f Q',
      '0 0 0 0 k 20 20 40 30 re f',
    ].join('\n');
    const result = pdfArtwork(content, page, {});
    expect(result.layers).toHaveLength(3);
    const [triangle, curve, rectangle] = result.layers;
    // A filled and stroked triangle keeps both paints and the width of the stroke.
    expect(triangle.fill).toBe('#0000ff');
    expect(triangle.stroke).toBe('#ff0000');
    expect(triangle.strokeWidth).toBeCloseTo(2 * POINTS, 6);
    expect(triangle.curves![0].closed).toBe(true);
    // The page is turned upright: a point ten above the bottom lands ten above the bottom edge.
    expect(Math.round(triangle.y + triangle.height)).toBe(Math.round((150 - 10) * POINTS));
    // Grey with a doubling transform: half grey and twice the size.
    expect(curve.fill).toBe('#808080');
    expect(Math.round(curve.width)).toBe(Math.round(20 * POINTS));
    // Zero ink in every plate is white.
    expect(rectangle.fill).toBe('#ffffff');
    expect(Math.round(rectangle.width)).toBe(Math.round(40 * POINTS));
  });

  it('turns colour operands into paints by how many there are', () => {
    expect(pdfColour([0])).toBe('#000000');
    expect(pdfColour([1])).toBe('#ffffff');
    expect(pdfColour([1, 0, 0])).toBe('#ff0000');
    // Cyan ink alone leaves green and blue, and black ink darkens everything.
    expect(pdfColour([1, 0, 0, 0])).toBe('#00ffff');
    expect(pdfColour([0, 0, 0, 1])).toBe('#000000');
  });

  it('reports what it cannot represent and refuses what it cannot read', () => {
    const content = 'q 0 0 100 100 re W n BT (Hello) Tj ET /Im0 Do 10 10 m 20 20 l S Q';
    const result = pdfArtwork(content, page, {});
    expect(result.skipped.sort()).toEqual(['clipping paths', 'placed objects', 'text']);
    expect(result.layers).toHaveLength(1);
    expect(() => pdfArtwork('q Q', page, {})).toThrow(/no content/);
    expect(() => pdfObjects(bytes('not a pdf'))).toThrow(/not a PDF/);
    expect(() => pdfFirstPage(new Map())).toThrow(/no page/);
    expect(() => pdfArtwork('0 0 m 10 10 l f '.repeat(20), page, { limits: { maxCharacters: 1e6, maxElements: 5, maxNodes: 1e6 } }))
      .toThrow(/element limit/i);
  });
});
