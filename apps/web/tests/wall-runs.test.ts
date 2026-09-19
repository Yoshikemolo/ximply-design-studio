// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { wallSnapPoint } from '../src/app/procedural-placement';
import { worldPoint } from '../../../packages/domain/src/curves';
import { generateProcedural, WallProcedure } from '../../../packages/domain/src/procedural';
import { newLayer, Layer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const walls = (e: EditorService) => e.document().layers.filter((l) => l.procedural?.type === 'wall');
const ends = (layer: Layer) => { const p = layer.procedural as WallProcedure; return [worldPoint(layer, p.start), worldPoint(layer, p.end)]; };

describe('wall runs', () => {
  it('chains a wall run click by click, sharing exact joints', () => {
    const e = new EditorService();
    e.setTool('wall');
    for (const point of [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 260 }]) { e.start(point); e.end(); }
    expect(walls(e)).toHaveLength(2);
    const [first, second] = walls(e).map(ends);
    expect(first[1]).toEqual(second[0]);
    expect(second[1]).toEqual({ x: 300, y: 260 });
    e.cancel();
    expect(e.wallChain()).toBeNull();
    e.start({ x: 500, y: 500 });
    e.end();
    expect(walls(e)).toHaveLength(2);
  });

  it('continues a run from the end of a dragged wall and stops when the tool changes', () => {
    const e = new EditorService();
    e.setTool('wall');
    e.start({ x: 40, y: 40 });
    e.move({ x: 200, y: 40 });
    e.end();
    expect(walls(e)).toHaveLength(1);
    expect(e.wallChain()).toEqual({ x: 200, y: 40 });
    e.start({ x: 200, y: 180 });
    e.end();
    expect(walls(e)).toHaveLength(2);
    e.setTool('select');
    expect(e.wallChain()).toBeNull();
  });

  it('snaps to wall ends first and to wall axes for T junctions', () => {
    const wall = generateProcedural({ ...newLayer('path', 'w', { x: 0, y: 0 }, 'none', '#000', 1), width: 200, height: 16, procedural: { type: 'wall', start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, thickness: 16 } });
    expect(wallSnapPoint([wall], { x: 3, y: 4 }, 10)).toEqual({ point: ends(wall)[0], kind: 'end' });
    const axis = wallSnapPoint([wall], { x: 100, y: 6 }, 10);
    expect(axis?.kind).toBe('axis');
    expect(axis?.point.y).toBeCloseTo(ends(wall)[0].y);
    expect(wallSnapPoint([wall], { x: 100, y: 60 }, 10)).toBeNull();
    expect(wallSnapPoint([wall], { x: 3, y: 4 }, 10, 'w')).toBeNull();
    expect(wallSnapPoint([{ ...wall, visible: false }], { x: 3, y: 4 }, 10)).toBeNull();
  });

  it('places the wall body against the drawn line for each alignment', () => {
    const procedure = (align?: 'center' | 'left' | 'right'): WallProcedure => ({ type: 'wall', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 20, ...(align ? { align } : {}) });
    const span = (align?: 'center' | 'left' | 'right') => {
      const layer = generateProcedural({ ...newLayer('path', 'w', { x: 0, y: 0 }, 'none', '#000', 1), width: 100, height: 20, procedural: procedure(align) });
      const ys = layer.curves![0].nodes.map((node) => worldPoint(layer, node.point).y);
      return [Math.min(...ys), Math.max(...ys)];
    };
    expect(span()).toEqual([-10, 10]);
    expect(span('left')).toEqual([-20, 0]);
    expect(span('right')).toEqual([0, 20]);
  });

  it('gives new walls their own construction appearance', () => {
    const e = new EditorService();
    e.setTool('wall');
    e.start({ x: 0, y: 0 });
    e.move({ x: 200, y: 0 });
    e.end();
    const wall = walls(e)[0];
    expect(wall.fill).not.toBe('none');
    expect(wall.fill).not.toBe(e.fill());
    e.setTool('door');
    e.start({ x: 100, y: 0 });
    e.end();
    expect(e.selected()?.fill).toBe('none');
  });
});
