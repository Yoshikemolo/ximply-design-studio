// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { worldPoint } from '../../../packages/domain/src/curves';
import { Layer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const paths = (e: EditorService) => e.document().layers.filter((layer) => layer.curves?.length);
const world = (layer: Layer, index: number, part: 'point' | 'incoming' | 'outgoing' = 'point', path = 0) => {
  const p = worldPoint(layer, layer.curves![path].nodes[index][part]);
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
};
const click = (e: EditorService, x: number, y: number, modifiers = {}) => { e.start({ x, y }, modifiers); e.end(); };
const drag = (e: EditorService, from: [number, number], to: [number, number], modifiers = {}, at: 'start' | 'move' = 'move') => {
  e.start({ x: from[0], y: from[1] }, at === 'start' ? modifiers : {});
  e.move({ x: to[0], y: to[1] }, modifiers);
  e.end();
};
function pen() {
  const e = new EditorService();
  e.setTool('pen');
  return e;
}

describe('drawing with the Pen', () => {
  it('sets corner anchors with clicks and smooth anchors with drags', () => {
    const e = pen();
    click(e, 100, 100);
    drag(e, [200, 100], [240, 100]);
    const layer = paths(e)[0];
    expect(layer.curves![0].nodes[0].smooth).toBe(false);
    expect(layer.curves![0].nodes[1].smooth).toBe(true);
    // The handles of a new smooth anchor move together, at the same length.
    expect(world(layer, 1, 'outgoing')).toEqual({ x: 240, y: 100 });
    expect(world(layer, 1, 'incoming')).toEqual({ x: 160, y: 100 });
  });

  it('keeps a Shift-click on the angle increment from the previous anchor', () => {
    const e = pen();
    click(e, 100, 100);
    click(e, 200, 110, { shift: true });
    const p = world(paths(e)[0], 1);
    expect(p.y).toBeCloseTo(100, 2);
    expect(p.x).toBeCloseTo(100 + Math.hypot(100, 10), 2);
  });

  it('moves the anchor being placed while Space is held, handles and all', () => {
    const e = pen();
    click(e, 100, 100);
    e.start({ x: 200, y: 100 });
    e.move({ x: 240, y: 100 });
    e.move({ x: 250, y: 130 }, { space: true });
    e.end();
    const layer = paths(e)[0];
    expect(world(layer, 1)).toEqual({ x: 210, y: 130 });
    expect(world(layer, 1, 'outgoing')).toEqual({ x: 250, y: 130 });
    expect(world(layer, 1, 'incoming')).toEqual({ x: 170, y: 130 });
  });

  it('takes the outgoing handle in when the last anchor is clicked, so the next segment starts straight', () => {
    const e = pen();
    click(e, 100, 100);
    drag(e, [200, 100], [240, 100]);
    click(e, 200, 100);
    const layer = paths(e)[0];
    expect(world(layer, 1, 'outgoing')).toEqual({ x: 200, y: 100 });
    expect(world(layer, 1, 'incoming')).toEqual({ x: 160, y: 100 });
    expect(layer.curves![0].nodes).toHaveLength(2);
  });

  it('pulls only a new outgoing handle when the last anchor is dragged', () => {
    const e = pen();
    click(e, 100, 100);
    click(e, 200, 100);
    drag(e, [200, 100], [200, 160]);
    const layer = paths(e)[0];
    expect(world(layer, 1, 'outgoing')).toEqual({ x: 200, y: 160 });
    expect(world(layer, 1, 'incoming')).toEqual({ x: 200, y: 100 });
    expect(layer.curves![0].nodes[1].smooth).toBe(false);
  });

  it('closes the path on the first anchor and stops drawing', () => {
    const e = pen();
    click(e, 100, 100);
    click(e, 200, 100);
    click(e, 150, 180);
    click(e, 101, 101);
    const layer = paths(e)[0];
    expect(layer.curves![0].closed).toBe(true);
    expect(layer.curves![0].nodes).toHaveLength(3);
    expect(e.penId()).toBeNull();
  });

  it('shapes the closing curve with a drag on the first anchor, or only its incoming side with Alt', () => {
    const e = pen();
    click(e, 100, 100);
    click(e, 200, 100);
    click(e, 150, 180);
    drag(e, [100, 100], [100, 60]);
    const layer = paths(e)[0];
    expect(world(layer, 0, 'outgoing')).toEqual({ x: 100, y: 60 });
    expect(world(layer, 0, 'incoming')).toEqual({ x: 100, y: 140 });

    // A new editor would otherwise restore the first drawing from the autosave.
    localStorage.clear();
    const f = pen();
    click(f, 100, 100);
    click(f, 200, 100);
    click(f, 150, 180);
    drag(f, [100, 100], [100, 60], { alt: true });
    const other = paths(f)[0];
    expect(world(other, 0, 'outgoing')).toEqual({ x: 100, y: 100 });
    expect(world(other, 0, 'incoming')).toEqual({ x: 100, y: 140 });
  });

  it('joins another open path when its endpoint is clicked', () => {
    const e = pen();
    click(e, 300, 100);
    click(e, 400, 100);
    e.finishPath();
    e.selectedId.set(null);
    e.selectedIds.set([]);
    click(e, 100, 100);
    click(e, 200, 100);
    click(e, 300, 100);
    expect(paths(e)).toHaveLength(1);
    const layer = paths(e)[0];
    expect(layer.curves![0].nodes.map((_, i) => world(layer, i).x)).toEqual([100, 200, 300, 400]);
    expect(e.penId()).toBeNull();
  });
});

describe('editing with the Pen and the anchor tools', () => {
  function selectedLine() {
    const e = pen();
    click(e, 100, 100);
    click(e, 300, 100);
    click(e, 300, 300);
    e.finishPath();
    return e;
  }

  it('adds an anchor where it is clicked on a segment of the selected path', () => {
    const e = selectedLine();
    click(e, 200, 100);
    const layer = paths(e)[0];
    expect(layer.curves![0].nodes).toHaveLength(4);
    expect(world(layer, 1).x).toBeCloseTo(200, 1);
  });

  it('deletes an anchor of the selected path that it is clicked on', () => {
    const e = selectedLine();
    click(e, 300, 100);
    expect(paths(e)[0].curves![0].nodes).toHaveLength(2);
  });

  it('draws a new path instead when Shift is held or the preference is off', () => {
    const e = selectedLine();
    click(e, 200, 100, { shift: true });
    expect(paths(e)).toHaveLength(2);
    localStorage.clear();
    const f = selectedLine();
    f.autoAddDelete.set(false);
    click(f, 200, 100);
    expect(paths(f)).toHaveLength(2);
  });

  it('turns the Add Anchor tool into Delete Anchor with Alt, and the other way round', () => {
    const e = selectedLine();
    e.setTool('addAnchor');
    click(e, 300, 100, { alt: true });
    expect(paths(e)[0].curves![0].nodes).toHaveLength(2);
    e.setTool('deleteAnchor');
    click(e, 200, 200, { alt: true });
    expect(paths(e)[0].curves![0].nodes).toHaveLength(3);
  });

  it('converts anchors with the Convert Anchor tool: a drag pulls handles, a click takes them in', () => {
    const e = selectedLine();
    e.setTool('convertAnchor');
    drag(e, [300, 100], [340, 100]);
    let layer = paths(e)[0];
    expect(layer.curves![0].nodes[1].smooth).toBe(true);
    expect(world(layer, 1, 'outgoing')).toEqual({ x: 340, y: 100 });
    expect(world(layer, 1, 'incoming')).toEqual({ x: 260, y: 100 });
    // Dragging one handle now breaks it away from the other.
    drag(e, [340, 100], [340, 60]);
    layer = paths(e)[0];
    expect(layer.curves![0].nodes[1].smooth).toBe(false);
    expect(world(layer, 1, 'incoming')).toEqual({ x: 260, y: 100 });
    click(e, 300, 100);
    layer = paths(e)[0];
    expect(world(layer, 1, 'outgoing')).toEqual({ x: 300, y: 100 });
    expect(world(layer, 1, 'incoming')).toEqual({ x: 300, y: 100 });
  });

  it('becomes Convert Anchor while Alt is held over an anchor', () => {
    const e = selectedLine();
    drag(e, [300, 100], [340, 100], { alt: true }, 'start');
    expect(paths(e)).toHaveLength(1);
    expect(paths(e)[0].curves![0].nodes[1].smooth).toBe(true);
  });
});

describe('the marks beside the Pen', () => {
  it('announces a new path, a continuation, a close, an addition, a deletion and a join', () => {
    const e = pen();
    e.move({ x: 50, y: 50 });
    expect(e.pathCursor()).toBe('newPath');
    click(e, 100, 100);
    click(e, 200, 100);
    click(e, 200, 200);
    e.move({ x: 100, y: 100 });
    expect(e.pathCursor()).toBe('close');
    e.move({ x: 200, y: 200 });
    expect(e.pathCursor()).toBe('convert');
    e.finishPath();
    e.move({ x: 150, y: 100 });
    expect(e.pathCursor()).toBe('add');
    e.move({ x: 200, y: 100 });
    expect(e.pathCursor()).toBe('delete');
    e.move({ x: 200, y: 200 });
    expect(e.pathCursor()).toBe('continue');
    e.move({ x: 150, y: 100 }, { shift: true });
    expect(e.pathCursor()).toBe('newPath');
    e.selectedId.set(null);
    e.selectedIds.set([]);
    click(e, 400, 400);
    e.move({ x: 100, y: 100 });
    expect(e.pathCursor()).toBe('join');
  });
});
