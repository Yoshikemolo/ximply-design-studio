import { describe, expect, it } from 'vitest';
import {
  GradientPaint, cmykToRgb, defaultSwatches, gradientColorAt, gradientGeometry, grayToRgb, mixColors, presetPattern,
  renderedStops, rgbToCmyk, rgbToGray, validFillPaint, validGradient, validSwatch,
} from '../src/paint';

const blackWhite = (extra: Partial<GradientPaint> = {}): GradientPaint => ({
  kind: 'gradient', type: 'linear', angle: 0,
  stops: [{ color: '#000000', location: 0, midpoint: 50 }, { color: '#ffffff', location: 100, midpoint: 50 }],
  ...extra,
});

describe('gradients', () => {
  it('run a linear gradient across the whole box along its angle', () => {
    expect(gradientGeometry(blackWhite(), 200, 100)).toEqual({ start: { x: 0, y: 50 }, end: { x: 200, y: 50 }, radius: 200 });
    const up = gradientGeometry(blackWhite({ angle: 90 }), 200, 100);
    // 90 degrees runs from the bottom to the top, as in Illustrator.
    expect(up.start.x).toBeCloseTo(100, 9);
    expect(up.start.y).toBeCloseTo(100, 9);
    expect(up.end.y).toBeCloseTo(0, 9);
  });

  it('centre a radial gradient and reach the farther side', () => {
    const g = gradientGeometry(blackWhite({ type: 'radial' }), 200, 100);
    expect(g.start).toEqual({ x: 100, y: 50 });
    expect(g.radius).toBe(100);
  });

  it('follow the line the Gradient tool drew', () => {
    const g = gradientGeometry(blackWhite({ vector: { start: { x: 0.25, y: 0.5 }, end: { x: 0.75, y: 0.5 } } }), 200, 100);
    expect(g).toEqual({ start: { x: 50, y: 50 }, end: { x: 150, y: 50 }, radius: 100 });
  });

  it('write a moved midpoint as a stop holding the even mix', () => {
    const paint = blackWhite();
    paint.stops[0].midpoint = 25;
    expect(renderedStops(paint)).toEqual([
      { offset: 0, color: '#000000' }, { offset: 0.25, color: '#808080' }, { offset: 1, color: '#ffffff' },
    ]);
    expect(gradientColorAt(paint, 0.25)).toBe('#808080');
    expect(renderedStops(blackWhite())).toHaveLength(2);
  });

  it('accept only well-formed gradients', () => {
    expect(validGradient(blackWhite())).toBe(true);
    expect(validGradient({ ...blackWhite(), stops: [blackWhite().stops[0]] })).toBe(false);
    expect(validGradient({ ...blackWhite(), angle: 400 })).toBe(false);
    expect(validGradient({ ...blackWhite(), stops: [{ color: '#000000', location: 60, midpoint: 50 }, { color: '#ffffff', location: 40, midpoint: 50 }] })).toBe(false);
    expect(validGradient({ ...blackWhite(), stops: [{ color: 'red', location: 0, midpoint: 50 }, { color: '#ffffff', location: 100, midpoint: 50 }] })).toBe(false);
    expect(validGradient({ ...blackWhite(), extra: true })).toBe(false);
  });
});

describe('patterns and swatches', () => {
  it('reference only patterns the document holds', () => {
    expect(validFillPaint({ kind: 'pattern', patternId: 'p' }, new Set(['p']))).toBe(true);
    expect(validFillPaint({ kind: 'pattern', patternId: 'q' }, new Set(['p']))).toBe(false);
  });

  it('build preset tiles of their own size', () => {
    const tile = presetPattern('checker', 'c', '#ff0000', 20);
    expect([tile.width, tile.height]).toEqual([20, 20]);
    expect(tile.layers).toHaveLength(2);
    expect(tile.layers.every((l) => l.fill === '#ff0000')).toBe(true);
  });

  it('start a document with colour and gradient swatches that all validate', () => {
    const swatches = defaultSwatches();
    expect(swatches.some((s) => s.kind === 'color')).toBe(true);
    expect(swatches.some((s) => s.kind === 'gradient')).toBe(true);
    expect(swatches.every((s) => validSwatch(s, new Set()))).toBe(true);
  });
});

describe('colour models', () => {
  it('convert between RGB and CMYK by the device formula', () => {
    expect(rgbToCmyk('#ff0000')).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(rgbToCmyk('#000000')).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    expect(cmykToRgb(0, 100, 100, 0)).toBe('#ff0000');
    expect(cmykToRgb(0, 0, 0, 50)).toBe('#808080');
  });

  it('convert between RGB and a grey', () => {
    expect(rgbToGray('#ffffff')).toBe(0);
    expect(rgbToGray('#000000')).toBe(100);
    expect(grayToRgb(50)).toBe('#808080');
  });

  it('mix two colours, alpha included', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColors('#00000000', '#000000', 0.5)).toBe('#00000080');
  });
});
