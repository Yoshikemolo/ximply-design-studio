// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer, newLayer, parseDocument } from '../../../packages/domain/src/document';
import { GradientPaint, defaultSwatches } from '../../../packages/domain/src/paint';

const fade: GradientPaint = { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: '#ff0000', location: 0, midpoint: 50 }, { color: '#0000ff', location: 100, midpoint: 50 }] };
function editorWith(...layers: Layer[]) {
  const editor = new EditorService();
  editor.document.update((d) => ({ ...d, version: 2, layers }));
  editor.selectedIds.set(layers.map((l) => l.id));
  editor.selectedId.set(layers.at(-1)?.id ?? null);
  return editor;
}
const box = (id: string, x = 0, y = 0): Layer => ({ ...newLayer('rectangle', id, { x, y }, '#000000', 'none', 0), width: 100, height: 50 });
const valid = (editor: EditorService) => parseDocument(JSON.stringify(editor.document()));

beforeEach(() => localStorage.clear());

describe('gradient and pattern fills in the editor', () => {
  it('fill the selection with a gradient, and a colour takes it off, each one step', () => {
    const editor = editorWith(box('a'));
    expect(editor.setFillPaint(fade)).toBe(true);
    expect(editor.document().layers[0].fillPaint).toEqual(fade);
    editor.setPaint('fill', '#00ff00');
    expect(editor.document().layers[0].fillPaint).toBeUndefined();
    expect(editor.document().layers[0].fill).toBe('#00ff00');
    editor.undo();
    expect(editor.document().layers[0].fillPaint).toEqual(fade);
    valid(editor);
  });

  it('give an unfilled object a fill to carry the gradient', () => {
    const editor = editorWith({ ...box('a'), fill: 'none' });
    editor.setFillPaint(fade);
    expect(editor.document().layers[0].fill).toBe('#ff0000');
  });

  it('fill new objects with the chosen gradient', () => {
    const editor = editorWith();
    editor.setFillPaint(fade);
    editor.setTool('rectangle');
    editor.start({ x: 10, y: 10 });
    editor.move({ x: 60, y: 40 });
    editor.end();
    expect(editor.document().layers.at(-1)!.fillPaint).toEqual(fade);
  });

  it('refuse a pattern the document does not hold, and use a preset once', () => {
    const editor = editorWith(box('a'));
    expect(editor.setFillPaint({ kind: 'pattern', patternId: 'missing' })).toBe(false);
    const id = editor.usePresetPattern('dots')!;
    expect(editor.usePresetPattern('dots')).toBe(id);
    expect(editor.document().patterns).toHaveLength(1);
    expect(editor.setFillPaint({ kind: 'pattern', patternId: id })).toBe(true);
    valid(editor);
  });

  it('define a pattern from the selected artwork, which joins the swatches', () => {
    const editor = editorWith(box('a', 40, 30), { ...box('b', 90, 30), kind: 'ellipse', width: 20, height: 20 });
    const id = editor.definePattern('Tiles')!;
    const pattern = editor.document().patterns!.find((p) => p.id === id)!;
    // The tile spans the box from 40 to 140 across and 30 to 80 down.
    expect([pattern.width, pattern.height]).toEqual([100, 50]);
    expect(pattern.layers.map((l) => [l.x, l.y])).toEqual([[0, 0], [50, 0]]);
    expect(editor.documentSwatches().some((s) => s.kind === 'pattern' && s.patternId === id)).toBe(true);
    // The artwork itself stays where it is.
    expect(editor.document().layers.map((l) => l.x)).toEqual([40, 90]);
    valid(editor);
  });

  it('will not make a pattern of text or of a filled gradient', () => {
    const editor = editorWith({ ...box('t'), kind: 'text', text: 'A' });
    expect(editor.definePattern()).toBeNull();
    const graded = editorWith({ ...box('g'), fillPaint: fade });
    expect(graded.definePattern()).toBeNull();
  });
});

describe('the swatches of a document', () => {
  it('start from the defaults, add the current fill and remove a swatch', () => {
    const editor = editorWith(box('a'));
    expect(editor.documentSwatches()).toEqual(defaultSwatches());
    editor.setFillPaint(fade);
    const id = editor.addSwatch('fill')!;
    expect(editor.documentSwatches().find((s) => s.id === id)).toMatchObject({ kind: 'gradient', gradient: fade });
    expect(editor.removeSwatch(id)).toBe(true);
    expect(editor.documentSwatches().some((s) => s.id === id)).toBe(false);
    valid(editor);
  });

  it('apply colours to either paint, and gradients to the fill only', () => {
    const editor = editorWith(box('a'));
    const swatches = editor.documentSwatches();
    const color = swatches.find((s) => s.kind === 'color' && s.color !== '#000000')!;
    const gradient = swatches.find((s) => s.kind === 'gradient')!;
    expect(editor.applySwatch(color.id, 'stroke')).toBe(true);
    expect(editor.document().layers[0].stroke).toBe(color.kind === 'color' ? color.color : '');
    expect(editor.applySwatch(gradient.id, 'stroke')).toBe(false);
    expect(editor.applySwatch(gradient.id, 'fill')).toBe(true);
    expect(editor.document().layers[0].fillPaint?.kind).toBe('gradient');
  });
});

describe('the Gradient tool', () => {
  it('sets where the gradient runs across every selected object, as one step', () => {
    const editor = editorWith(box('a', 0, 0), box('b', 100, 0));
    editor.setTool('gradient');
    editor.start({ x: 0, y: 25 });
    editor.move({ x: 200, y: 25 });
    editor.end();
    const [a, b] = editor.document().layers;
    expect(a.fillPaint).toMatchObject({ kind: 'gradient', vector: { start: { x: 0, y: 0.5 }, end: { x: 2, y: 0.5 } } });
    expect(b.fillPaint).toMatchObject({ vector: { start: { x: -1, y: 0.5 }, end: { x: 1, y: 0.5 } } });
    valid(editor);
    editor.undo();
    expect(editor.document().layers[0].fillPaint).toBeUndefined();
  });

  it('keeps the line to 45 degrees with Shift', () => {
    const editor = editorWith(box('a'));
    editor.setTool('gradient');
    editor.start({ x: 0, y: 0 });
    editor.move({ x: 50, y: 4 }, { shift: true });
    editor.end();
    const vector = editor.document().layers[0].fillPaint!.kind === 'gradient' ? (editor.document().layers[0].fillPaint as GradientPaint).vector! : null;
    expect(vector!.end.y).toBeCloseTo(0, 6);
  });
});
