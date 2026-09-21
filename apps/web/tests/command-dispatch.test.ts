// @vitest-environment happy-dom
import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { approximateTextMeasurement } from '../../../packages/domain/src/text-layout';
import { defaultShortcuts, validateShortcuts } from '../../../packages/domain/src/shortcuts';

const fontsFromDisk = () => vi.stubGlobal('fetch', async (url: string) => {
  const file = readFileSync('apps/web/public' + String(url));
  return {
    ok: true,
    arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  } as Response;
});

const shell = () => {
  const editor = new EditorService();
  Object.assign(editor.renderer, { measureText: approximateTextMeasurement });
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    editor,
    preferences: new PreferencesService(),
    flyout: signal(null),
    notify: () => undefined,
  });
  return { app, editor };
};

describe('command dispatch', () => {
  it('creates outlines from the menu, not only from the keyboard', async () => {
    localStorage.clear();
    fontsFromDisk();
    const { app, editor } = shell();
    editor.setTool('text');
    editor.start({ x: 40, y: 60 });
    editor.end();
    editor.updateLayer({ text: 'Hola mundo' });
    expect(app.commandEnabled('outlineText')).toBe(true);
    app.runCommand('outlineText');
    await vi.waitFor(() => {
      expect(editor.document().layers.some((layer) => layer.kind === 'text')).toBe(false);
    }, { timeout: 10000 });
    const shapes = editor.document().layers;
    expect(shapes.length).toBeGreaterThan(1);
    expect(shapes.every((layer) => layer.kind === 'path')).toBe(true);
  }, 30000);

  it('dispatches every command the template offers', () => {
    localStorage.clear();
    const { app } = shell();
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const offered = new Set<string>();
    for (const found of template.matchAll(/runCommand\('([a-zA-Z]+)'\)/g)) offered.add(found[1]);
    expect(offered.has('outlineText')).toBe(true);
    const dispatched = new Set(Object.keys((app as unknown as { commandActions(): Record<string, () => void> }).commandActions()));
    // The ones runCommand answers before it reads the table.
    for (const id of ['group', 'ungroup', 'regroup', 'selectAll', 'union', 'subtract', 'intersect', 'exclude',
      'makeBlend', 'expandBlend', 'releaseBlend', 'displacement', 'rotation',
      'alignLeft', 'alignCenterX', 'alignRight', 'alignTop', 'alignCenterY', 'alignBottom', 'distributeX', 'distributeY',
      'mirrorH', 'mirrorV', 'rotateCW', 'rotateCCW', 'scaleUp', 'scaleDown', 'zoomIn', 'zoomOut', 'fit']) dispatched.add(id);
    expect([...offered].filter((id) => !dispatched.has(id))).toEqual([]);
  });

  it('keeps saved shortcuts when a new command appears', () => {
    const saved = { ...defaultShortcuts() };
    delete saved['outlineText'];
    saved['undo'] = ['Mod+Z'];
    const map = validateShortcuts(saved);
    expect(map['outlineText']).toEqual(['Mod+Shift+O']);
    expect(map['undo']).toEqual(['Mod+Z']);
  });
});
