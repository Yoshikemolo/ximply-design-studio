// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { worldPoint } from '../../../packages/domain/src/curves';
import { Layer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
function drawnPath() {
  localStorage.clear();
  const e = new EditorService();
  e.setTool('pen');
  for (const point of [{ x: 100, y: 100 }, { x: 200, y: 150 }, { x: 300, y: 100 }]) { e.start(point); e.end(); }
  e.finishPath();
  return e;
}
const nodes = (layer: Layer) => layer.curves![0].nodes.map((node) => { const p = worldPoint(layer, node.point); return { x: Math.round(p.x), y: Math.round(p.y) }; });
const paths = (e: EditorService) => e.document().layers.filter((layer) => layer.curves?.length);

describe('pen continuation', () => {
  it('carries on from the last anchor of an unlocked path', () => {
    const e = drawnPath();
    expect(nodes(paths(e)[0])).toHaveLength(3);
    e.setTool('pen');
    e.start({ x: 302, y: 98 });
    e.end();
    e.start({ x: 400, y: 200 });
    e.end();
    e.finishPath();
    expect(paths(e)).toHaveLength(1);
    expect(nodes(paths(e)[0]).at(-1)).toEqual({ x: 400, y: 200 });
    expect(nodes(paths(e)[0])).toHaveLength(5);
  });

  it('carries on from the first anchor by reversing the path', () => {
    const e = drawnPath();
    e.setTool('pen');
    e.start({ x: 101, y: 101 });
    e.end();
    e.start({ x: 40, y: 60 });
    e.end();
    e.finishPath();
    const result = nodes(paths(e)[0]);
    expect(paths(e)).toHaveLength(1);
    expect(result.at(-1)).toEqual({ x: 40, y: 60 });
    expect(result[0]).toEqual({ x: 300, y: 100 });
  });

  it('starts a new object when the path under the pointer is locked', () => {
    const e = drawnPath();
    e.setLayer(paths(e)[0].id, { locked: true });
    e.setTool('pen');
    e.start({ x: 302, y: 98 });
    e.end();
    e.start({ x: 400, y: 200 });
    e.end();
    e.finishPath();
    expect(paths(e)).toHaveLength(2);
    expect(nodes(paths(e)[0])).toHaveLength(3);
  });

  it('leaves closed paths and the middle of a path alone', () => {
    const e = drawnPath();
    const first = paths(e)[0].id;
    e.setTool('pen');
    e.start({ x: 200, y: 150 });
    e.end();
    e.finishPath();
    expect(paths(e)).toHaveLength(2);
    const closed = new EditorService();
    closed.document.update((document) => ({ ...document, layers: [{ ...e.document().layers.find((layer) => layer.id === first)!, curves: [{ ...e.document().layers.find((layer) => layer.id === first)!.curves![0], closed: true }] }] }));
    closed.setTool('pen');
    expect(closed.penContinuation({ x: 300, y: 100 })).toBeNull();
  });
});
