import { describe, expect, it } from 'vitest';
import { blankDocument, Layer, newLayer, StudioDocument } from '../src/document';
import { GradientPaint, presetPattern } from '../src/paint';
import { gradientShading, pdfDocument } from '../src/pdf';

const fade: GradientPaint = { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: '#ff0000', location: 0, midpoint: 50 }, { color: '#0000ff', location: 100, midpoint: 50 }] };
const box = (extra: Partial<Layer> = {}): Layer => ({ ...newLayer('rectangle', 'box', { x: 20, y: 10 }, '#000000', 'none', 0), width: 100, height: 40, ...extra });
const doc = (layers: Layer[], extra: Partial<StudioDocument> = {}): StudioDocument => ({ ...blankDocument(), version: 2, width: 200, height: 100, layers, ...extra });

describe('gradients in PDF', () => {
  it('write a linear gradient as an axial shading across the object box', () => {
    const { shading, transparent } = gradientShading(fade, 100, 40);
    expect(shading).toBe('<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 20 100 20] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>');
    expect(transparent).toBe(false);
  });

  it('stitch every stop and moved midpoint into one function', () => {
    const paint = structuredClone(fade);
    paint.stops[0].midpoint = 25;
    const { shading } = gradientShading(paint, 100, 40);
    expect(shading).toContain('/FunctionType 3');
    expect(shading).toContain('/Bounds [0.25]');
    expect(shading).toContain('/Encode [0 1 0 1]');
  });

  it('write a radial gradient from the centre and keep the colour of stops that start late', () => {
    const { shading } = gradientShading({ ...fade, type: 'radial', stops: [{ color: '#ff0000', location: 20, midpoint: 50 }, { color: '#0000ff', location: 100, midpoint: 50 }] }, 100, 40);
    expect(shading).toContain('/ShadingType 3');
    expect(shading).toContain('/Coords [50 20 0 50 20 50]');
    expect(shading).toContain('/Bounds [0.2]');
  });

  it('clip the page to the shape and place the shading on the object', () => {
    const pdf = pdfDocument([{ document: doc([box({ fillPaint: fade })]) }]);
    expect(pdf.data).toContain('W* n 1 0 0 1 20 10 cm /Sh0 sh Q');
    expect(pdf.data).toMatch(/\/Shading << \/Sh0 \d+ 0 R >>/);
    expect(pdf.skipped).not.toContain('transparent gradient stops');
    const clear = pdfDocument([{ document: doc([box({ fillPaint: { ...fade, stops: [fade.stops[0], { ...fade.stops[1], color: '#0000ff80' }] } })]) }]);
    expect(clear.skipped).toContain('transparent gradient stops');
  });
});

describe('patterns in PDF', () => {
  it('write one tiling pattern per pattern, laid out from the document origin', () => {
    const dots = presetPattern('checker', 'p', '#ff0000', 20);
    const pdf = pdfDocument([{ document: doc([box({ fillPaint: { kind: 'pattern', patternId: 'p' } }), box({ id: 'b', y: 60, fillPaint: { kind: 'pattern', patternId: 'p' } })], { patterns: [dots] }) }]);
    expect(pdf.data.match(/\/PatternType 1/g)).toHaveLength(1);
    // Pattern space is the page: points per pixel, flipped, starting at the top of the page.
    expect(pdf.data).toContain('/BBox [0 0 20 20] /XStep 20 /YStep 20 /Resources << >> /Matrix [0.75 0 0 -0.75 0 75]');
    expect(pdf.data.match(/\/Pattern cs \/P0 scn/g)).toHaveLength(2);
    expect(pdf.data).toMatch(/\/Pattern << \/P0 \d+ 0 R >>/);
    expect(pdf.data).toContain('1 0 0 rg');
  });

  it('fill with the colour when the pattern is missing', () => {
    const pdf = pdfDocument([{ document: doc([box({ fill: '#00ff00', fillPaint: { kind: 'pattern', patternId: 'gone' } })]) }]);
    expect(pdf.data).not.toContain('/Pattern');
    expect(pdf.data).toContain('0 1 0 rg');
  });
});
