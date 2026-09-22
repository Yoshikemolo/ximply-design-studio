import { describe, expect, it } from 'vitest';
import { GradientPaint, blendFillPaint, validGradient } from '../src/paint';

const redBlue: GradientPaint = { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: '#ff0000', location: 0, midpoint: 50 }, { color: '#0000ff', location: 100, midpoint: 50 }] };
const blackWhite: GradientPaint = { kind: 'gradient', type: 'linear', angle: 90, stops: [{ color: '#000000', location: 0, midpoint: 50 }, { color: '#ffffff', location: 100, midpoint: 50 }] };

describe('blending gradients', () => {
  it('mixes two gradients stop by stop and turns between their angles', () => {
    const half = blendFillPaint({ fill: '#ff0000', fillPaint: redBlue }, { fill: '#000000', fillPaint: blackWhite }, 0.5) as GradientPaint;
    expect(half.stops.map((s) => [s.location, s.color])).toEqual([[0, '#800000'], [100, '#8080ff']]);
    expect(half.angle).toBe(45);
    expect(validGradient(half)).toBe(true);
  });

  it('keeps the stops of both ends, moved midpoints included', () => {
    const three = { ...redBlue, stops: [redBlue.stops[0], { color: '#00ff00', location: 30, midpoint: 50 }, redBlue.stops[1]] };
    const step = blendFillPaint({ fill: '#ff0000', fillPaint: three }, { fill: '#000000', fillPaint: { ...blackWhite, stops: [{ ...blackWhite.stops[0], midpoint: 80 }, blackWhite.stops[1]] } }, 0.25) as GradientPaint;
    expect(step.stops.map((s) => s.location)).toEqual([0, 30, 80, 100]);
  });

  it('fades a gradient into the flat colour of the other end, in proportion to the step', () => {
    const quarter = blendFillPaint({ fill: '#ff0000', fillPaint: redBlue }, { fill: '#ffffff' }, 0.25) as GradientPaint;
    // A quarter of the way to white at both ends of the gradient.
    expect(quarter.stops.map((s) => s.color)).toEqual(['#ff4040', '#4040ff']);
    const fromSolid = blendFillPaint({ fill: '#ffffff' }, { fill: '#ff0000', fillPaint: redBlue }, 0.75) as GradientPaint;
    expect(fromSolid.stops.map((s) => s.color)).toEqual(['#ff4040', '#4040ff']);
  });

  it('fades a gradient out towards an end without a fill', () => {
    const half = blendFillPaint({ fill: '#ff0000', fillPaint: redBlue }, { fill: 'none' }, 0.5) as GradientPaint;
    expect(half.stops.map((s) => s.color)).toEqual(['#ff000080', '#0000ff80']);
  });

  it('leaves flat colours alone and gives patterns to the nearer end', () => {
    expect(blendFillPaint({ fill: '#ff0000' }, { fill: '#0000ff' }, 0.5)).toBeUndefined();
    const pattern = { kind: 'pattern' as const, patternId: 'p' };
    expect(blendFillPaint({ fill: '#000000', fillPaint: pattern }, { fill: '#ffffff', fillPaint: redBlue }, 0.2)).toEqual(pattern);
    expect(blendFillPaint({ fill: '#000000', fillPaint: pattern }, { fill: '#ffffff', fillPaint: redBlue }, 0.8)).toBeUndefined();
  });

  it('moves the dragged gradient line between the ends', () => {
    const a = { ...redBlue, vector: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } };
    const b = { ...redBlue, vector: { start: { x: 0, y: 1 }, end: { x: 1, y: 1 } } };
    const half = blendFillPaint({ fill: '#ff0000', fillPaint: a }, { fill: '#ff0000', fillPaint: b }, 0.5) as GradientPaint;
    expect(half.vector).toEqual({ start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } });
  });
});
