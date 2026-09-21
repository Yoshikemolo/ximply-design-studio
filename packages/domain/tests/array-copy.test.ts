import { describe, expect, it } from 'vitest';
import { newLayer } from '../src/document';
import { arraySteps, copyLayer, DEFAULT_ARRAY, validArraySettings } from '../src/array-copy';

const settings = (overrides: Partial<typeof DEFAULT_ARRAY>) => ({ ...DEFAULT_ARRAY, ...overrides });
const origin = { x: 0, y: 0 };
const square = () => ({ ...newLayer('rectangle', 'a', { x: 90, y: 90 }), width: 20, height: 20 });

describe('linear series', () => {
  it('repeats the step, the turn and the relative size of each copy', () => {
    const steps = arraySteps(settings({ mode: 'linear', copies: 3, stepX: 10, stepY: -5, rotation: 15, scale: 50 }), origin, origin);
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => [step.dx, step.dy])).toEqual([[10, -5], [20, -10], [30, -15]]);
    expect(steps.map((step) => step.rotation)).toEqual([15, 30, 45]);
    // Half the size each time compounds, as it does in a series.
    expect(steps.map((step) => step.scale)).toEqual([0.5, 0.25, 0.125]);
  });
});

describe('circular series', () => {
  it('shares a full turn between the original and its copies, around the pivot', () => {
    const centre = { x: 100, y: 0 };
    const steps = arraySteps(settings({ mode: 'circular', copies: 3, sweep: 360, orient: true }), origin, centre);
    expect(steps).toHaveLength(3);
    // Four positions on a circle of radius 100: the copies land at 90, 180 and 270 degrees.
    const places = steps.map((step) => ({ x: centre.x + step.dx, y: centre.y + step.dy }));
    expect(places[0].x).toBeCloseTo(0, 6);
    expect(places[0].y).toBeCloseTo(100, 6);
    expect(places[1].x).toBeCloseTo(-100, 6);
    expect(places[1].y).toBeCloseTo(0, 6);
    expect(places[2].y).toBeCloseTo(-100, 6);
    for (const place of places) expect(Math.hypot(place.x, place.y)).toBeCloseTo(100, 6);
    expect(steps.map((step) => step.rotation)).toEqual([90, 180, 270]);
  });

  it('spreads a partial sweep over the copies and can keep their own rotation', () => {
    const centre = { x: 0, y: -50 };
    const steps = arraySteps(settings({ mode: 'circular', copies: 2, sweep: 90, orient: false }), origin, centre);
    // Ninety degrees over two copies places them at 45 and 90 degrees from the original.
    const places = steps.map((step) => ({ x: centre.x + step.dx, y: centre.y + step.dy }));
    expect(places[1].x).toBeCloseTo(50, 6);
    expect(places[1].y).toBeCloseTo(0, 6);
    expect(Math.hypot(places[0].x, places[0].y)).toBeCloseTo(50, 6);
    expect(steps.every((step) => step.rotation === 0)).toBe(true);
  });
});

describe('grid series', () => {
  it('fills the columns and rows, leaving the original in its place', () => {
    const steps = arraySteps(settings({ mode: 'grid', columns: 3, rows: 2, gapX: 30, gapY: 40 }), origin, origin);
    // Six places in the grid, one of which is the original.
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => [step.dx, step.dy])).toEqual([[30, 0], [60, 0], [0, 40], [30, 40], [60, 40]]);
    const turned = arraySteps(settings({ mode: 'grid', columns: 2, rows: 2, rotation: 10, scale: 200 }), origin, origin);
    expect(turned.map((step) => step.rotation)).toEqual([10, 20, 30]);
    expect(turned.map((step) => step.scale)).toEqual([2, 4, 8]);
  });
});

describe('copies and limits', () => {
  it('places, turns and resizes a copy about the centre of the series', () => {
    const copy = copyLayer(square(), { dx: 10, dy: 0, rotation: 90, scale: 2 }, { x: 100, y: 100 }, 'b');
    // The square sits at the centre, so it only grows, turns and moves by the step:
    // a 40 by 40 box centred at (110, 100) starts at (90, 80).
    expect([copy.x, copy.y]).toEqual([90, 80]);
    expect([copy.width, copy.height]).toEqual([40, 40]);
    expect(copy.rotation).toBe(90);
    expect(copy.id).toBe('b');
    const away = copyLayer({ ...square(), x: 190, y: 90 }, { dx: 0, dy: 0, rotation: 180, scale: 1 }, { x: 100, y: 100 }, 'c');
    // Half a turn about the centre puts a copy on the opposite side of it.
    expect(away.x).toBeCloseTo(-10, 6);
    expect(away.y).toBeCloseTo(90, 6);
  });

  it('refuses settings that would run away', () => {
    expect(validArraySettings(DEFAULT_ARRAY)).toBe(true);
    expect(validArraySettings(settings({ copies: 0 }))).toBe(false);
    expect(validArraySettings(settings({ copies: 500 }))).toBe(false);
    expect(validArraySettings(settings({ scale: 0 }))).toBe(false);
    expect(validArraySettings(settings({ mode: 'grid', columns: 50, rows: 2 }))).toBe(false);
    expect(validArraySettings(settings({ stepX: Number.NaN }))).toBe(false);
    expect(arraySteps(settings({ copies: 0 }), origin, origin)).toEqual([]);
  });
});
