import { describe, expect, it } from 'vitest';
import { Layer, hitTest, newLayer } from '../src/document';

// An open arc from (0,100) up through (50,0) to (100,100): its fill closes it back along the base.
const arch = (fill: string, extra: Partial<Layer> = {}): Layer => ({
  ...newLayer('path', 'arch', { x: 0, y: 0 }, fill, '#000000', 2), width: 100, height: 100,
  curves: [{ closed: false, nodes: [{ x: 0, y: 100 }, { x: 50, y: 0 }, { x: 100, y: 100 }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) }],
  ...extra,
});

describe('picking an open curve', () => {
  it('selects a filled open curve by the area its fill paints', () => {
    expect(hitTest(arch('#ff0000'), { x: 50, y: 70 })).toBe(true);
    expect(hitTest(arch('#ff0000'), { x: 10, y: 20 })).toBe(false);
  });

  it('selects an unfilled open curve by its outline only', () => {
    expect(hitTest(arch('none'), { x: 50, y: 70 })).toBe(false);
    expect(hitTest(arch('none'), { x: 25, y: 50 })).toBe(true);
  });

  it('never picks a locked or hidden curve by its fill', () => {
    expect(hitTest(arch('#ff0000', { locked: true }), { x: 50, y: 70 })).toBe(false);
    expect(hitTest(arch('#ff0000', { visible: false }), { x: 50, y: 70 })).toBe(false);
  });
});
