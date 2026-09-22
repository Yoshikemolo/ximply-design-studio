import { describe, expect, it } from 'vitest';
import { blankDocument, Layer, newLayer, parseDocument, svgExport } from '../src/document';
import { GradientPaint, presetPattern } from '../src/paint';

const blackWhite: GradientPaint = { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: '#000000', location: 0, midpoint: 50 }, { color: '#ffffff80', location: 100, midpoint: 50 }] };
const box = (extra: Partial<Layer> = {}): Layer => ({ ...newLayer('rectangle', 'box', { x: 5, y: 0 }, '#000000', 'none', 0), width: 100, height: 40, ...extra });
const doc = (layers: Layer[], extra = {}) => ({ ...blankDocument(), version: 2 as const, layers, ...extra });

describe('gradients and patterns in SVG', () => {
  it('write a gradient in the object coordinates, with the stop opacity', () => {
    const svg = svgExport(doc([box({ fillPaint: blackWhite })]));
    expect(svg).toContain('<linearGradient id="paint-0" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="100" y2="20">');
    expect(svg).toContain('<stop offset="1" stop-color="#ffffff" stop-opacity="0.5019607843137255"/>');
    expect(svg).toContain('<rect width="100" height="40" fill="url(#paint-0)"');
  });

  it('write a radial gradient from the centre', () => {
    const svg = svgExport(doc([box({ fillPaint: { ...blackWhite, type: 'radial' } })]));
    expect(svg).toContain('<radialGradient id="paint-0" gradientUnits="userSpaceOnUse" cx="50" cy="20" r="50">');
  });

  it('write a pattern tile laid out from the document origin', () => {
    const svg = svgExport(doc([box({ fillPaint: { kind: 'pattern', patternId: 'p' } })], { patterns: [presetPattern('dots', 'p', '#ff0000', 20)] }));
    // The object sits 5 units right of the origin, so the tile moves 5 units back.
    expect(svg).toContain('<pattern id="paint-0" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="matrix(1 0 0 1 -5 0)">');
    expect(svg).toContain('<ellipse cx="5" cy="5" rx="5" ry="5" fill="#ff0000"');
  });

  it('keep a flat colour when the fill is None', () => {
    const svg = svgExport(doc([box({ fill: 'none', fillPaint: blackWhite })]));
    expect(svg).not.toContain('linearGradient');
  });
});

describe('the native format', () => {
  const pattern = presetPattern('checker', 'p', '#ff0000', 20);
  it('round-trips gradients, patterns and swatches', () => {
    const source = doc([box({ fillPaint: blackWhite }), box({ id: 'b', fillPaint: { kind: 'pattern', patternId: 'p' } })], {
      patterns: [pattern], swatches: [{ id: 's', name: 'Red', kind: 'color', color: '#ff0000' }, { id: 't', name: 'Tile', kind: 'pattern', patternId: 'p' }],
    });
    const parsed = parseDocument(JSON.stringify(source));
    expect(parsed.layers[0].fillPaint).toEqual(blackWhite);
    expect(parsed.patterns).toEqual([pattern]);
    expect(parsed.swatches).toHaveLength(2);
  });

  it('refuses a pattern the document does not hold, and paints in format 1', () => {
    expect(() => parseDocument(JSON.stringify(doc([box({ fillPaint: { kind: 'pattern', patternId: 'gone' } })])))).toThrow();
    expect(() => parseDocument(JSON.stringify({ ...doc([box({ fillPaint: blackWhite })]), version: 1 }))).toThrow();
  });

  it('refuses a pattern tile holding a picture or text', () => {
    const bad = { ...pattern, layers: [{ ...pattern.layers[0], kind: 'text' }] };
    expect(() => parseDocument(JSON.stringify(doc([], { patterns: [bad] })))).toThrow();
  });

  it('refuses swatches sharing an id', () => {
    const swatch = { id: 's', name: 'Red', kind: 'color', color: '#ff0000' };
    expect(() => parseDocument(JSON.stringify(doc([], { swatches: [swatch, swatch] })))).toThrow();
  });
});
