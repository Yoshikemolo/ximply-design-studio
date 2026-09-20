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

describe('wall angle tendency', () => {
  const drawn = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    localStorage.clear();
    const e = new EditorService();
    e.setTool('wall');
    e.start(from);
    e.move(to);
    e.end();
    return ends(walls(e)[0])[1];
  };
  const angle = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.round(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI * 100) / 100;

  it('leans to the nearest 45 degree direction when the angle is close', () => {
    const from = { x: 200, y: 200 };
    // 3 degrees off horizontal and 2 degrees off the diagonal both land on the clean direction.
    expect(angle(from, drawn(from, { x: 400, y: 210 }))).toBe(0);
    expect(angle(from, drawn(from, { x: 400, y: 190 }))).toBe(0);
    expect(angle(from, drawn(from, { x: 400, y: 393 }))).toBe(45);
    expect(angle(from, drawn(from, { x: 200, y: 400 }))).toBe(90);
  });

  it('keeps a deliberate angle and exact wall joints', () => {
    const from = { x: 200, y: 200 };
    expect(angle(from, drawn(from, { x: 400, y: 300 }))).toBeCloseTo(26.57, 1);
    localStorage.clear();
    const e = new EditorService();
    e.setTool('wall');
    e.start({ x: 100, y: 100 });
    e.move({ x: 300, y: 100 });
    e.end();
    // A joint on an existing wall wins over the angle tendency.
    e.start({ x: 302, y: 104 });
    e.move({ x: 305, y: 300 });
    e.end();
    expect(ends(walls(e)[1])[0]).toEqual(ends(walls(e)[0])[1]);
  });
});
