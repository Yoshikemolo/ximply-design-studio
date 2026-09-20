// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';

function editorWithTwoDocuments() {
  localStorage.clear();
  const e = new EditorService();
  e.rename('First');
  e.document.update((document) => ({
    ...document,
    layers: [{ ...newLayer('rectangle', 'a', { x: 10, y: 10 }), width: 50, height: 40 }],
  }));
  const first = e.activeTabId();
  e.newDocument();
  e.rename('Second');
  return { e, first, second: e.activeTabId() };
}
function component(editor: EditorService) {
  const c = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(c, {
    editor,
    exportDialog: signal(false),
    exportFormat: signal<'png' | 'svg' | 'pdf'>('pdf'),
    exportTabs: signal<string[]>([]),
    dismissMenus: vi.fn(),
    notify: vi.fn(),
  });
  return c;
}

beforeEach(() => localStorage.clear());
describe('export dialog', () => {
  it('opens with the current document chosen and exports the chosen ones', async () => {
    const { e, first, second } = editorWithTwoDocuments();
    const saved: { name: string; type: string; size: number }[] = [];
    e.download = (content: Blob, name: string) => { saved.push({ name, type: content.type, size: content.size }); };
    const app = component(e);
    app.openExport();
    expect(app.exportTabs()).toEqual([second]);
    app.toggleExportTab(first, true);
    expect(app.exportTabs()).toContain(first);
    await app.runExport();
    // A PDF collects both documents into one file.
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe('application/pdf');
    expect(saved[0].name.endsWith('.pdf')).toBe(true);
    expect(app.exportDialog()).toBe(false);
  });

  it('writes one file per document for the image formats', async () => {
    const { e, first, second } = editorWithTwoDocuments();
    const saved: string[] = [];
    e.download = (_content: Blob, name: string) => { saved.push(name); };
    const app = component(e);
    app.openExport();
    app.exportFormat.set('svg');
    app.toggleExportTab(first, true);
    await app.runExport();
    expect(saved.sort()).toEqual(['First.svg', 'Second.svg']);
    expect(e.status()).toContain('Exported 2 documents');
  });

  it('exports only the current document from the File menu entry', async () => {
    const { e, second } = editorWithTwoDocuments();
    const saved: string[] = [];
    e.download = (_content: Blob, name: string) => { saved.push(name); };
    const app = component(e);
    await app.exportAsPdf();
    expect(saved).toEqual(['Second.pdf']);
    expect(e.activeTabId()).toBe(second);
  });

  it('refuses an export without documents', async () => {
    const { e } = editorWithTwoDocuments();
    await expect(e.exportPdf([])).rejects.toThrow(/at least one document/);
  });
});

describe('printing', () => {
  it('writes one section per document into the printing window', () => {
    const { e, first, second } = editorWithTwoDocuments();
    const written: string[] = [];
    const view = { document: { write: (html: string) => written.push(html), close: () => undefined } };
    expect(e.printDocuments([first, second], () => view as unknown as Window)).toBe(true);
    expect(written[0]).toContain('<section');
    expect((written[0].match(/<section/g) ?? [])).toHaveLength(2);
    expect(written[0]).toContain('onload="print()"');
    expect(e.status()).toContain('Sent 2 documents');
  });

  it('says so when the window cannot be opened, and refuses an empty selection', () => {
    const { e, first } = editorWithTwoDocuments();
    expect(e.printDocuments([first], () => null)).toBe(false);
    expect(e.status()).toContain('pop-up');
    expect(() => e.printDocuments([])).toThrow(/at least one document/);
  });
});

describe('export entry points', () => {
  it('offers PDF and printing in the File menu and opens the dialog from the header', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    const file = template.slice(template.indexOf('<summary>{{ t("File") }}</summary>'), template.indexOf('</details>'));
    expect(file).toContain('t("Export PDF")');
    expect(file).toContain('t("Print")');
    expect(file).toContain('(click)="openExport()"');
    expect(template).toContain('class="primary small icon-action" (click)="openExport()"');
    expect(template).toContain('class="export-documents"');
  });
});
