// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { brushStamps, defaultBrush, previewStroke, validBrushSettings, BRUSH_TYPES } from '../../../packages/domain/src/brush';
import { TOOLS, TOOL_FAMILIES } from '../src/app/tools';

beforeEach(() => localStorage.clear());
const from = { x: 0, y: 0 }, to = { x: 100, y: 0 };

describe('brush tips', () => {
  it('spaces stamps by the cadence and keeps them inside the segment', () => {
    const dense = brushStamps(from, to, 20, { ...defaultBrush, cadence: 25 });
    const sparse = brushStamps(from, to, 20, { ...defaultBrush, cadence: 100 });
    expect(dense.length).toBeGreaterThan(sparse.length);
    expect(dense.at(-1)!.center).toEqual(to);
    expect(dense.every((stamp) => stamp.center.x >= 0 && stamp.center.x <= 100)).toBe(true);
  });

  it('gives each tip its own width, opacity and softness', () => {
    const shapes = Object.fromEntries(BRUSH_TYPES.map((type) => [type, brushStamps(from, to, 20, { ...defaultBrush, type })[0]]));
    expect(shapes.round.radiusY).toBeCloseTo(shapes.round.radiusX);
    expect(shapes.calligraphy.radiusY).toBeLessThan(shapes.flat.radiusY);
    expect(shapes.airbrush.alpha).toBeLessThan(shapes.round.alpha);
    expect(shapes.airbrush.blur).toBeGreaterThan(0);
    expect(shapes.round.blur).toBe(0);
  });

  it('applies pressure, opacity, angle and speed variation', () => {
    const base = brushStamps(from, to, 20, defaultBrush)[0];
    expect(brushStamps(from, to, 20, { ...defaultBrush, pressure: 50 })[0].radiusX).toBeCloseTo(base.radiusX / 2);
    expect(brushStamps(from, to, 20, { ...defaultBrush, opacity: 40 })[0].alpha).toBeCloseTo(0.4);
    expect(brushStamps(from, to, 20, { ...defaultBrush, type: 'flat', angle: 90 })[0].angle).toBeCloseTo(Math.PI / 2);
    // A round tip ignores the angle, and speed only thins the stroke when the option is on.
    expect(brushStamps(from, to, 20, { ...defaultBrush, angle: 90 })[0].angle).toBe(0);
    expect(brushStamps(from, to, 20, { ...defaultBrush }, 200)[0].radiusX).toBeCloseTo(base.radiusX);
    expect(brushStamps(from, to, 20, { ...defaultBrush, speedVariation: -100 }, 200)[0].radiusX).toBeLessThan(base.radiusX);
    // The nominal size sits in the middle of the range: a positive setting thickens the fast stroke.
    expect(brushStamps(from, to, 20, { ...defaultBrush, speedVariation: 100 }, 200)[0].radiusX).toBeGreaterThan(base.radiusX);
  });

  it('rejects settings outside their range', () => {
    expect(validBrushSettings(defaultBrush)).toBe(true);
    for (const invalid of [{ type: 'sponge' }, { pressure: 0 }, { opacity: 120 }, { cadence: 0 }, { angle: 200 }, { blend: 'glow' }, { speedVariation: 200 }, { speedVariation: 'fast' }]) {
      expect(validBrushSettings({ ...defaultBrush, ...invalid })).toBe(false);
    }
    expect(brushStamps(from, to, 0, defaultBrush)).toEqual([]);
  });

  it('draws a sinuous preview across its box', () => {
    const stroke = previewStroke(140, 34);
    expect(stroke[0]).toEqual({ x: 0, y: 17 });
    expect(stroke.at(-1)!.x).toBe(140);
    expect(Math.max(...stroke.map((point) => point.y))).toBeGreaterThan(17);
    expect(Math.min(...stroke.map((point) => point.y))).toBeLessThan(17);
  });
});

describe('brush subtools', () => {
  it('offers one tool per tip in the brush family', () => {
    const family = TOOL_FAMILIES.find((entry) => entry.id === 'paint')!;
    expect(family.tools).toEqual(['brush', 'brushFlat', 'brushCalligraphy', 'brushMarker', 'brushAirbrush', 'brushPencil']);
    expect(TOOLS.filter((tool) => family.tools.includes(tool.id))).toHaveLength(6);
  });

  it('selects the brush and its tip together', () => {
    const e = new EditorService();
    e.setTool('brushCalligraphy');
    expect(e.tool()).toBe('brush');
    expect(e.brushFor('brush').type).toBe('calligraphy');
    e.setTool('brush');
    expect(e.brushFor('brush').type).toBe('round');
    expect(e.updateBrush('eraser', { diffusion: 40 })).toBe(true);
    expect(e.brushFor('eraser').diffusion).toBe(40);
    expect(e.brushFor('brush').diffusion).toBe(0);
    expect(e.updateBrush('brush', { cadence: 0 })).toBe(false);
  });
});
