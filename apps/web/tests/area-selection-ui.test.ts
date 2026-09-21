// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { PreferencesService } from '../src/app/preferences.service';
import { EditorService } from '../src/app/editor.service';
import { TOOLS, TOOL_FAMILIES } from '../src/app/tools';
import { translate } from '../src/app/i18n';

describe('area selection presentation', () => {
  beforeEach(() => localStorage.clear());
  it('remembers the last area independently of other preferences and rejects invalid saved modes', () => {
    const p = new PreferencesService();
    p.setAreaSelection('lasso'); p.toggleCursor(false); p.setMeasurement('gridVisible', true);
    expect(new PreferencesService().lastAreaSelection()).toBe('lasso');
    const saved = JSON.parse(localStorage.getItem('xds-input-settings')!);
    saved.lastAreaSelection = 'invalid'; localStorage.setItem('xds-input-settings', JSON.stringify(saved));
    expect(new PreferencesService().lastAreaSelection()).toBe('rectangle');
  });
  it('offers localized subtools within the selection family', () => {
    const family = TOOL_FAMILIES.find(f => f.id === 'selection')!;
    expect(family.tools).toEqual(['select', 'selectRectangle', 'selectEllipse', 'selectLasso']);
    for (const id of family.tools.slice(1)) {
      const tool = TOOLS.find(t => t.id === id)!;
      expect(translate(tool.label, 'es')).not.toBe(tool.label);
    }
  });
  it('switches back to ordinary selection without forgetting the last area shape', () => {
    const app = Object.create(AppComponent.prototype) as AppComponent;
    const editor = new EditorService(), preferences = new PreferencesService();
    Object.assign(app, { editor, preferences, families: TOOL_FAMILIES, familyChoices: signal({}), flyout: signal(null), commitText: vi.fn() });
    app.chooseTool('selectLasso'); app.chooseTool('select');
    expect(preferences.lastAreaSelection()).toBe('lasso'); expect(editor.tool()).toBe('select');
  });
  it('renders a true circular outline with screen-sized dashes and no exported document mutations', () => {
    const app = Object.create(AppComponent.prototype) as AppComponent;
    const editor = new EditorService(); editor.zoom.set(2);
    editor.areaSelection.set({ kind: 'ellipse', start: { x: 10, y: 20 }, end: { x: 13, y: 24 }, points: [] });
    Object.assign(app, { editor });
    const before = JSON.stringify(editor.document());
    expect(app.areaSelectionPath()).toBe('M5 20a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z');
    expect(JSON.stringify(editor.document())).toBe(before);
  });
});
