// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { approximateTextMeasurement } from '../../../packages/domain/src/text-layout';

const input = (value: number) => ({ target: { value: String(value) } }) as unknown as Event;
describe('typography property routing and draft preview', () => {
  let app: AppComponent, editor: EditorService;
  beforeEach(() => {
    localStorage.clear(); editor = new EditorService();
    Object.assign(editor.renderer, { measureText: approximateTextMeasurement });
    editor.setTool('text'); editor.start({ x: 20, y: 30 }); editor.end();
    editor.updateLayer({ text: 'Text content', width: 160, height: 70 });
    app = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(app, { editor, preferences: new PreferencesService(), textEditing: signal(null), textDraft: signal(''), typographyFields: [
      { key: 'lineHeight', min: 0, max: 2000 }, { key: 'letterSpacing', min: -100, max: 500 },
      { key: 'wordSpacing', min: -100, max: 1000 }, { key: 'paragraphSpacing', min: 0, max: 2000 }, { key: 'baselineShift', min: -1000, max: 1000 },
    ] });
  });

  it('makes frame modes mutually exclusive and wrapping compatible, with reversible edits', () => {
    app.toggleTextOption('fit'); expect(editor.selected()!.textLayout).toMatchObject({ sizing: 'fixed', fit: true });
    app.setTextSizing('width'); expect(editor.selected()!.textLayout).toMatchObject({ sizing: 'width', fit: false, wrap: false });
    const before = structuredClone(editor.document());
    app.toggleTextOption('wrap'); expect(editor.selected()!.textLayout).toMatchObject({ sizing: 'fixed', wrap: true });
    editor.undo(); expect(editor.document()).toEqual(before);
    app.setTextSizing('height'); expect(editor.selected()!.textLayout?.sizing).toBe('height');
    app.setTextSizing('height'); expect(editor.selected()!.textLayout?.sizing).toBe('fixed');
  });

  it('converts typographic distances from font units and percentage scales independently', () => {
    app.preferences.setMeasurement('fontUnit', 'pt'); app.preferences.setMeasurement('distanceUnit', 'mm');
    app.patchNumber('fontSize', input(18)); app.setTypographyNumber('lineHeight', input(24));
    app.setTypographyNumber('letterSpacing', input(-1.5)); app.setTypographyNumber('baselineShift', input(3));
    app.setTextScale('horizontalScale', input(125)); app.setTextScale('verticalScale', input(80));
    const layer = editor.selected()!;
    expect(layer.fontSize).toBe(24);
    expect(layer.typography).toMatchObject({ lineHeight: 32, letterSpacing: -2, baselineShift: 4, horizontalScale: 1.25, verticalScale: .8 });
    app.setTypographyNumber('lineHeight', input(0)); expect(editor.selected()!.typography?.lineHeight).toBe(0);
    app.setTextScale('horizontalScale', input(1)); expect(editor.selected()!.typography?.horizontalScale).toBe(.1);
    app.setTypographyNumber('baselineShift', input(NaN)); expect(editor.selected()!.typography?.baselineShift).toBe(4);
  });

  it('toggles style and decoration without changing paint alpha or overall opacity', () => {
    editor.setPaint('fill', '#12345680'); editor.setPaint('stroke', '#abcdef40');
    app.toggleTextStyle('fontStyle', 'italic'); app.toggleTextStyle('decoration', 'underline');
    expect(editor.selected()!.typography).toMatchObject({ fontStyle: 'italic', decoration: 'underline' });
    app.toggleTextStyle('decoration', 'line-through'); expect(editor.selected()!.typography?.decoration).toBe('line-through');
    app.toggleTextStyle('decoration', 'line-through'); app.toggleTextStyle('fontStyle', 'italic');
    expect(editor.selected()!.typography).toMatchObject({ fontStyle: 'normal', decoration: 'none' });
    expect(editor.selected()).toMatchObject({ fill: '#12345680', stroke: '#abcdef40', opacity: 1 });
  });

  it('previews exactly composed draft geometry without mutation and commits auto dimensions once', () => {
    app.setTextSizing('content');
    const before = structuredClone(editor.document());
    app.textEditing.set(editor.selectedId()); app.textDraft.set('A much longer draft\nSecond paragraph');
    const preview = app.inlineLayer()!;
    expect(preview.text).toBe(app.textDraft()); expect(preview.width).toBeGreaterThan(before.layers[0].width);
    expect(preview.height).toBeGreaterThan(before.layers[0].height);
    expect(app.inlineMetrics(preview)).toEqual(editor.textMetrics(preview));
    expect(editor.document()).toEqual(before);
    app.commitText(); expect(editor.selected()!.text).toBe(preview.text); expect(editor.selected()!.width).toBe(preview.width);
    editor.undo(); expect(editor.document()).toEqual(before);
  });

  it('keeps a fixed text frame fixed when committing extra lines and preserves source on Escape', () => {
    editor.updateTextLayout({ sizing: 'fixed', wrap: true });
    const before = structuredClone(editor.document());
    app.textEditing.set(editor.selectedId()); app.textDraft.set('One\nTwo\nThree\nFour\nFive'); app.commitText();
    expect(editor.selected()!.height).toBe(before.layers[0].height);
    app.textEditing.set(editor.selectedId()); app.textDraft.set('Cancelled draft');
    app.textKey(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(app.inlineLayer()).toBeNull(); expect(editor.selected()!.text).toBe('One\nTwo\nThree\nFour\nFive');
  });

  it('stores language and hyphenation separately from source text and keeps fit size derived', () => {
    const source = editor.selected()!.text;
    editor.updateTypography({ language: 'es' }); app.toggleTextOption('hyphenate');
    expect(editor.selected()!.typography?.language).toBe('es'); expect(editor.selected()!.textLayout?.hyphenate).toBe(true);
    expect(editor.selected()!.text).toBe(source);
    editor.updateLayer({ width: 20, height: 12 }); app.patchNumber('fontSize', input(40)); app.toggleTextOption('fit');
    expect(editor.textMetrics(editor.selected()!).fontSize).toBeLessThan(40); expect(editor.selected()!.fontSize).toBe(40);
  });
});
