// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer, newLayer, parseDocument } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';

const rect = (extra: Partial<Layer> = {}): Layer => ({ ...newLayer('rectangle', 'r', { x: 100, y: 100 }, '#ff0000', '#000000', 2), width: 200, height: 100, ...extra });
function editor(layers: Layer[] = [rect()]) {
  localStorage.clear();
  const e = new EditorService();
  e.zoom.set(1);
  e.document.update((d) => ({ ...d, version: 2, layers }));
  return e;
}
const click = (e: EditorService, x: number, y: number, m: { shift?: boolean; alt?: boolean } = {}) => { e.start({ x, y }, m); e.end(m); };
const mesh = (e: EditorService) => e.document().layers[0].gradientMesh!;
beforeEach(() => localStorage.clear());

describe('the Mesh tool on a shape', () => {
  it('turns it into a gradient mesh with a mesh point in the fill colour where it clicks, as one step', () => {
    const e = editor();
    e.setPaint('fill', '#0000ff');
    e.setTool('mesh');
    click(e, 150, 125);
    const layer = e.document().layers[0];
    expect([mesh(e).mesh.rows, mesh(e).mesh.columns]).toEqual([2, 2]);
    const index = e.meshNode()!.index;
    expect(mesh(e).colors[index]).toBe('#0000ff');
    const p = worldPoint(layer, mesh(e).mesh.nodes[index].point);
    expect(p.x).toBeCloseTo(150, 3);
    expect(p.y).toBeCloseTo(125, 3);
    // The corners keep the colour the shape had, and the mesh has no stroke.
    expect(mesh(e).colors[0]).toBe('#ff0000');
    expect(layer.stroke).toBe('none');
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
    e.undo();
    expect(e.document().layers[0].kind).toBe('rectangle');
  });

  it('keeps the colour already there with Shift', () => {
    const e = editor();
    e.setPaint('fill', '#0000ff');
    e.setTool('mesh');
    click(e, 150, 125, { shift: true });
    expect(mesh(e).colors.every((c) => c === '#ff0000')).toBe(true);
  });

  it('adds more mesh points, deletes one with Alt-click, and moves one with a drag', () => {
    const e = editor();
    e.setTool('mesh');
    click(e, 150, 125);
    click(e, 250, 175);
    expect([mesh(e).mesh.rows, mesh(e).mesh.columns]).toEqual([3, 3]);
    click(e, 250, 175, { alt: true });
    expect([mesh(e).mesh.rows, mesh(e).mesh.columns]).toEqual([2, 2]);
    e.start({ x: 150, y: 125 });
    e.move({ x: 170, y: 130 });
    e.end();
    const layer = e.document().layers[0], index = e.meshNode()!.index;
    const p = worldPoint(layer, layer.gradientMesh!.mesh.nodes[index].point);
    expect([Math.round(p.x), Math.round(p.y)]).toEqual([170, 130]);
  });

  it('colours the chosen mesh point with the fill colour', () => {
    const e = editor();
    e.setTool('mesh');
    click(e, 150, 125);
    const index = e.meshNode()!.index;
    e.setPaint('fill', '#00ff00');
    expect(mesh(e).colors[index]).toBe('#00ff00');
    expect(mesh(e).colors.filter((c) => c === '#00ff00')).toHaveLength(1);
  });

  it('refuses text and compound paths', () => {
    const e = editor([rect({ kind: 'text', text: 'A' })]);
    expect(e.makeGradientMesh('r', { rows: 2, columns: 2, appearance: 'flat', highlight: 0 })).toBe(false);
    expect(e.status()).toContain('Create outlines of the text first');
    const square = (x: number) => ({ closed: true, nodes: [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 10 }, { x, y: 10 }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) });
    const f = editor([rect({ kind: 'path', curves: [square(0), square(20)] })]);
    expect(f.makeGradientMesh('r', { rows: 2, columns: 2, appearance: 'flat', highlight: 0 })).toBe(false);
  });
});

describe('Object > Create Gradient Mesh', () => {
  it('makes a regular mesh with rows, columns and a highlight', () => {
    const e = editor();
    expect(e.makeGradientMesh('r', { rows: 3, columns: 4, appearance: 'toCenter', highlight: 60 })).toBe(true);
    expect([mesh(e).mesh.rows, mesh(e).mesh.columns]).toEqual([3, 4]);
    expect(mesh(e).colors[0]).toBe('#ff0000');
    expect(mesh(e).colors.some((c) => c !== '#ff0000')).toBe(true);
  });
});
