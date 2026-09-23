import { describe, expect, it } from 'vitest';
import { aliasPixels, alignToPixels, MAX_RASTER_SIDE, paintArea, rasterFrame, rasterPixels, rasterScale, rasterTarget, validRasterOptions } from '../src/rasterize';
import { blankDocument, newLayer, type Layer, type StudioDocument } from '../src/document';

const rect = (id: string, x: number, y: number, width: number, height: number, extra: Partial<Layer> = {}): Layer =>
  ({ ...newLayer('rectangle', id, { x, y }), width, height, ...extra });
const doc = (...layers: Layer[]): StudioDocument => ({ ...blankDocument(), layers });

describe('what Convert to pixel image draws and where the image goes', () => {
  it('draws the selected layers and inserts above the topmost one, in its group', () => {
    const d = doc(rect('a', 0, 0, 10, 10), rect('b', 0, 0, 10, 10, { groupPath: ['g'] }), rect('c', 0, 0, 10, 10));
    const target = rasterTarget(d, ['b', 'a'])!;
    expect(target.ids).toEqual(['a', 'b']);
    expect(target.insertAt).toBe(2);
    expect(target.groupPath).toEqual(['g']);
  });
  it('draws every visible printing layer when nothing is selected and inserts at the top', () => {
    const d = doc(rect('a', 0, 0, 10, 10), rect('hidden', 0, 0, 10, 10, { visible: false }), rect('guide', 0, 0, 10, 10, { guide: 'vertical' }), rect('locked', 0, 0, 10, 10, { locked: true }));
    const target = rasterTarget(d, [])!;
    expect(target.ids).toEqual(['a', 'locked']);
    expect(target.insertAt).toBe(4);
    expect(target.groupPath).toBeUndefined();
  });
  it('has nothing to draw when only hidden layers or guides are chosen, or the page is empty', () => {
    const d = doc(rect('hidden', 0, 0, 10, 10, { visible: false }), rect('guide', 0, 0, 10, 10, { guide: 'horizontal' }));
    expect(rasterTarget(d, ['hidden', 'guide'])).toBeNull();
    expect(rasterTarget(doc(), [])).toBeNull();
  });
  it('covers the frame, the stroke allowance and the blur in page units', () => {
    // strokeBounds widens a 2 unit stroke by 2 * 10 + 1; the area adds 32 plus the font size.
    const layer = rect('a', 100, 50, 40, 20, { strokeWidth: 2, fontSize: 0 });
    expect(paintArea([layer])).toEqual({ x: 100 - 21 - 32, y: 50 - 21 - 32, width: 40 + 2 * 53, height: 20 + 2 * 53 });
    const blurred = { ...layer, adjustments: { ...layer.adjustments, blur: 4 } };
    expect(paintArea([blurred]).x).toBe(100 - 21 - 32 - 12);
  });
  it('turns the frame of a rotated layer with it', () => {
    const layer = rect('a', 0, 0, 100, 10, { strokeWidth: 0, fontSize: 0, rotation: 90 });
    const area = paintArea([layer]);
    // Turned a quarter about its centre (50, 5), the 100 by 10 frame plus 33 each side stands upright.
    // Rounding outwards may add one unit to a side that the turn leaves a hair off an integer.
    expect(area.width).toBeGreaterThanOrEqual(76); expect(area.width).toBeLessThanOrEqual(77);
    expect(area.height).toBeGreaterThanOrEqual(166); expect(area.height).toBeLessThanOrEqual(167);
  });
});

describe('resolution and pixel limits', () => {
  it('uses 72 page units per inch', () => {
    expect(rasterScale(72)).toBe(1);
    expect(rasterScale(150)).toBeCloseTo(150 / 72, 12);
    expect(rasterScale(300)).toBeCloseTo(300 / 72, 12);
  });
  it('rounds pixel sizes up and refuses images past the limits', () => {
    expect(rasterPixels({ x: 0, y: 0, width: 10.2, height: 3 }, 1)).toEqual({ width: 11, height: 3 });
    expect(rasterPixels({ x: 0, y: 0, width: MAX_RASTER_SIDE + 1, height: 1 }, 1)).toBeNull();
    expect(rasterPixels({ x: 0, y: 0, width: 6000, height: 6000 }, 1)).toBeNull();
  });
  it('places the cropped pixels back on the page and grows them by the margin', () => {
    const { pixels, frame } = rasterFrame({ x: 10, y: 20, width: 100, height: 100 }, { x: 30, y: 40, width: 60, height: 20 }, 2, 5);
    expect(pixels).toEqual({ x: 20, y: 30, width: 80, height: 40 });
    expect(frame).toEqual({ x: 20, y: 35, width: 40, height: 20 });
  });
  it('accepts only sane options', () => {
    expect(validRasterOptions({ ppi: 150, antialias: 'art', margin: 0 })).toBe(true);
    expect(validRasterOptions({ ppi: 0, antialias: 'art', margin: 0 })).toBe(false);
    expect(validRasterOptions({ ppi: Number.NaN, antialias: 'art', margin: 0 })).toBe(false);
    expect(validRasterOptions({ ppi: 150, antialias: 'type' as never, margin: 0 })).toBe(false);
    expect(validRasterOptions({ ppi: 150, antialias: 'none', margin: -1 })).toBe(false);
  });
  it('splits coverage at one half when anti-aliasing is off', () => {
    const data = new Uint8ClampedArray([9, 9, 9, 0, 9, 9, 9, 127, 9, 9, 9, 128, 9, 9, 9, 255]);
    aliasPixels(data);
    expect([data[3], data[7], data[11], data[15]]).toEqual([0, 0, 255, 255]);
    expect(data[0]).toBe(9);
  });
});

describe('pixel grid', () => {
  it('widens an area to whole pixels of a grid anchored at the page origin', () => {
    expect(alignToPixels({ x: 0.3, y: -0.3, width: 1, height: 1 }, 2)).toEqual({ x: 0, y: -0.5, width: 1.5, height: 1.5 });
    expect(alignToPixels({ x: 5, y: 5, width: 0, height: 0 }, 1)).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });
});
