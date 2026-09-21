// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { newLayer, parseDocument } from '../../../packages/domain/src/document';
import { approximateTextMeasurement } from '../../../packages/domain/src/text-layout';

/** The application serves its own faces; the test hands them over from the same folder. */
function servingFonts() {
  vi.stubGlobal('fetch', async (url: string) => {
    const file = readFileSync('apps/web/public' + String(url));
    return { ok: true, arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) } as Response;
  });
}
const text = (id: string, content: string, x = 20) => ({
  ...newLayer('text', id, { x, y: 40 }), width: 300, height: 40,
  text: content, fontSize: 32, fill: '#112233',
});
function editor(layers: ReturnType<typeof text>[]) {
  localStorage.clear();
  const e = new EditorService();
  Object.assign(e.renderer, { measureText: approximateTextMeasurement });
  e.document.update((document) => ({ ...document, layers }));
  return e;
}

beforeEach(() => { localStorage.clear(); servingFonts(); });
describe('create outlines', () => {
  it('replaces the text with one shape per letter, grouped by word and by text', async () => {
    const e = editor([text('label', 'Hi you')]);
    e.selectLayer('label');
    expect(await e.outlineTextSelection()).toBe(true);
    const layers = e.document().layers;
    // The text object is gone and every letter is a shape of its own.
    expect(layers.some((layer) => layer.kind === 'text')).toBe(false);
    expect(layers.map((layer) => layer.name)).toEqual(['H', 'i', 'y', 'o', 'u']);
    expect(layers.every((layer) => layer.kind === 'path' && layer.curves!.length > 0)).toBe(true);
    // Every letter keeps the fill of the text it came from.
    expect(layers.every((layer) => layer.fill === '#112233')).toBe(true);
    // The letters of a word share a group, the words share the group of the text, and the
    // space between the two words starts a new one.
    const groups = layers.map((layer) => layer.groupPath!);
    expect(groups.every((path) => path.length === 2)).toBe(true);
    expect(new Set(groups.map((path) => path[0])).size).toBe(1);
    expect(groups[0][1]).toBe(groups[1][1]);
    expect(groups[2][1]).toBe(groups[3][1]);
    expect(groups[1][1]).not.toBe(groups[2][1]);
    expect(parseDocument(JSON.stringify(e.document()))).toBeTruthy();
    e.undo();
    expect(e.document().layers.map((layer) => layer.id)).toEqual(['label']);
  });

  it('keeps the holes of a letter inside the letter', async () => {
    const e = editor([text('label', 'Bo')]);
    e.selectLayer('label');
    await e.outlineTextSelection();
    const [b, o] = e.document().layers;
    // A B has two holes and an O has one, each one a contour of the same shape.
    expect(b.curves!.length).toBe(3);
    expect(o.curves!.length).toBe(2);
    expect(b.curves!.every((path) => path.closed)).toBe(true);
  });

  it('outlines every text of a selection, each one in its own group', async () => {
    const e = editor([text('one', 'Ab'), text('two', 'Cd', 400), { ...newLayer('rectangle', 'box', { x: 0, y: 200 }), width: 40, height: 40 }]);
    e.selectLayer('one');
    e.selectLayer('two', true);
    e.selectLayer('box', true);
    expect(await e.outlineTextSelection()).toBe(true);
    const layers = e.document().layers;
    // The rectangle is untouched and each text became its own group of letters.
    expect(layers.some((layer) => layer.id === 'box')).toBe(true);
    const letters = layers.filter((layer) => layer.groupPath?.length === 2);
    expect(letters.map((layer) => layer.name)).toEqual(['A', 'b', 'C', 'd']);
    expect(new Set(letters.map((layer) => layer.groupPath![0])).size).toBe(2);
    expect(e.status()).toContain('2 texts');
  });

  it('keeps the outlines inside the group the text belonged to', async () => {
    const e = editor([{ ...text('label', 'Hi'), groupPath: ['outer'] }]);
    e.selectLayer('label');
    await e.outlineTextSelection();
    const [first] = e.document().layers;
    // The outer group comes first, then the group of the text and the group of the word.
    expect(first.groupPath![0]).toBe('outer');
    expect(first.groupPath).toHaveLength(3);
  });

  it('says so when the selection holds no text', async () => {
    const e = editor([{ ...newLayer('rectangle', 'box', { x: 0, y: 0 }), width: 40, height: 40 } as never]);
    e.selectLayer('box');
    expect(await e.outlineTextSelection()).toBe(false);
    expect(e.status()).toContain('Select the text');
  });
});
