// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { AppComponent } from '../src/app/app.component';
import { parseDocument, newLayer } from '../../../packages/domain/src/document';
import { MARGIN_GUIDE_PREFIX, PAGE_FORMATS, REGISTRATION_LAYER_NAME, defaultMarginGuides, marginGuidePositions, pageSize, pageSizeFits, registrationFits } from '../../../packages/domain/src/page-setup';

beforeEach(() => localStorage.clear());
const format = (id: string) => PAGE_FORMATS.find((entry) => entry.id === id)!;

describe('page formats', () => {
  it('turns paper sizes into pixels at the chosen resolution and orientation', () => {
    // A4 is 210 by 297 mm; at 96 dpi that is 794 by 1123 document pixels.
    expect(pageSize(format('a4'), 96, 'portrait')).toEqual({ width: 794, height: 1123 });
    expect(pageSize(format('a4'), 96, 'landscape')).toEqual({ width: 1123, height: 794 });
    expect(pageSize(format('a4'), 300, 'portrait')).toEqual({ width: 2480, height: 3508 });
    // Pixel formats ignore the resolution.
    expect(pageSize(format('screen-fhd'), 300, 'landscape')).toEqual({ width: 1920, height: 1080 });
  });

  it('reports the sizes the native format cannot store', () => {
    expect(pageSizeFits(pageSize(format('a4'), 300, 'portrait'))).toBe(true);
    // A3 at 300 dpi is 4961 pixels tall, beyond the 4096 limit; UHD still fits.
    expect(pageSizeFits(pageSize(format('a3'), 300, 'portrait'))).toBe(false);
    expect(pageSizeFits(pageSize(format('screen-uhd'), 96, 'landscape'))).toBe(true);
    expect(pageSizeFits({ width: 10, height: 100 })).toBe(false);
  });

  it('places margin guides and their centres between the margins', () => {
    const guides = marginGuidePositions({ width: 1000, height: 800 }, { ...defaultMarginGuides, top: 50, right: 100, bottom: 50, left: 100, edges: true, centerX: true, centerY: true });
    expect(guides.filter((guide) => guide.axis === 'vertical').map((guide) => guide.position)).toEqual([100, 900, 500]);
    expect(guides.filter((guide) => guide.axis === 'horizontal').map((guide) => guide.position)).toEqual([50, 750, 400]);
    expect(marginGuidePositions({ width: 100, height: 100 }, { ...defaultMarginGuides, left: 60, right: 60, edges: true })).toEqual([]);
  });
});

describe('page setup on a document', () => {
  it('applies size, background, margin guides and registration marks in one step', () => {
    const e = new EditorService();
    const applied = e.applyPageSetup({ size: { width: 794, height: 1123 }, background: '#f4f4f4', margins: { ...defaultMarginGuides, top: 40, right: 40, bottom: 40, left: 40, edges: true, centerX: true, centerY: true }, marks: 'file4' });
    expect(applied).toBe(true);
    const document = e.document();
    expect([document.width, document.height, document.background]).toEqual([794, 1123, '#f4f4f4']);
    expect(document.layers.filter((layer) => layer.name.startsWith(MARGIN_GUIDE_PREFIX))).toHaveLength(6);
    const marks = document.layers.find((layer) => layer.name === REGISTRATION_LAYER_NAME)!;
    expect(marks.locked).toBe(true);
    expect(marks.curves).toHaveLength(4);
    expect(parseDocument(JSON.stringify(document)).layers.length).toBe(document.layers.length);
    e.undo();
    expect(e.document().layers).toHaveLength(0);
  });

  it('replaces the previous guides and marks instead of stacking them', () => {
    const e = new EditorService();
    const margins = { ...defaultMarginGuides, top: 20, right: 20, bottom: 20, left: 20, edges: true };
    e.applyPageSetup({ margins, marks: 'file2' });
    e.applyPageSetup({ margins, marks: 'animation' });
    expect(e.document().layers.filter((layer) => layer.name.startsWith(MARGIN_GUIDE_PREFIX))).toHaveLength(4);
    expect(e.document().layers.filter((layer) => layer.name === REGISTRATION_LAYER_NAME)).toHaveLength(1);
    e.applyPageSetup({ margins: defaultMarginGuides, marks: 'none' });
    expect(e.document().layers).toHaveLength(0);
  });

  it('refuses a page or marks that do not fit', () => {
    const e = new EditorService();
    expect(e.applyPageSetup({ size: { width: 5000, height: 400 } })).toBe(false);
    expect(e.status()).toContain('16 and 4096');
    expect(registrationFits('file8', { width: 400, height: 400 })).toBe(false);
    expect(e.applyPageSetup({ size: { width: 400, height: 400 }, marks: 'file8' })).toBe(false);
    expect(e.document().width).toBe(1200);
  });

  it('expands and crops the page and carries the artwork with it', () => {
    const e = new EditorService();
    e.document.update((document) => ({ ...document, layers: [{ ...newLayer('rectangle', 'art', { x: 100, y: 100 }), width: 50, height: 50 }] }));
    expect(e.expandPage({ top: 100, right: 0, bottom: 0, left: 200 })).toBe(true);
    expect([e.document().width, e.document().height]).toEqual([1400, 900]);
    expect([e.document().layers[0].x, e.document().layers[0].y]).toEqual([300, 200]);
    expect(e.cropPage({ top: 100, right: 0, bottom: 0, left: 200 })).toBe(true);
    expect([e.document().width, e.document().height]).toEqual([1200, 800]);
    expect([e.document().layers[0].x, e.document().layers[0].y]).toEqual([100, 100]);
    expect(e.cropPage({ top: 0, right: 0, bottom: 0, left: 1190 })).toBe(false);
    expect(e.document().width).toBe(1200);
  });
});

describe('displayed decimals', () => {
  it('rounds measurements for display only', () => {
    const app = Object.create(AppComponent.prototype) as AppComponent;
    const preferences = new PreferencesService();
    Object.assign(app, { preferences });
    preferences.setMeasurement('distanceUnit', 'in');
    preferences.setMeasurement('displayDecimals', 2);
    expect(app.displayDistance(100)).toBe(1.04);
    expect(app.exactDistance(100)).toBeCloseTo(1.0416667, 6);
    preferences.setMeasurement('displayDecimals', 4);
    expect(app.displayDistance(100)).toBe(1.0417);
    preferences.setMeasurement('displayDecimals', 0);
    expect(app.displayDistance(100)).toBe(1);
    for (const invalid of [-1, 9, 1.5, '2']) {
      expect(preferences.setMeasurement('displayDecimals', invalid as number)).toBe(false);
      expect(preferences.displayDecimals()).toBe(0);
    }
  });
});
