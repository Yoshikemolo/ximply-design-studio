// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';

const member = (id: string, x: number, group?: string) => ({
  ...newLayer('rectangle', id, { x, y: 100 }), width: 40, height: 40,
  fill: '#111111', stroke: '#222222', strokeWidth: 2, ...(group ? { groupPath: [group] } : {}),
});
function grouped() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({
    ...document,
    layers: [member('a', 0, 'g'), member('b', 100, 'g'), member('outside', 300)],
  }));
  e.selectLayer('a');
  return e;
}
const layer = (e: EditorService, id: string) => e.document().layers.find((item) => item.id === id)!;

beforeEach(() => localStorage.clear());
describe('properties of a group', () => {
  it('paints every member of the group, and nothing outside it', () => {
    const e = grouped();
    expect(e.selectedLayers().map((item) => item.id)).toEqual(['a', 'b']);
    e.updateLayer({ fill: '#ff0000' });
    expect([layer(e, 'a').fill, layer(e, 'b').fill]).toEqual(['#ff0000', '#ff0000']);
    expect(layer(e, 'outside').fill).toBe('#111111');
    // One history step puts the whole group back.
    e.undo();
    expect([layer(e, 'a').fill, layer(e, 'b').fill]).toEqual(['#111111', '#111111']);
  });

  it('shares the stroke, its width and the transparency of the selection', () => {
    const e = grouped();
    e.updateLayer({ strokeWidth: 8 });
    expect([layer(e, 'a').strokeWidth, layer(e, 'b').strokeWidth]).toEqual([8, 8]);
    e.updateLayer({ stroke: '#00ff00', opacity: 0.5 });
    expect([layer(e, 'a').stroke, layer(e, 'b').stroke]).toEqual(['#00ff00', '#00ff00']);
    expect([layer(e, 'a').opacity, layer(e, 'b').opacity]).toEqual([0.5, 0.5]);
    expect(layer(e, 'outside').strokeWidth).toBe(2);
  });

  it('keeps place and size on the object the form is showing', () => {
    const e = grouped();
    // Selecting a member selects the group, and the form shows one of them.
    const shown = e.selectedId()!;
    const other = ['a', 'b'].find((id) => id !== shown)!;
    const before = [layer(e, other).x, layer(e, other).width];
    e.updateLayer({ x: 500, width: 80 });
    expect(layer(e, shown).x).toBe(500);
    expect(layer(e, shown).width).toBe(80);
    // The other member of the group keeps its own place and size.
    expect([layer(e, other).x, layer(e, other).width]).toEqual(before);
  });

  it('paints a selection of separate objects the same way', () => {
    const e = grouped();
    e.selectLayer('outside');
    e.selectLayer('a', true);
    e.updateLayer({ fill: '#0000ff' });
    expect([layer(e, 'outside').fill, layer(e, 'a').fill, layer(e, 'b').fill])
      .toEqual(['#0000ff', '#0000ff', '#0000ff']);
  });

  it('changes only the property that was edited, on every selected object', () => {
    const e = grouped();
    // Each member starts with its own appearance, one of them without a stroke.
    e.document.update((document) => ({
      ...document,
      layers: document.layers.map((item) => item.id === 'b'
        ? { ...item, fill: '#00ff00', stroke: 'none', strokeWidth: 1 }
        : item),
    }));
    e.selectLayer('a');
    e.setStrokeWidth(9);
    // The width reaches both, and nothing else moved: the transparent stroke stays away.
    expect([layer(e, 'a').strokeWidth, layer(e, 'b').strokeWidth]).toEqual([9, 9]);
    expect([layer(e, 'a').fill, layer(e, 'b').fill]).toEqual(['#111111', '#00ff00']);
    expect([layer(e, 'a').stroke, layer(e, 'b').stroke]).toEqual(['#222222', 'none']);
    e.setPaint('stroke', '#0000ff');
    // The colour of the stroke reaches both, and the fills stay as each one had them.
    expect([layer(e, 'a').stroke, layer(e, 'b').stroke]).toEqual(['#0000ff', '#0000ff']);
    expect([layer(e, 'a').fill, layer(e, 'b').fill]).toEqual(['#111111', '#00ff00']);
    expect([layer(e, 'a').strokeWidth, layer(e, 'b').strokeWidth]).toEqual([9, 9]);
    e.setPaint('fill', '#ff0000');
    expect([layer(e, 'a').stroke, layer(e, 'b').stroke]).toEqual(['#0000ff', '#0000ff']);
    // The line type of the selection is merged into the style each object already had.
    e.setStrokeStyle({ dash: [6, 3] });
    expect(layer(e, 'a').strokeStyle?.dash).toEqual([6, 3]);
    expect(layer(e, 'b').strokeStyle?.cap).toBe(layer(e, 'a').strokeStyle?.cap);
  });

  it('leaves a locked member of the selection alone', () => {
    const e = grouped();
    e.toggle('b', 'locked');
    e.selectLayer('a');
    e.updateLayer({ fill: '#ff00ff' });
    expect(layer(e, 'b').fill).toBe('#111111');
  });
});
