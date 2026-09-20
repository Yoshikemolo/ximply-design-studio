import { describe, expect, it } from 'vitest';
import { blankDocument, newLayer, StudioDocument } from '../src/document';
import { pathOperators, pdfDocument, pdfText } from '../src/pdf';

const POINTS = 72 / 96;
const page = (layers = [] as ReturnType<typeof newLayer>[], overrides: Partial<StudioDocument> = {}): StudioDocument =>
  ({ ...blankDocument(), width: 400, height: 200, background: '#ffffff', layers, ...overrides });
const square = () => ({ ...newLayer('rectangle', 'a', { x: 10, y: 20 }), width: 100, height: 50, fill: '#ff0000', stroke: '#0000ff', strokeWidth: 4 });

describe('pdf writer', () => {
  it('writes a file with the structure a reader needs', () => {
    const { data } = pdfDocument([{ document: page([square()]) }]);
    expect(data.startsWith('%PDF-1.4')).toBe(true);
    expect(data.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(data).toContain('/Type /Catalog');
    expect(data).toContain('/Type /Pages');
    expect(data).toContain('/Count 1');
    // The page is the document in points, not in pixels.
    expect(data).toContain(`/MediaBox [0 0 ${400 * POINTS} ${200 * POINTS}]`);
    // Every object offset in the table points at the object that declares itself there.
    const start = Number(data.slice(data.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    expect(data.slice(start, start + 4)).toBe('xref');
    const offsets = [...data.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(Number(data.match(/\/Size (\d+)/)![1]) - 1);
    offsets.forEach((offset, index) => {
      expect(data.slice(offset, offset + 12)).toContain(`${index + 1} 0 obj`);
    });
  });

  it('writes one page per document, each with its own size', () => {
    const { data } = pdfDocument([
      { document: page([square()]) },
      { document: page([], { width: 100, height: 300 }) },
    ]);
    expect(data).toContain('/Count 2');
    expect((data.match(/\/Type \/Page[^s]/g) ?? [])).toHaveLength(2);
    expect(data).toContain(`/MediaBox [0 0 ${100 * POINTS} ${300 * POINTS}]`);
  });

  it('draws shapes as vector paths with their fill, stroke and dashes', () => {
    const dashed = { ...square(), strokeStyle: { cap: 'round' as const, join: 'bevel' as const, alignment: 'center' as const, dash: [6, 3] } };
    const { data } = pdfDocument([{ document: page([dashed]) }]);
    // Red fill and blue stroke arrive as device colours.
    expect(data).toContain('1 0 0 rg');
    expect(data).toContain('0 0 1 RG');
    expect(data).toContain('4 w 1 J 2 j [6 3] 0 d');
    // The square starts at its first corner and closes.
    expect(data).toContain('10 20 m');
    // Straight sides keep their handles on the corners they join.
    expect(data).toContain('10 20 110 20 110 20 c');
    expect(data).toContain('110 70 10 70 10 70 c');
    expect(data).toMatch(/f\*/);
    // The whole page is flipped once, since PDF measures upwards.
    expect(data).toContain(`${POINTS.toFixed(3).replace(/0+$/, '')} 0 0 -${POINTS.toFixed(3).replace(/0+$/, '')} 0 ${(200 * POINTS).toString()} cm`);
  });

  it('uses one alpha state per transparency and none when everything is opaque', () => {
    const opaque = pdfDocument([{ document: page([square()]) }]).data;
    expect(opaque).toContain('/ExtGState');
    expect(opaque).toContain('/ca 1');
    const faded = pdfDocument([{ document: page([{ ...square(), fill: '#ff000080', opacity: 0.5 }]) }]).data;
    expect(faded).toContain('/ca 0.251');
  });

  it('writes text as characters with the standard font and reports what it changed', () => {
    const text = { ...newLayer('text', 'b', { x: 5, y: 5 }), text: 'Plan (final) 1/2', fontSize: 20, fill: '#000000' };
    const { data, skipped } = pdfDocument([{ document: page([text]) }]);
    expect(data).toContain('/BaseFont /Helvetica');
    expect(data).toContain('/F1 20 Tf');
    // Parentheses are escaped so the string stays balanced.
    expect(data).toContain('(Plan \\(final\\) 1/2) Tj');
    // The page is flipped once, so the text matrix flips back and the glyphs stand upright.
    expect(data).toContain('1 0 0 -1 5 25 Tm');
    expect(skipped).toContain('text is drawn with the standard font');
    expect(pdfText('añ→b')).toEqual({ text: 'añ?b', dropped: true });
    expect(pdfText('a(b)\\c').text).toBe('a\\(b\\)\\\\c');
  });

  it('places a prepared image and reports one that is missing', () => {
    const image = { ...newLayer('image', 'c', { x: 0, y: 0 }), width: 40, height: 20 };
    const withData = pdfDocument([{ document: page([image]), images: { c: { data: '\xff\xd8\xff\xdb', width: 40, height: 20 } } }]);
    expect(withData.data).toContain('/Filter /DCTDecode');
    expect(withData.data).toContain('/Im0 Do');
    expect(withData.skipped).not.toContain('images');
    expect(pdfDocument([{ document: page([image]) }]).skipped).toContain('images');
  });

  it('paints the page background and refuses a file without pages', () => {
    const { data } = pdfDocument([{ document: page([], { background: '#112233' }) }]);
    expect(data).toContain('0.067 0.133 0.2 rg');
    expect(data).toContain('0 0 400 200 re f');
    const transparent = pdfDocument([{ document: page([], { background: 'none' }) }]).data;
    expect(transparent).not.toContain('re f');
    expect(() => pdfDocument([])).toThrow(/at least one page/);
  });

  it('draws every visible layer of a document and leaves out guides and hidden work', () => {
    const drawing = page([
      { ...square(), id: 'shape' },
      { ...newLayer('ellipse', 'round', { x: 200, y: 20 }), width: 60, height: 60, fill: '#00ff00' },
      { ...newLayer('path', 'line', { x: 0, y: 0 }), points: [{ x: 5, y: 5 }, { x: 40, y: 60 }], stroke: '#000000', strokeWidth: 2 },
      { ...newLayer('rectangle', 'hidden', { x: 0, y: 0 }), width: 10, height: 10, visible: false, fill: '#123456' },
      { ...newLayer('rectangle', 'guide', { x: 0, y: 0 }), width: 10, height: 10, guide: true, fill: '#654321' },
    ]);
    const { data } = pdfDocument([{ document: drawing }]);
    const content = data.slice(data.indexOf('stream'), data.indexOf('endstream'));
    // The square, the ellipse and the line each paint; the hidden layer and the guide do not.
    expect(content).toContain('1 0 0 rg');
    expect(content).toContain('0 1 0 rg');
    expect(content).toContain('5 5 m');
    expect(content).not.toContain('0.071 0.204 0.337');
    expect(content).not.toContain('0.396 0.263 0.129');
    expect((content.match(/^(f\*|S) Q$/gm) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('writes contours as cubic segments in the order they are drawn', () => {
    const operators = pathOperators([{ closed: false, nodes: [
      { point: { x: 0, y: 0 }, incoming: { x: 0, y: 0 }, outgoing: { x: 10, y: 0 }, smooth: false },
      { point: { x: 20, y: 0 }, incoming: { x: 15, y: 0 }, outgoing: { x: 20, y: 0 }, smooth: false },
    ] }]);
    expect(operators).toBe('0 0 m 10 0 15 0 20 0 c');
  });
});
