// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';

function setup() {
  const editor = new EditorService();
  expect(editor.createProcedural('wall', { x: 100, y: 100 }, { x: 500, y: 100 })).toBe(true);
  const wall = editor.selectedId()!;
  expect(editor.createProcedural('door', { x: 300, y: 100 })).toBe(true);
  return { editor, wall, door: editor.selectedId()! };
}
function portalCenter(layer: Layer) {
  const corners = layer.curves!.slice(0, 2).flatMap(path => path.nodes.map(node => worldPoint(layer, node.point)));
  return { x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length, y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length };
}
beforeEach(() => localStorage.clear());
describe('independent hosted opening transformation checks', () => {
  it('moves and rotates a selected group once while preserving the opening host', () => {
    const { editor, wall, door } = setup();
    editor.selectedIds.set([wall, door]); editor.group();
    expect(editor.displaceSelection(50, 20)).toBe(true);
    let opening = editor.document().layers.find(layer => layer.id === door)!;
    expect(portalCenter(opening).x).toBeCloseTo(350);
    expect(portalCenter(opening).y).toBeCloseTo(120);
    expect(editor.rotateSelection(90, { x: 0, y: 0 })).toBe(true);
    opening = editor.document().layers.find(layer => layer.id === door)!;
    expect(portalCenter(opening).x).toBeCloseTo(-120);
    expect(portalCenter(opening).y).toBeCloseTo(350);
    expect(opening.procedural).toMatchObject({ type: 'door', host: { wallId: wall, offset: .5 } });
    editor.undo();
    opening = editor.document().layers.find(layer => layer.id === door)!;
    expect(portalCenter(opening).x).toBeCloseTo(350);
    expect(portalCenter(opening).y).toBeCloseTo(120);
  });
  it('detaches an opening edited directly but keeps a width parameter edit hosted', () => {
    const { editor, wall, door } = setup();
    expect(editor.updateProcedural({ width: 120 })).toBe(true);
    let opening = editor.document().layers.find(layer => layer.id === door)!;
    expect(opening.procedural).toMatchObject({ width: 120, host: { wallId: wall } });
    expect(portalCenter(opening).x).toBeCloseTo(300);
    const before = portalCenter(opening);
    editor.updateLayer({ x: opening.x + 25 });
    opening = editor.document().layers.find(layer => layer.id === door)!;
    expect(opening.procedural).not.toHaveProperty('host');
    expect(portalCenter(opening).x).toBeCloseTo(before.x + 25);
    expect(portalCenter(opening).y).toBeCloseTo(before.y);
  });
});
