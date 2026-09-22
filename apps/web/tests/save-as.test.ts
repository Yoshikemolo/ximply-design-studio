// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorService } from '../src/app/editor.service';

function editor() {
  localStorage.clear();
  const e = new EditorService();
  const downloads: string[] = [];
  e.download = (_blob: Blob, name: string) => { downloads.push(name); };
  return { e, downloads };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('File > Save As', () => {
  it('downloads under the name given, which the document takes, without an undo step', async () => {
    const { e, downloads } = editor();
    expect(await e.saveAs('Poster final.xds')).toBe(true);
    expect(downloads).toEqual(['Poster final.xds']);
    expect(e.document().name).toBe('Poster final');
    expect(e.dirty()).toBe(false);
    expect(await e.saveAs('  ')).toBe(false);
  });

  it('drops characters a file name cannot hold', async () => {
    const { e, downloads } = editor();
    await e.saveAs('a/b:c*?');
    expect(downloads).toEqual(['abc.xds']);
  });

  it('writes to the file the browser lets it choose, and saves there again with Save', async () => {
    const { e, downloads } = editor();
    const written: string[] = [];
    const handle = { name: 'Chosen.xds', createWritable: async () => ({ write: async (data: Blob) => { written.push(await data.text()); }, close: async () => undefined }) };
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => handle));
    Object.assign(window, { showSaveFilePicker: (globalThis as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker });
    expect(e.canPickSaveFile()).toBe(true);
    expect(await e.saveAs()).toBe(true);
    expect(e.document().name).toBe('Chosen');
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]).name).toBe('Chosen');
    expect(await e.save()).toBe(true);
    expect(written).toHaveLength(2);
    expect(downloads).toEqual([]);
  });

  it('changes nothing when the browser dialog is cancelled', async () => {
    const { e, downloads } = editor();
    const name = e.document().name;
    Object.assign(window, { showSaveFilePicker: vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); }) });
    expect(await e.saveAs()).toBe(false);
    expect(e.document().name).toBe(name);
    expect(downloads).toEqual([]);
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('is in the File menu with Shift+Ctrl+S, as in Illustrator', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const file = html.slice(html.indexOf('<summary>{{ t("File") }}</summary>'), html.indexOf('<summary>{{ t("Edit") }}</summary>'));
    expect(file).toContain('(click)="saveAs()"');
    const { COMMANDS } = await import('../../../packages/domain/src/shortcuts');
    expect(COMMANDS.find((c) => c.id === 'saveAs')?.keys).toEqual(['Mod+Shift+S']);
  });
});
