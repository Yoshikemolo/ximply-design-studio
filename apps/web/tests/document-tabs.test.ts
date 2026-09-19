// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { blankDocument, newLayer, StudioDocument } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const rectangle = (id: string) => ({ ...newLayer('rectangle', id, { x: 10, y: 10 }), width: 40, height: 30 });
const draw = (e: EditorService, id: string) => { e.setTool('rectangle'); e.start({ x: 10, y: 10 }); e.move({ x: 60, y: 50 }); e.end(); return e.document().layers.at(-1)!.id ?? id; };
const project = (name: string): string => JSON.stringify({ ...blankDocument(), name, layers: [rectangle('saved')] } satisfies StudioDocument);

describe('document tabs', () => {
  it('opens blank documents in new tabs and keeps content, selection and history per tab', () => {
    const e = new EditorService();
    const first = e.activeTabId(), drawn = draw(e, 'a');
    expect(e.newDocument()).toBe(true);
    expect(e.tabs().map((tab) => tab.active)).toEqual([false, true]);
    expect(e.document().layers).toHaveLength(0);
    expect(e.tabs()[1].name).not.toBe(e.tabs()[0].name);
    draw(e, 'b'); draw(e, 'c');
    e.switchDocument(first);
    expect(e.document().layers.map((layer) => layer.id)).toEqual([drawn]);
    expect(e.selectedId()).toBe(drawn);
    e.undo();
    expect(e.document().layers).toHaveLength(0);
    e.switchDocument(e.tabOrder()[1]);
    expect(e.document().layers).toHaveLength(2);
  });

  it('tracks unsaved changes until the document is saved, opened or cleared', () => {
    const e = new EditorService();
    e.download = vi.fn();
    expect(e.dirty()).toBe(false);
    draw(e, 'a');
    expect(e.dirty()).toBe(true);
    e.save();
    expect(e.dirty()).toBe(false);
    draw(e, 'b');
    e.reset();
    expect(e.document().layers).toHaveLength(0);
    expect(e.dirty()).toBe(false);
    e.undo();
    expect(e.document().layers).toHaveLength(2);
    expect(e.dirty()).toBe(true);
  });

  it('keeps each inactive tab dirty flag and closes to the nearest remaining tab', () => {
    const e = new EditorService();
    const first = e.activeTabId();
    draw(e, 'a');
    e.newDocument();
    const second = e.activeTabId();
    e.newDocument();
    const third = e.activeTabId();
    expect(e.isDocumentDirty(first)).toBe(true);
    expect(e.isDocumentDirty(second)).toBe(false);
    e.switchDocument(second);
    e.closeDocument(second);
    expect(e.tabOrder()).toEqual([first, third]);
    expect(e.activeTabId()).toBe(third);
    e.closeDocument(first);
    e.closeDocument(third);
    expect(e.tabOrder()).toHaveLength(1);
    expect(e.document().layers).toHaveLength(0);
    expect(e.dirty()).toBe(false);
  });

  it('opens a project in an untouched tab, otherwise in a new tab', () => {
    const e = new EditorService();
    e.openDocument(project('One'));
    expect(e.tabs()).toHaveLength(1);
    expect(e.dirty()).toBe(false);
    e.openDocument(project('Two'));
    expect(e.tabs().map((tab) => tab.name)).toEqual(['One', 'Two']);
    expect(() => e.openDocument('{"format":"other"}')).toThrow();
    expect(e.tabs()).toHaveLength(2);
  });

  it('limits the number of open documents', () => {
    const e = new EditorService();
    while (e.newDocument());
    expect(e.tabs()).toHaveLength(12);
    expect(e.status()).toBe('Close a document before opening another.');
  });

  it('restores every tab and its unsaved flag, skipping unreadable drafts', () => {
    const e = new EditorService();
    draw(e, 'a');
    e.newDocument();
    e.newDocument();
    const broken = e.activeTabId();
    const active = e.tabOrder()[1];
    e.switchDocument(active);
    localStorage.setItem('xds-workspace:' + broken, '{broken');
    const restored = new EditorService();
    expect(restored.tabOrder()).toEqual(e.tabOrder().filter((id) => id !== broken));
    expect(restored.activeTabId()).toBe(active);
    expect(restored.isDocumentDirty(e.tabOrder()[0])).toBe(true);
    expect(restored.dirty()).toBe(false);
  });

  it('migrates the earlier single-document draft as unsaved work', () => {
    localStorage.setItem('xds-draft', project('Legacy'));
    const e = new EditorService();
    expect(e.document().name).toBe('Legacy');
    expect(e.dirty()).toBe(true);
    expect(localStorage.getItem('xds-draft')).toBeNull();
    expect(localStorage.getItem('xds-workspace')).not.toBeNull();
  });
});

describe('unsaved changes confirmation', () => {
  function component(editor: EditorService) {
    const c = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(c, { editor, confirmation: signal(null), commitText: vi.fn(), fit: vi.fn(), dismissMenus: vi.fn() });
    return c;
  }

  it('clears a saved document immediately and asks first when changes are unsaved', () => {
    const e = new EditorService(), c = component(e);
    c.clearDocument();
    expect(c.confirmation()).toBeNull();
    draw(e, 'a');
    c.clearDocument();
    expect(c.confirmation()?.action).toBe('Clear anyway');
    expect(e.document().layers).toHaveLength(1);
    c.confirmation.set(null);
    expect(e.document().layers).toHaveLength(1);
    c.clearDocument();
    c.confirm();
    expect(e.document().layers).toHaveLength(0);
    expect(c.confirmation()).toBeNull();
  });

  it('asks before closing a tab with unsaved changes', () => {
    const e = new EditorService(), c = component(e);
    const first = e.activeTabId();
    draw(e, 'a');
    c.newDocument();
    c.closeDocument(first);
    expect(c.confirmation()?.action).toBe('Close without saving');
    expect(e.tabOrder()).toHaveLength(2);
    c.confirm();
    expect(e.tabOrder()).toHaveLength(1);
    c.closeDocument(e.activeTabId());
    expect(c.confirmation()).toBeNull();
  });
});
