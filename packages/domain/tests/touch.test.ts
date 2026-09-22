import { describe, expect, it } from 'vitest';
import { edgeSwipe, twoFingerChange, zoomAround, EDGE_ZONE } from '../src/touch';

describe('two fingers', () => {
  it('measure a pinch as the ratio of their distances', () => {
    const change = twoFingerChange([{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 50, y: 100 }, { x: 250, y: 100 }]);
    expect(change.scale).toBeCloseTo(2, 9);
    expect(change.rotation).toBeCloseTo(0, 9);
    expect(change.shift).toEqual({ x: 0, y: 0 });
  });

  it('measure a twist as the turn of the line between them, the short way round', () => {
    const quarter = twoFingerChange([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: -50 }, { x: 50, y: 50 }]);
    expect(quarter.rotation).toBeCloseTo(90, 9);
    expect(quarter.scale).toBeCloseTo(1, 9);
    const across = twoFingerChange([{ x: 0, y: 0 }, { x: -100, y: 1 }], [{ x: 0, y: 0 }, { x: -100, y: -1 }]);
    expect(Math.abs(across.rotation)).toBeLessThan(2);
  });

  it('measure a drag as the travel of their midpoint', () => {
    const change = twoFingerChange([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 30, y: 40 }, { x: 130, y: 40 }]);
    expect(change.shift).toEqual({ x: 30, y: 40 });
  });
});

describe('zooming around the fingers', () => {
  it('keeps the point of the drawing under the fingers', () => {
    const origin = { x: 20, y: 30 }, fingers = { x: 220, y: 330 };
    const next = zoomAround(origin, 1, 2, fingers, fingers);
    // The drawing point (200, 300) must still land on the fingers at the new zoom.
    expect(next.x + 200 * 2).toBeCloseTo(fingers.x, 9);
    expect(next.y + 300 * 2).toBeCloseTo(fingers.y, 9);
  });

  it('follows the fingers when they also travel', () => {
    const next = zoomAround({ x: 0, y: 0 }, 1, 1, { x: 100, y: 100 }, { x: 150, y: 90 });
    expect(next).toEqual({ x: 50, y: -10 });
  });
});

describe('edge swipes', () => {
  const closed = { left: false, right: false };
  it('open the panel on the side the swipe comes in from', () => {
    expect(edgeSwipe({ x: 5, y: 300 }, { x: 120, y: 310 }, 400, closed)).toBe('openLeft');
    expect(edgeSwipe({ x: 395, y: 300 }, { x: 250, y: 290 }, 400, closed)).toBe('openRight');
  });

  it('ignore swipes that start away from the edges, are too short or mostly vertical', () => {
    expect(edgeSwipe({ x: EDGE_ZONE + 20, y: 300 }, { x: 200, y: 300 }, 400, closed)).toBeNull();
    expect(edgeSwipe({ x: 5, y: 300 }, { x: 30, y: 300 }, 400, closed)).toBeNull();
    expect(edgeSwipe({ x: 5, y: 100 }, { x: 60, y: 300 }, 400, closed)).toBeNull();
  });

  it('close an open panel with a swipe back toward its edge', () => {
    expect(edgeSwipe({ x: 200, y: 300 }, { x: 60, y: 300 }, 400, { left: true, right: false })).toBe('closeLeft');
    expect(edgeSwipe({ x: 200, y: 300 }, { x: 340, y: 300 }, 400, { left: false, right: true })).toBe('closeRight');
  });
});
