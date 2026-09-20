// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { parseDocument } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
function component() {
  localStorage.clear();
  const editor = new EditorService();
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, { editor, preferences: new PreferencesService() });
  return { app, editor };
}

describe('page background paint', () => {
  it('offers the print and key swatches plus no colour', () => {
    const { app } = component();
    expect(app.backgroundSwatches.map((swatch) => swatch.label)).toEqual(['Black', 'White', 'Blueprint blue', 'Chroma key', 'No color']);
    expect(app.backgroundSwatches.at(-1)!.value).toBe('none');
  });

  it('keeps the colour while changing opacity and reports it back', () => {
    const { app, editor } = component();
    app.setBackgroundPaint('#1b4fa0');
    expect(app.backgroundOpacity()).toBe(100);
    app.setBackgroundOpacity(50);
    expect(editor.document().background).toBe('#1b4fa080');
    expect(app.backgroundBase()).toBe('#1b4fa0');
    expect(app.backgroundOpacity()).toBe(50);
    app.setBackgroundBase('#00b140');
    expect(editor.document().background).toBe('#00b14080');
    app.setBackgroundOpacity(0);
    expect(editor.document().background).toBe('none');
    expect(app.backgroundOpacity()).toBe(0);
    expect(app.backgroundBase()).toBe('#000000');
  });

  it('stores a transparent page in the native format', () => {
    const { app, editor } = component();
    app.setBackgroundPaint('none');
    const document = editor.document();
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
    editor.undo();
    expect(editor.document().background).toBe('#ffffff');
  });

  it('keeps the checkerboard settings within their range', () => {
    const preferences = new PreferencesService();
    expect(preferences.transparencyChecker()).toBe(true);
    expect(preferences.transparencyCheckerSize()).toBe(8);
    expect(preferences.setMeasurement('transparencyCheckerSize', 16)).toBe(true);
    expect(new PreferencesService().transparencyCheckerSize()).toBe(16);
    for (const invalid of [1, 65, 12.5]) expect(preferences.setMeasurement('transparencyCheckerSize', invalid)).toBe(false);
    expect(preferences.setMeasurement('transparencyChecker', false)).toBe(true);
  });
});
