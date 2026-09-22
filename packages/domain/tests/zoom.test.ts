import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS, stepZoom } from '../src/zoom';

describe('zoom presets', () => {
  it('step to the next preset in and the previous one out', () => {
    expect(stepZoom(1, 'in')).toBe(1.5);
    expect(stepZoom(1, 'out')).toBe(0.6667);
    // From between two presets, the nearest one on that side.
    expect(stepZoom(0.7, 'in')).toBe(1);
    expect(stepZoom(0.7, 'out')).toBe(0.6667);
  });

  it('stop at the ends of the range', () => {
    expect(stepZoom(ZOOM_MAX, 'in')).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, 'out')).toBe(ZOOM_MIN);
    expect(ZOOM_PRESETS[0]).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(ZOOM_PRESETS.includes(1)).toBe(true);
  });
});
