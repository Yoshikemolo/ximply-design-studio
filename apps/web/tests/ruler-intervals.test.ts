// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { PreferencesService } from '../src/app/preferences.service';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';

describe('independent ruler intervals', () => {
  beforeEach(() => localStorage.clear());
  it('persists both intervals and independent magnetic switches without changing the master switch', () => {
    const preferences = new PreferencesService();
    preferences.setMeasurement('rulerStep', 96);
    preferences.setMeasurement('rulerMinorStep', 12);
    preferences.setMeasurement('snapRulerMajor', false);
    preferences.setMeasurement('snapRulerMinor', true);
    const restored = new PreferencesService();
    expect(restored.rulerStep()).toBe(96);
    expect(restored.rulerMinorStep()).toBe(12);
    expect(restored.snapRulerMajor()).toBe(false);
    expect(restored.snapRulerMinor()).toBe(true);
    expect(restored.snapRulers()).toBe(false);
    const component = Object.assign(Object.create(AppComponent.prototype), { preferences: restored }) as AppComponent;
    component.toggleSnap('rulers');
    expect(restored.snapRulers()).toBe(true);
    expect(restored.snapRulerMajor()).toBe(false);
    expect(restored.snapRulerMinor()).toBe(true);
  });
  it.each([.01, 100, 254])('migrates legacy major interval %s preserving its old snapping behavior', major => {
    const preferences = new PreferencesService();
    preferences.setMeasurement('rulerStep', major);
    preferences.setMeasurement('snapRulers', true);
    const saved = JSON.parse(localStorage.getItem('xds-input-settings')!);
    delete saved.measurements.rulerMinorStep;
    delete saved.measurements.snapRulerMajor;
    delete saved.measurements.snapRulerMinor;
    localStorage.setItem('xds-input-settings', JSON.stringify(saved));
    const restored = new PreferencesService();
    expect(restored.error()).toBe('');
    expect(restored.rulerStep()).toBe(major);
    expect(restored.rulerMinorStep()).toBe(Math.max(.01, major / 10));
    expect(restored.snapRulers()).toBe(true);
    expect(restored.snapRulerMajor()).toBe(true);
    expect(restored.snapRulerMinor()).toBe(false);
  });
  it('rejects invalid intervals and feeds both configured intervals to the ruler geometry', () => {
    const preferences = new PreferencesService();
    for (const value of [0, -.1, Infinity, NaN, 100001]) {
      expect(preferences.setMeasurement('rulerMinorStep', value)).toBe(false);
      expect(preferences.rulerMinorStep()).toBe(10);
    }
    const editor = new EditorService();
    editor.document.update(doc => ({ ...doc, width: 200, height: 100 }));
    editor.zoom.set(1);
    const component = Object.assign(Object.create(AppComponent.prototype), { preferences, editor }) as AppComponent;
    expect(component.rulerTicks('horizontal').filter(tick => tick.major).map(tick => tick.position)).toEqual([0, 100, 200]);
    expect(component.rulerTicks('vertical').find(tick => tick.position === 10)?.major).toBe(false);
  });

  it('lays out the ruler snapping switches side by side on one row, each beside its label', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const start = html.indexOf('<div class="tick-toggles">'), group = html.slice(start, html.indexOf('</div>', start));
    expect(group).toContain('<div class="tick-toggles">');
    expect(group.match(/class="tick-row"/g)).toHaveLength(2);
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    expect(styles).toMatch(/\.tick-toggles \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*align-items: center;/);
    // More specific than the column layout of the other fields, so each label stays beside its switch.
    expect(styles).toMatch(/\.measurement-settings \.tick-toggles label\.tick-row \{ flex-direction: row; align-items: center;/);
    // The half mark is longer than a minor mark and shorter than the ruler.
    expect(styles).toContain('.horizontal-ruler .ruler-tick.minor.half { height: 11px; }');
    expect(html).toContain('[class.half]="tick.half"');
  });
});
