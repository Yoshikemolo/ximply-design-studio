// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { newLayer } from '../../../packages/domain/src/document';
import { GradientPaint } from '../../../packages/domain/src/paint';

const fade: GradientPaint = { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: '#000000', location: 0, midpoint: 50 }, { color: '#ffffff', location: 100, midpoint: 50 }] };
const field = (value: string) => ({ target: { value } }) as unknown as Event;
function component() {
  const editor = new EditorService(), preferences = new PreferencesService();
  const box = { ...newLayer('rectangle', 'box', { x: 0, y: 0 }, '#ff0000', 'none', 0), width: 100, height: 50 };
  editor.document.update((d) => ({ ...d, version: 2, layers: [box] }));
  editor.selectedIds.set(['box']);
  editor.selectedId.set('box');
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    editor, preferences, paintTarget: signal('fill'), swatchKind: signal('all'), swatchTarget: signal('fill'), chosenSwatch: signal(null),
  });
  return { app, editor, preferences };
}
beforeEach(() => localStorage.clear());

describe('the fill kinds', () => {
  it('switch the fill between a colour, a gradient, a pattern and none', () => {
    const { app, editor } = component();
    expect(app.fillKind()).toBe('color');
    app.setFillKind('gradient');
    expect(app.fillKind()).toBe('gradient');
    app.setFillKind('pattern');
    expect(app.fillKind()).toBe('pattern');
    expect(editor.document().patterns).toHaveLength(1);
    app.setFillKind('none');
    expect(app.fillKind()).toBe('none');
    app.setFillKind('color');
    expect(app.fillKind()).toBe('color');
    expect(editor.document().layers[0].fillPaint).toBeUndefined();
  });
});

describe('the gradient editor', () => {
  it('adds a stop in the widest gap in the colour already there, and removes it again', () => {
    const { app, editor } = component();
    editor.setFillPaint(fade);
    app.addStop();
    const stops = (editor.document().layers[0].fillPaint as GradientPaint).stops;
    expect(stops.map((s) => [s.location, s.color])).toEqual([[0, '#000000'], [50, '#808080'], [100, '#ffffff']]);
    app.removeStop(1);
    expect((editor.document().layers[0].fillPaint as GradientPaint).stops).toHaveLength(2);
    app.removeStop(0);
    expect((editor.document().layers[0].fillPaint as GradientPaint).stops).toHaveLength(2);
  });

  it('reverses the stops with their midpoints', () => {
    const { app, editor } = component();
    editor.setFillPaint({ ...fade, stops: [{ color: '#000000', location: 10, midpoint: 30 }, { color: '#ffffff', location: 100, midpoint: 50 }] });
    app.reverseGradient();
    expect((editor.document().layers[0].fillPaint as GradientPaint).stops).toEqual([
      { color: '#ffffff', location: 0, midpoint: 70 }, { color: '#000000', location: 90, midpoint: 50 },
    ]);
  });

  it('refuses a midpoint out of range, and an angle drops the dragged line', () => {
    const { app, editor } = component();
    editor.setFillPaint({ ...fade, vector: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } });
    app.setStop(0, 'midpoint', field('90'));
    expect((editor.document().layers[0].fillPaint as GradientPaint).stops[0].midpoint).toBe(50);
    app.setGradientAngle(field('45'));
    const paint = editor.document().layers[0].fillPaint as GradientPaint;
    expect(paint.angle).toBe(45);
    expect(paint.vector).toBeUndefined();
  });

  it('pictures gradients in CSS as they are painted', () => {
    const { app } = component();
    expect(app.gradientCss(fade)).toBe('linear-gradient(90deg, #000000 0%, #ffffff 100%)');
    expect(app.gradientCss({ ...fade, angle: 90 })).toBe('linear-gradient(0deg, #000000 0%, #ffffff 100%)');
    expect(app.gradientCss({ ...fade, type: 'radial' })).toBe('radial-gradient(circle, #000000 0%, #ffffff 100%)');
  });
});

describe('the colour modes', () => {
  it('edit the same colour as RGB, CMYK and grey channels', () => {
    const { app, editor } = component();
    app.setRgbChannel('g', field('255'));
    expect(editor.document().layers[0].fill).toBe('#ffff00');
    app.setCmykChannel('y', field('0'));
    expect(editor.document().layers[0].fill).toBe('#ffffff');
    app.setGrayLevel(field('100'));
    expect(editor.document().layers[0].fill).toBe('#000000');
    app.setRgbChannel('r', field('300'));
    expect(editor.document().layers[0].fill).toBe('#000000');
  });

  it('keep the mode and the custom palette between sessions, Quick RGB first', () => {
    const { preferences } = component();
    expect(preferences.colorMode()).toBe('quick');
    expect(preferences.setColorMode('cmyk')).toBe(true);
    expect(preferences.setColorMode('lab')).toBe(false);
    expect(preferences.addPaletteColor('#12AB34')).toBe(true);
    expect(preferences.addPaletteColor('#12ab34')).toBe(false);
    const restored = new PreferencesService();
    expect(restored.colorMode()).toBe('cmyk');
    expect(restored.customPalette()).toEqual(['#12ab34']);
    expect(restored.removePaletteColor('#12ab34')).toBe(true);
  });
});

describe('the Swatches panel', () => {
  it('is hidden until View shows it, and filters swatches by kind', () => {
    const { app, preferences } = component();
    expect(preferences.layoutBlocks().swatches).toBe(false);
    preferences.toggleLayoutBlock('swatches');
    expect(new PreferencesService().layoutBlocks().swatches).toBe(true);
    app.setSwatchKind('gradient');
    expect(app.visibleSwatches().every((s) => s.kind === 'gradient')).toBe(true);
    app.setSwatchKind('everything');
    expect(app.swatchKind()).toBe('gradient');
  });

  it('applies a swatch to the chosen paint, keeps a new one and deletes it', () => {
    const { app, editor } = component();
    const color = editor.documentSwatches().find((s) => s.kind === 'color' && s.color !== '#ff0000')!;
    app.swatchTarget.set('stroke');
    app.pickSwatch(color);
    expect(editor.document().layers[0].stroke).toBe(color.kind === 'color' ? color.color : '');
    app.newSwatch();
    const kept = app.chosenSwatch()!;
    expect(editor.documentSwatches().some((s) => s.id === kept)).toBe(true);
    app.deleteSwatch();
    expect(editor.documentSwatches().some((s) => s.id === kept)).toBe(false);
  });

  it('opens at the top of the panels, and its texts have Spanish entries', () => {
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const inspector = html.indexOf('<aside class="inspector"');
    expect(html.indexOf('swatches-panel', inspector)).toBeLessThan(html.indexOf('drawing-options', inspector));
    const i18n = readFileSync('apps/web/src/app/i18n.ts', 'utf8');
    for (const text of ['Swatches', 'Quick RGB', 'Custom palette', 'Define pattern', 'Reverse gradient', 'New swatch'])
      expect(i18n).toContain('"' + text + '":');
  });
});
