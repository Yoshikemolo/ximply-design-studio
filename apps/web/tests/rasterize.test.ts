// @vitest-environment happy-dom
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { existsSync, readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { AppComponent } from '../src/app/app.component';
import { newLayer, parseDocument, type Layer } from '../../../packages/domain/src/document';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

beforeEach(() => {
  localStorage.clear();
  const canvases = new WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvas>>();
  const native = (element: HTMLCanvasElement) => {
    let canvas = canvases.get(element);
    if (!canvas) { canvas = createCanvas(element.width, element.height); canvases.set(element, canvas); }
    return canvas;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) { return native(this).getContext('2d') as never; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function(this: HTMLCanvasElement) { return native(this).toDataURL('image/png'); });
});
afterEach(() => vi.restoreAllMocks());

const rect = (id: string, x: number, y: number, width: number, height: number, extra: Partial<Layer> = {}): Layer =>
  ({ ...newLayer('rectangle', id, { x, y }), width, height, ...extra });
function editor(layers: Layer[], selected: string[] = []) {
  const e = new EditorService();
  e.document.update((d) => ({ ...d, layers }));
  e.selectedIds.set(selected); e.selectedId.set(selected[0] ?? null);
  return e;
}
async function pixels(source: string) {
  const image = await loadImage(source);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.getContext('2d').getImageData(0, 0, image.width, image.height);
}
/** Crops an independently drawn golden canvas to its painted pixels. */
function cropped(canvas: ReturnType<typeof createCanvas>) {
  const ctx = canvas.getContext('2d'), all = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (all.data[(y * canvas.width + x) * 4 + 3]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return { left, top, data: ctx.getImageData(left, top, right - left + 1, bottom - top + 1) };
}
const overlapping = () => [
  rect('a', 10, 10, 40, 30, { fill: '#ff0000', stroke: '#0000ff', strokeWidth: 4 }),
  rect('b', 30, 20, 40, 30, { fill: '#00ff00', stroke: 'none', strokeWidth: 0 }),
  rect('c', 200, 200, 10, 10),
];

describe('Convert to pixel image of a selection (SC-0123)', () => {
  it('matches a golden image of the same shapes drawn directly at 150 ppi, with transparency around them', async () => {
    const e = editor(overlapping(), ['a', 'b']);
    const image = (await e.rasterizePng({ ppi: 150, antialias: 'art', margin: 0 }))!;
    const scale = 150 / 72;
    // The golden image: the same geometry drawn with the canvas API, not with the renderer.
    const golden = createCanvas(400, 300), g = golden.getContext('2d');
    g.scale(scale, scale); g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = '#ff0000'; g.fillRect(10, 10, 40, 30);
    g.strokeStyle = '#0000ff'; g.lineWidth = 4; g.strokeRect(10, 10, 40, 30);
    g.fillStyle = '#00ff00'; g.fillRect(30, 20, 40, 30);
    const expected = cropped(golden), actual = await pixels(image.source);
    expect([actual.width, actual.height]).toEqual([expected.data.width, expected.data.height]);
    let worst = 0;
    for (let i = 0; i < actual.data.length; i++) worst = Math.max(worst, Math.abs(actual.data[i] - expected.data.data[i]));
    expect(worst).toBeLessThanOrEqual(2);
    // The visible bounds run from the outer edge of the stroke (8, 8) to the far corner of b (70, 50).
    // Edge pixels covered only in part widen each side by at most one pixel.
    const pixel = 1 / scale;
    expect(Math.abs(image.frame.x - 8)).toBeLessThanOrEqual(pixel); expect(Math.abs(image.frame.y - 8)).toBeLessThanOrEqual(pixel);
    expect(Math.abs(image.frame.width - 62)).toBeLessThanOrEqual(2 * pixel); expect(Math.abs(image.frame.height - 42)).toBeLessThanOrEqual(2 * pixel);
    // The picture sits on the pixel grid of the page, where the golden image was drawn.
    expect(image.frame.x * scale).toBeCloseTo(expected.left, 6); expect(image.frame.y * scale).toBeCloseTo(expected.top, 6);
    expect(actual.width).toBe(Math.round(image.frame.width * scale));
    expect(actual.data[3]).toBe(0);
  });

  it('inserts the picture above the topmost selected object, keeps the sources and is one undo step', async () => {
    const e = editor(overlapping(), ['a', 'b']), before = structuredClone(e.document());
    expect(await e.rasterizeSelection({ ppi: 72, antialias: 'art', margin: 0 })).toBe(true);
    const layers = e.document().layers, image = layers[2];
    expect(layers.map((l) => l.id)).toEqual(['a', 'b', image.id, 'c']);
    expect(image).toMatchObject({ kind: 'image', name: 'Pixel image' });
    expect(image.paintLayer).toBeUndefined();
    expect(e.selectedIds()).toEqual([image.id]);
    expect(layers.slice(0, 2)).toEqual(before.layers.slice(0, 2));
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
    e.undo(); expect(e.document()).toEqual(before);
    e.redo(); expect(e.document().layers[2].source).toBe(image.source);
  });

  it('joins the group of the topmost selected object', async () => {
    const e = editor([rect('a', 0, 0, 20, 20, { groupPath: ['g'] }), rect('b', 40, 0, 20, 20)], ['a']);
    await e.rasterizeSelection({ ppi: 72, antialias: 'art', margin: 0 });
    expect(e.document().layers[1].groupPath).toEqual(['g']);
  });

  it('grows the picture by the margin on every side', async () => {
    const e = editor([rect('a', 20, 20, 30, 10, { strokeWidth: 0 })], ['a']);
    const plain = (await e.rasterizePng({ ppi: 72, antialias: 'art', margin: 0 }))!;
    const wide = (await e.rasterizePng({ ppi: 72, antialias: 'art', margin: 5 }))!;
    expect(plain.frame).toEqual({ x: 20, y: 20, width: 30, height: 10 });
    expect(wide.frame).toEqual({ x: 15, y: 15, width: 40, height: 20 });
    const data = (await pixels(wide.source)).data;
    expect(data[3]).toBe(0);
  });

  it('paints only empty or full pixels without anti-aliasing', async () => {
    const e = editor([rect('a', 10.3, 10.3, 30.4, 20.4, { rotation: 17, stroke: 'none', strokeWidth: 0 })], ['a']);
    const soft = (await pixels((await e.rasterizePng({ ppi: 150, antialias: 'art', margin: 0 }))!.source)).data;
    const hard = (await pixels((await e.rasterizePng({ ppi: 150, antialias: 'none', margin: 0 }))!.source)).data;
    const alphas = (data: Uint8ClampedArray) => new Set(Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 3]));
    expect([...alphas(soft)].some((a) => a > 0 && a < 255)).toBe(true);
    expect([...alphas(hard)].every((a) => a === 0 || a === 255)).toBe(true);
  });
});

describe('whole document and refused conversions (SC-0124)', () => {
  it('converts every visible printing layer when nothing is selected, like a PNG export of the page', async () => {
    const e = editor([
      rect('a', 10, 10, 40, 30, { fill: '#ff0000', strokeWidth: 0 }),
      rect('hidden', 60, 60, 20, 20, { fill: '#000000', visible: false }),
      rect('b', 30, 30, 50, 20, { fill: '#00ff00', stroke: '#0000ff', strokeWidth: 3 }),
    ]);
    const before = structuredClone(e.document().layers);
    expect(await e.rasterizeSelection({ ppi: 72, antialias: 'art', margin: 0 })).toBe(true);
    const image = e.document().layers.at(-1)!;
    expect(e.document().layers.slice(0, 3)).toEqual(before);
    const exported = (await e.renderer.export({ ...e.document(), layers: before }, true)).getContext('2d')!.getImageData(0, 0, 120, 100).data;
    const drawn = createCanvas(120, 100);
    drawn.getContext('2d').drawImage(await loadImage(image.source), image.x, image.y);
    expect(Array.from(drawn.getContext('2d').getImageData(0, 0, 120, 100).data)).toEqual(Array.from(exported));
    // The hidden square at (60, 60) to (80, 80) is not drawn: below b it stays empty.
    expect(drawn.getContext('2d').getImageData(70, 70, 1, 1).data[3]).toBe(0);
  });

  it('refuses when nothing visible would be drawn and leaves the document and history as they were', async () => {
    const e = editor([rect('hidden', 0, 0, 10, 10, { visible: false }), rect('guide', 0, 0, 10, 10, { guide: 'vertical' })]);
    const before = e.document();
    expect(await e.rasterizeSelection()).toBe(false);
    expect(e.status()).toBe('There is nothing visible to convert.');
    expect(e.document()).toBe(before);
    e.undo(); expect(e.document()).toBe(before);
    const transparent = editor([rect('clear', 0, 0, 10, 10, { fill: 'none', stroke: 'none' })], ['clear']);
    expect(await transparent.rasterizeSelection()).toBe(false);
  });

  it('refuses a picture past the pixel limits', async () => {
    const e = editor([rect('huge', 0, 0, 3000, 3000, { strokeWidth: 0 })], ['huge']);
    const before = e.document();
    expect(await e.rasterizeSelection({ ppi: 300, antialias: 'art', margin: 0 })).toBe(false);
    expect(e.status()).toBe('The pixel image would be too large; choose a lower resolution.');
    expect(e.document()).toBe(before);
  });

  it('returns the preview without inserting it, with the pixels an inserted picture gets', async () => {
    const e = editor(overlapping(), ['a']), before = e.document();
    const preview = (await e.rasterizePng({ ppi: 150, antialias: 'art', margin: 0 }))!;
    expect(e.document()).toBe(before);
    await e.rasterizeSelection({ ppi: 150, antialias: 'art', margin: 0 });
    expect(e.document().layers[1].source).toBe(preview.source);
  });
});

describe('Convert to pixel image in the shell', () => {
  it('sits in the flyout of Import with its own icon and no invented shortcut', () => {
    const component = Object.create(AppComponent.prototype) as AppComponent;
    const source = readFileSync('apps/web/src/app/app.component.ts', 'utf-8');
    const group = source.slice(source.indexOf('readonly imageGroup'), source.indexOf('readonly actionGroups'));
    expect(group).toContain('commands: ["importImage", "rasterize"]');
    for (const id of ['importImage', 'rasterize']) expect(existsSync(`apps/web/public/assets/icons/${component.commandIcon(id)}.svg`)).toBe(true);
    expect(defaultShortcuts()['rasterize'] ?? []).toEqual([]);
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    expect(template).toContain('toggleFlyout(imageGroup.id, $event)');
    expect(template).toContain('@if (rasterizeDialog())');
  });
});

describe('reading the drawing back', () => {
  it('reads the drawn canvas once per conversion, whatever the anti-aliasing and margin', async () => {
    for (const antialias of ['art', 'none'] as const) {
      const e = editor(overlapping(), ['a', 'b']);
      const original = e.renderer.rasterize.bind(e.renderer);
      let reads = 0;
      vi.spyOn(e.renderer, 'rasterize').mockImplementation(async (...args) => {
        const canvas = await original(...args), context = canvas.getContext('2d')!, read = context.getImageData.bind(context);
        context.getImageData = ((...box: Parameters<typeof read>) => { reads++; return read(...box); }) as typeof read;
        return canvas;
      });
      const image = await e.rasterizePng({ ppi: 150, antialias, margin: 3 });
      expect(image).not.toBeNull();
      expect(reads).toBe(1);
    }
  });
});
