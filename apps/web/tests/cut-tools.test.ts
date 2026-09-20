// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';
import { pathArea } from '../../../packages/domain/src/cut';
import { TOOLS, TOOL_FAMILIES } from '../src/app/tools';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

function withSquare() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({
    ...document,
    layers: [{ ...newLayer('rectangle', 'art', { x: 100, y: 100 }), width: 100, height: 100 }],
  }));
  e.selectLayer('art');
  return e;
}
const click = (e: EditorService, x: number, y: number) => { e.start({ x, y }); e.end(); };

describe('scissors', () => {
  it('cuts a shape at two of its points into two open paths', () => {
    const e = withSquare();
    e.setTool('scissors');
    // The middle of the top side, then the middle of the bottom side.
    click(e, 150, 100);
    expect(e.document().layers).toHaveLength(1);
    expect(e.cutPending()?.tool).toBe('scissors');
    click(e, 150, 200);
    const layers = e.document().layers;
    expect(layers).toHaveLength(2);
    expect(layers.every((layer) => layer.kind === 'path' && layer.curves?.every((path) => !path.closed))).toBe(true);
    expect(e.selectedLayers()).toHaveLength(2);
    expect(e.cutPending()).toBeNull();
    // Each half spans the full height and half the width of the square.
    for (const layer of layers) {
      expect(layer.height).toBeCloseTo(100, 6);
      expect(layer.width).toBeCloseTo(50, 6);
    }
    e.undo();
    expect(e.document().layers).toHaveLength(1);
    expect(e.document().layers[0].id).toBe('art');
  });

  it('forgets a cut in progress on Escape and on a tool change', () => {
    const e = withSquare();
    e.setTool('scissors');
    click(e, 150, 100);
    e.cancel();
    expect(e.cutPending()).toBeNull();
    click(e, 150, 100);
    e.setTool('select');
    expect(e.cutPending()).toBeNull();
    expect(e.document().layers).toHaveLength(1);
  });

  it('says so when the click misses every path', () => {
    const e = withSquare();
    e.setTool('scissors');
    click(e, 600, 600);
    expect(e.status()).toContain('Click on a path');
    expect(e.cutPending()).toBeNull();
  });
});

describe('knife', () => {
  it('divides the selected shape into two closed shapes along the line', () => {
    const e = withSquare();
    e.setTool('knife');
    // A horizontal line at y = 130 across the square, which spans 100 to 200.
    click(e, 60, 130);
    expect(e.cutPending()?.tool).toBe('knife');
    click(e, 260, 130);
    const layers = e.document().layers;
    expect(layers).toHaveLength(2);
    expect(layers.every((layer) => layer.curves?.every((path) => path.closed))).toBe(true);
    const areas = layers.map((layer) => pathArea(layer.curves![0])).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(3000, 0);
    expect(areas[1]).toBeCloseTo(7000, 0);
    expect(e.status()).toContain('two closed shapes');
    e.undo();
    expect(e.document().layers).toHaveLength(1);
  });

  it('leaves the artwork alone when the line does not cross a closed shape twice', () => {
    const e = withSquare();
    e.setTool('knife');
    click(e, 400, 400);
    click(e, 500, 500);
    expect(e.document().layers).toHaveLength(1);
    expect(e.status()).toContain('crosses a closed shape twice');
    expect(e.cutPending()).toBeNull();
  });

  it('previews the line from the first point while the knife waits', () => {
    const e = withSquare();
    e.setTool('knife');
    click(e, 60, 130);
    e.move({ x: 200, y: 140 });
    expect(e.cutPreview()).toEqual({ x: 200, y: 140 });
  });
});

describe('cutting tools', () => {
  it('offers both cutting tools in one family, with the scissors on C', () => {
    const family = TOOL_FAMILIES.find((entry) => entry.id === 'scissors')!;
    expect(family.tools).toEqual(['scissors', 'knife']);
    expect(TOOLS.some((tool) => tool.id === 'knife')).toBe(true);
    expect(defaultShortcuts()['tool.scissors']).toEqual(['C']);
  });
});
