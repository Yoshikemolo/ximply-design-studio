// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer, newLayer, parseDocument } from '../../../packages/domain/src/document';
import { worldCurves } from '../../../packages/domain/src/distort';
import { LIQUIFY_DEFAULTS } from '../../../packages/domain/src/liquify';

const rect = (id: string, x: number, extra: Partial<Layer> = {}): Layer => ({ ...newLayer('rectangle', id, { x, y: 100 }), width: 100, height: 100, ...extra });
function editor(layers: Layer[]) {
  localStorage.clear();
  const e = new EditorService();
  e.zoom.set(1);
  e.document.update((d) => ({ ...d, layers }));
  return e;
}
const points = (l: Layer) => worldCurves(l)![0].nodes.map((n) => n.point);
beforeEach(() => localStorage.clear());

describe('the liquify tools in the editor', () => {
  it('reshape only the selected objects when there is a selection, as one step', () => {
    const e = editor([rect('a', 100), rect('b', 150)]);
    e.selectLayer('a');
    e.setTool('warp');
    e.start({ x: 200, y: 150 });
    e.move({ x: 220, y: 150 });
    e.end();
    expect(e.document().layers[0].kind).toBe('path');
    expect(e.document().layers[1].kind).toBe('rectangle');
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
    e.undo();
    expect(e.document().layers[0].kind).toBe('rectangle');
  });

  it('reshape every unlocked vector object under the brush when nothing is selected', () => {
    const e = editor([rect('a', 100), rect('b', 150, { locked: true }), { ...rect('t', 120), kind: 'text', text: 'A' }]);
    e.setTool('bloat');
    e.start({ x: 200, y: 150 });
    e.end();
    expect(e.document().layers.map((l) => l.kind)).toEqual(['path', 'rectangle', 'text']);
  });

  it('keep Twirl turning while the button is held still', () => {
    const e = editor([rect('a', 100)]);
    e.setTool('twirl');
    e.start({ x: 200, y: 150 });
    const once = points(e.document().layers[0]);
    e.liquifyTick();
    const twice = points(e.document().layers[0]);
    expect(twice).not.toEqual(once);
    e.end();
  });

  it('size the brush with an Alt drag, as a circle with Shift, without reshaping', () => {
    const e = editor([rect('a', 100)]);
    e.setTool('pucker');
    e.start({ x: 200, y: 150 }, { alt: true });
    e.move({ x: 260, y: 170 }, { alt: true });
    e.end();
    expect([e.liquifyOptions().pucker.width, e.liquifyOptions().pucker.height]).toEqual([120, 40]);
    expect(e.document().layers[0].kind).toBe('rectangle');
    e.start({ x: 200, y: 150 }, { alt: true, shift: true });
    e.move({ x: 260, y: 170 }, { alt: true, shift: true });
    e.end();
    expect(e.liquifyOptions().pucker.height).toBe(120);
    // The brush sizes are kept for the next session.
    expect(new EditorService().liquifyOptions().pucker.width).toBe(120);
  });

  it('refuse options outside the ranges of the manual', () => {
    const e = editor([]);
    expect(e.setLiquifyOptions('twirl', { ...LIQUIFY_DEFAULTS.twirl, twirlRate: 200 })).toBe(false);
    expect(e.setLiquifyOptions('twirl', { ...LIQUIFY_DEFAULTS.twirl, twirlRate: -90 })).toBe(true);
  });

  it('say so when there is nothing they can reshape', () => {
    const e = editor([{ ...rect('t', 100), kind: 'text', text: 'A' }]);
    e.setTool('crystallize');
    e.start({ x: 150, y: 150 });
    e.end();
    expect(e.status()).toContain('text, pictures and symbols are left alone');
    expect(e.document().layers[0].kind).toBe('text');
  });
});
