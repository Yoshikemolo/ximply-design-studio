// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';

/** A 100 by 100 square at (100, 100) with the Rotate tool and the pivot at its top left corner. */
function rotating() {
  localStorage.clear();
  const e = new EditorService();
  e.zoom.set(1);
  e.document.update((d) => ({ ...d, layers: [{ ...newLayer('rectangle', 'sq', { x: 100, y: 100 }), width: 100, height: 100 }] }));
  e.selectLayer('sq');
  e.setTool('rotate');
  e.setPivot({ x: 100, y: 100 });
  return e;
}
const centre = (e: EditorService) => { const l = e.document().layers[0]; return { x: l.x + l.width / 2, y: l.y + l.height / 2 }; };
const distanceToPivot = (e: EditorService) => Math.hypot(centre(e).x - 100, centre(e).y - 100);
beforeEach(() => localStorage.clear());

describe('the Rotate tool about a pivot away from the centre', () => {
  it('measures the angle about the pivot, so a quarter turn of the pointer is a quarter turn', () => {
    const e = rotating();
    e.start({ x: 250, y: 100 });
    e.move({ x: 100, y: 250 });
    expect(e.document().layers[0].rotation).toBeCloseTo(90, 6);
    expect(distanceToPivot(e)).toBeCloseTo(Math.SQRT2 * 50, 6);
    e.end();
  });

  it('keeps the object about the pivot when the pointer passes over the centre and the pivot', () => {
    const e = rotating();
    e.start({ x: 250, y: 100 });
    // Across the middle of the object, then right onto the pivot and a hair around it.
    for (const p of [{ x: 150, y: 150 }, { x: 151, y: 149 }, { x: 102, y: 101 }, { x: 100.5, y: 100.2 }, { x: 99, y: 101 }]) {
      e.move(p);
      expect(distanceToPivot(e)).toBeCloseTo(Math.SQRT2 * 50, 6);
      expect(Number.isFinite(e.document().layers[0].x)).toBe(true);
    }
    e.end();
    // The square stays on the page.
    const l = e.document().layers[0];
    expect(l.x).toBeGreaterThan(-100);
    expect(l.y).toBeGreaterThan(-100);
  });

  it('holds the angle while the pointer rests on the pivot', () => {
    const e = rotating();
    e.start({ x: 250, y: 100 });
    e.move({ x: 250, y: 250 });
    const turned = e.document().layers[0].rotation;
    e.move({ x: 101, y: 101 });
    expect(e.document().layers[0].rotation).toBe(turned);
    e.end();
  });
});
