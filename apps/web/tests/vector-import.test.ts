// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { newLayer, parseDocument } from '../../../packages/domain/src/document';
import { pdfDocument } from '../../../packages/domain/src/pdf';

const file = (name: string, content: string, type = '') =>
  ({ name, size: content.length, type, text: async () => content }) as unknown as File;
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
  + '<rect x="10" y="10" width="30" height="20" fill="#112233"/>'
  + '<circle cx="70" cy="70" r="10" fill="url(#missing)"/></svg>';

beforeEach(() => localStorage.clear());
describe('vector import', () => {
  it('places an imported drawing as one undoable step and selects it', async () => {
    const e = new EditorService();
    await e.importFile(file('Plan.svg', DRAWING, 'image/svg+xml'));
    expect(e.document().layers).toHaveLength(2);
    expect(e.selectedLayers().map((layer) => layer.kind)).toEqual(['path', 'path']);
    expect(e.document().layers[0].groupPath?.[0]).toBe('Plan.svg');
    const rectangle = e.document().layers[0];
    expect([rectangle.x, rectangle.y, rectangle.width, rectangle.height]).toEqual([10, 10, 30, 20]);
    expect(rectangle.fill).toBe('#112233');
    // The document stays valid for the native parser after an import.
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
    e.undo();
    expect(e.document().layers).toHaveLength(0);
  });

  it('says what the reader could not represent instead of dropping it silently', async () => {
    const e = new EditorService();
    await e.importFile(file('Plan.svg', DRAWING, 'image/svg+xml'));
    expect(e.status()).toContain('gradients and patterns');
    expect(e.status()).toContain('Imported 2 objects');
  });

  it('places the drawing of a PDF or Illustrator file, streams and all', async () => {
    const e = new EditorService();
    // A transparent page, so the drawing is the only thing the file carries.
    const document = { ...e.document(), background: 'none', layers: [{ ...newLayer('rectangle', 'a', { x: 10, y: 20 }), width: 60, height: 40, fill: '#00ff00', stroke: 'none' }] };
    const { data } = pdfDocument([{ document }]);
    const buffer = Uint8Array.from([...data].map((character) => character.charCodeAt(0) & 0xff));
    const pdf = {
      name: 'Art.ai', size: buffer.length, type: '',
      arrayBuffer: async () => buffer.buffer,
    } as unknown as File;
    const fresh = new EditorService();
    await fresh.importFile(pdf);
    expect(fresh.document().layers).toHaveLength(1);
    const [placed] = fresh.document().layers;
    expect([Math.round(placed.x), Math.round(placed.y)]).toEqual([10, 20]);
    expect(placed.fill).toBe('#00ff00');
    expect(placed.groupPath).toEqual(['Art.ai']);
  });

  it('refuses the formats it cannot read and keeps the document untouched', async () => {
    const e = new EditorService();
    await expect(e.importFile(file('plan.dwg', 'binary'))).rejects.toThrow(/DXF/);
    await expect(e.importFile({ name: 'broken.ai', size: 9, type: '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as File))
      .rejects.toThrow(/not a PDF/);
    await expect(e.importFile(file('empty.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml')))
      .rejects.toThrow(/no content/);
    await expect(e.importFile(file('attack.svg', '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', 'image/svg+xml')))
      .rejects.toThrow(/document type/i);
    expect(e.document().layers).toHaveLength(0);
    expect(e.history.canUndo).toBe(false);
  });

  it('places a DXF drawing the same way, keeping its drawing layers as groups', async () => {
    const e = new EditorService();
    const drawing = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'walls',
      '10', '0', '20', '0', '11', '80', '21', '60', '0', 'ENDSEC', '0', 'EOF'].join(String.fromCharCode(10));
    await e.importFile(file('House.dxf', drawing));
    expect(e.document().layers).toHaveLength(1);
    expect(e.document().layers[0].groupPath).toEqual(['House.dxf', 'walls']);
    expect(e.status()).toContain('Imported 1 objects');
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
    e.undo();
    expect(e.document().layers).toHaveLength(0);
  });

  it('offers the readable formats in the import dialog', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    expect(template).toContain('accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,.dxf,.ai,.pdf"');
  });
});
