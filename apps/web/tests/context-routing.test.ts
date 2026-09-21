// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newLayer, Layer } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';

const rectangle = (id: string, x: number, groupPath?: string[]): Layer => ({ ...newLayer('rectangle', id, { x, y: 100 }), width: 80, height: 80, ...(groupPath ? { groupPath } : {}) });
describe('editor surface context routing', () => {
  let app: AppComponent, editor: EditorService, canvas: HTMLCanvasElement;
  beforeEach(() => {
    localStorage.clear();
    editor = new EditorService(); editor.zoom.set(.5);
    editor.document.update(doc => ({ ...doc, width: 1200, height: 800 }));
    canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 100, top: 200, width: 600, height: 400 }) as DOMRect;
    app = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(app, { editor, preferences: new PreferencesService(), locale: signal('en'), contextMenu: signal(null), flyout: signal(null), paintPicker: signal(null), cursorPoint: signal(null), canvas: { nativeElement: canvas } });
  });
  const mouse = (x: number, y: number, target?: Element) => ({ clientX: 100 + x / 2, clientY: 200 + y / 2, target: target ?? canvas, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as MouseEvent;

  it('prioritizes selected curve anchors and handles without altering geometry or creating undo history', () => {
    const path: Layer = { ...newLayer('path', 'curve', { x: 100, y: 100 }), width: 200, height: 100, curves: [{ closed: false, nodes: [
      { point: { x: 0, y: 0 }, incoming: { x: 0, y: 0 }, outgoing: { x: 40, y: 0 }, smooth: false },
      { point: { x: 200, y: 100 }, incoming: { x: 160, y: 100 }, outgoing: { x: 200, y: 100 }, smooth: false },
    ] }] };
    editor.document.update(doc => ({ ...doc, layers: [path] })); editor.selectLayer(path.id);
    const before = JSON.stringify(editor.document());
    for (const part of ['point', 'outgoing'] as const) {
      const point = worldPoint(path, path.curves![0].nodes[0][part]);
      app.openCanvasContext(mouse(point.x, point.y));
      expect(app.contextMenu()?.target).toMatchObject({ kind: 'node', layerId: 'curve', path: 0, index: 0 });
      expect(JSON.stringify(editor.document())).toBe(before);
      expect(editor.history.canUndo).toBe(false);
    }
    expect(app.contextEntries().find(entry => entry.id === 'deleteNode')?.shortcut).toBeUndefined();
  });

  it('targets a group on canvas and an exact child in Layers, preserving unrelated siblings', () => {
    editor.document.update(doc => ({ ...doc, layers: [rectangle('a', 100, ['group']), rectangle('b', 240, ['group']), rectangle('c', 400)] }));
    const before = JSON.stringify(editor.document());
    app.openCanvasContext(mouse(120, 120));
    expect(app.contextMenu()?.target).toMatchObject({ kind: 'object', layerId: 'a', groupPath: ['group'] });
    expect(editor.selectedIds()).toEqual(['a', 'b']); expect(JSON.stringify(editor.document())).toBe(before);
    app.openLayerContext(mouse(120, 120), 'a');
    expect(app.contextMenu()?.target).not.toHaveProperty('groupPath'); expect(editor.selectedIds()).toEqual(['a']);
    app.executeContext('hide');
    expect(editor.document().layers.map(layer => layer.visible)).toEqual([false, true, true]);
    expect(app.contextMenu()).toBeNull(); editor.undo(); expect(JSON.stringify(editor.document())).toBe(before);
  });

  it('preserves native menus in editable fields and right-button presses never start drawing', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const target = document.createElement(tag), event = mouse(100, 100, target);
      app.openLayerContext(event, 'missing'); app.openCanvasContext(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    const start = vi.spyOn(editor, 'start');
    app.pointerDown({ button: 2 } as PointerEvent);
    expect(start).not.toHaveBeenCalled(); expect(editor.document().layers).toHaveLength(0);
  });

  it('suppresses native menus only on the canvas surface and does not fabricate empty-canvas actions', () => {
    const event = mouse(100, 100);
    app.openCanvasContext(event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(app.contextMenu()).toBeNull(); expect(app.contextEntries()).toEqual([]);
  });

  it('uses remapped delete shortcuts and rejects stale targets after document edits', () => {
    editor.document.update(doc => ({ ...doc, layers: [rectangle('a', 100)] }));
    app.preferences.assign('remove', ['Shift+Backspace']);
    app.openLayerContext(mouse(120, 120), 'a');
    expect(app.contextEntries().find(entry => entry.id === 'delete')?.shortcut).toBe('Shift+Backspace');
    editor.setPaint('fill', '#123456');
    app.executeContext('delete');
    expect(editor.document().layers).toHaveLength(1);
    expect(app.contextEntries()).toEqual([]);
  });

  it('shows protected guide actions and permits visibility changes without allowing deletion', () => {
    const guide = { ...rectangle('guide', 100), kind: 'path' as const, guide: 'vertical' as const, locked: true };
    editor.document.update(doc => ({ ...doc, layers: [guide] }));
    app.openLayerContext(mouse(100, 200), 'guide');
    expect(app.contextEntries().find(entry => entry.id === 'delete')?.disabled).toBe(true);
    app.executeContext('delete'); expect(editor.document().layers).toHaveLength(1);
    app.openLayerContext(mouse(100, 200), 'guide');
    app.executeContext('hide'); expect(editor.document().layers[0].visible).toBe(false);
  });

  it('dismisses on Escape and canvas scrolling without executing editing shortcuts', () => {
    editor.document.update(doc => ({ ...doc, layers: [rectangle('a', 100)] }));
    app.openLayerContext(mouse(120, 120), 'a');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    app.key(escape); expect(escape.defaultPrevented).toBe(true); expect(app.contextMenu()).toBeNull();
    app.openLayerContext(mouse(120, 120), 'a'); app.refreshCursorPosition(); expect(app.contextMenu()).toBeNull();
    expect(editor.document().layers).toHaveLength(1);
  });
});
