import { describe, expect, it } from 'vitest';
import { contextData, contextSvg, fitInto, fittedPicture, hasPictures, pngSize } from '../src/agent-result';
import { newLayer } from '../src/document';

const apply = (m: { a: number; b: number; c: number; d: number; e: number; f: number }, x: number, y: number) =>
  [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

describe('placing what the model returns (FEAT-0029, SC-0153)', () => {
  it('fits a wide box into a square frame by its width, centred vertically', () => {
    const m = fitInto({ x: 10, y: 20, width: 200, height: 100 }, { x: 0, y: 0, width: 50, height: 50 });
    expect(m.a).toBeCloseTo(0.25);
    expect(m.d).toBeCloseTo(0.25);
    expect(apply(m, 10, 20)).toEqual([0, 12.5]);
    expect(apply(m, 210, 120)).toEqual([50, 37.5]);
  });

  it('fits a tall box by its height, centred horizontally, and enlarges when the frame is bigger', () => {
    const m = fitInto({ x: 0, y: 0, width: 10, height: 20 }, { x: 100, y: 100, width: 100, height: 100 });
    expect(apply(m, 0, 0)).toEqual([125, 100]);
    expect(apply(m, 10, 20)).toEqual([175, 200]);
  });

  it('gives a picture the frame of its pixel proportions inside the target', () => {
    expect(fittedPicture(1024, 1024, { x: 0, y: 0, width: 300, height: 150 })).toEqual({ x: 75, y: 0, width: 150, height: 150 });
    expect(fittedPicture(1536, 1024, { x: 10, y: 10, width: 150, height: 100 })).toEqual({ x: 10, y: 10, width: 150, height: 100 });
  });

  it('survives an empty source box without dividing by zero', () => {
    const m = fitInto({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 10, height: 10 });
    expect(Number.isFinite(m.a)).toBe(true);
  });
});

describe('the selected objects as data (FEAT-0029, SC-0151)', () => {
  it('sends the objects without the pixels of pictures', () => {
    const picture = { ...newLayer('image', 'p', { x: 0, y: 0 }), source: 'data:image/png;base64,' + 'A'.repeat(5000) };
    const data = JSON.parse(contextData([newLayer('rectangle', 'r', { x: 1, y: 2 }), picture]));
    expect(data.map((layer: { id: string }) => layer.id)).toEqual(['r', 'p']);
    expect(data[1].source).toBe('[picture sent as an image]');
    expect(data[0].kind).toBe('rectangle');
  });

  it('stays within the size a request can carry', () => {
    const many = Array.from({ length: 200 }, (_, index) => newLayer('rectangle', `r${index}`, { x: index, y: index }));
    expect(contextData(many, 1000)).toHaveLength(1000);
  });
});

describe('the size of the picture the model returns', () => {
  const header = (width: number, height: number) => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      width >>> 24, (width >> 16) & 255, (width >> 8) & 255, width & 255, height >>> 24, (height >> 16) & 255, (height >> 8) & 255, height & 255, 8, 6, 0, 0, 0];
    return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
  };
  it('reads the width and height from the PNG header', () => {
    expect(pngSize(header(1536, 1024))).toEqual({ width: 1536, height: 1024 });
    expect(pngSize(header(70000, 3))).toEqual({ width: 70000, height: 3 });
  });
  it('refuses what is not a PNG', () => {
    expect(pngSize('data:image/jpeg;base64,' + 'A'.repeat(40))).toBeNull();
    expect(pngSize(header(1, 1).replace('iVBOR', 'iVBOQ'))).toBeNull();
    expect(pngSize(header(0, 10))).toBeNull();
  });
});

describe('vector context (FEAT-0029, SC-0157)', () => {
  const exported = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="100%" height="100%" fill="#ffffff"/><rect x="10" y="10"/></svg>';
  it('frames the exported drawing on the selection and drops the page background', () => {
    expect(contextSvg(exported, { x: 9, y: 9.5, width: 42.004, height: 21 }, false)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="42" height="21" viewBox="9 9.5 42 21"><rect x="10" y="10"/></svg>');
  });
  it('keeps the background for the whole document and gives up beyond the limit', () => {
    expect(contextSvg(exported, { x: 0, y: 0, width: 800, height: 600 }, true)).toContain('fill="#ffffff"');
    expect(contextSvg(exported, { x: 0, y: 0, width: 1, height: 1 }, true, 20)).toBeUndefined();
    expect(contextSvg('not svg', { x: 0, y: 0, width: 1, height: 1 }, true)).toBeUndefined();
  });
  it('finds pictures among the visible objects of a context', () => {
    const shape = newLayer('rectangle', 'r', { x: 0, y: 0 });
    const picture = { ...newLayer('image', 'p', { x: 0, y: 0 }), source: 'data:image/png;base64,AAAA' };
    expect(hasPictures([shape])).toBe(false);
    expect(hasPictures([shape, picture])).toBe(true);
    expect(hasPictures([shape, { ...picture, visible: false }])).toBe(false);
  });
});
