// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { newLayer, resizeFromCorner } from '../../../packages/domain/src/document';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

const square = () => ({ ...newLayer('rectangle', 'art', { x: 100, y: 100 }), width: 100, height: 50 });
function withSquare() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({ ...document, layers: [square()] }));
  e.selectLayer('art');
  e.setTool('select');
  return e;
}

beforeEach(() => localStorage.clear());
describe('outline view', () => {
  it('switches between the two views and offers itself in the View menu', () => {
    const e = withSquare();
    expect(e.outlineView()).toBe(false);
    e.toggleOutlineView();
    expect(e.outlineView()).toBe(true);
    expect(e.status()).toContain('Outline');
    e.toggleOutlineView();
    expect(e.outlineView()).toBe(false);
    expect(defaultShortcuts()['toggleOutline']).toEqual(['Mod+Y']);
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    const view = template.slice(template.indexOf('<summary>{{ t("View") }}</summary>'));
    expect(view.slice(0, view.indexOf('</details>'))).toContain('editor.toggleOutlineView()');
  });

  it('draws the artwork as hairline contours without its paints', () => {
    const renderer = readFileSync('packages/renderer/src/canvas-renderer.ts', 'utf-8');
    const outline = renderer.slice(renderer.indexOf('private asOutline'), renderer.indexOf('private layer('));
    // No paint at all, one ink and a hairline, whatever the layer carried.
    expect(outline).toContain('fill: "none"');
    expect(outline).toContain('stroke: ink');
    expect(outline).toContain('strokeWidth: hairline');
    // An image has no contour of its own, so its frame stands for it.
    expect(outline).toContain('kind: "rectangle"');
    expect(outline).toContain('layer.dimension');
  });
});

describe('proportional corner resize', () => {
  it('keeps the shape of the layer while Shift is held', () => {
    const layer = square();
    // Dragging the bottom right corner to a point that would stretch the height alone.
    const free = resizeFromCorner(layer, { x: 300, y: 160 }, 'br');
    expect([free.width, free.height]).toEqual([200, 60]);
    const held = resizeFromCorner(layer, { x: 300, y: 160 }, 'br', { proportional: true });
    // The larger change decides the factor, so the shape is kept: two hundred by a hundred.
    expect([held.width, held.height]).toEqual([200, 100]);
    expect([held.x, held.y]).toEqual([100, 100]);
    // The opposite corner stays put when the drag goes the other way.
    const across = resizeFromCorner(layer, { x: 0, y: 0 }, 'tl', { proportional: true });
    expect(across.width / across.height).toBeCloseTo(2, 6);
    expect([across.x + across.width, across.y + across.height]).toEqual([200, 150]);
  });

  it('resizes with the pointer and the key through the editor', () => {
    const e = withSquare();
    // Press the bottom right handle of the selection and drag it with Shift held.
    e.start({ x: 200, y: 150 });
    e.move({ x: 300, y: 160 }, { shift: true });
    e.end();
    const layer = e.document().layers[0];
    expect(layer.width / layer.height).toBeCloseTo(2, 6);
  });
});
