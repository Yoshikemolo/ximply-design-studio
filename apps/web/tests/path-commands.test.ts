// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { PATH_SETTINGS_DEFAULTS, PreferencesService, validPathSettings } from '../src/app/preferences.service';
import { worldPoint } from '../../../packages/domain/src/curves';
import { Layer } from '../../../packages/domain/src/document';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

beforeEach(() => localStorage.clear());
const paths = (e: EditorService) => e.document().layers.filter((layer) => layer.curves?.length);
const points = (layer: Layer, path = 0) => layer.curves![path].nodes.map((n) => {
  const p = worldPoint(layer, n.point);
  return [Math.round(p.x), Math.round(p.y)];
});
function draw(e: EditorService, ...clicks: Array<[number, number]>) {
  e.setTool('pen');
  for (const [x, y] of clicks) { e.start({ x, y }); e.end(); }
  e.finishPath();
  return paths(e).at(-1)!;
}

describe('Object > Path commands', () => {
  it('uses the shortcuts Illustrator gives Join and Average', () => {
    expect(defaultShortcuts()['joinPaths']).toEqual(['Mod+J']);
    expect(defaultShortcuts()['averageAnchors']).toEqual(['Mod+Alt+J']);
    expect(defaultShortcuts()['simplifyPath']).toEqual([]);
  });

  it('closes a whole open path with Join', () => {
    const e = new EditorService();
    draw(e, [100, 100], [200, 100], [200, 200]);
    expect(e.joinSelection()).toBe('joined');
    expect(paths(e)[0].curves![0].closed).toBe(true);
  });

  it('joins two open paths at their nearest endpoints with a straight segment', () => {
    const e = new EditorService();
    const a = draw(e, [100, 100], [200, 100]);
    const b = draw(e, [260, 100], [360, 100]);
    e.selectedIds.set([a.id, b.id]);
    e.selectedId.set(b.id);
    expect(e.joinSelection()).toBe('joined');
    expect(paths(e)).toHaveLength(1);
    expect(points(paths(e)[0]).map(([x]) => x).sort((p, q) => p - q)).toEqual([100, 200, 260, 360]);
  });

  it('asks for the kind of point when the endpoints lie on each other', () => {
    const e = new EditorService();
    const a = draw(e, [100, 100], [200, 100]);
    // Drawn apart and moved onto the end of the first, since the Pen would continue that path.
    const drawn = draw(e, [250, 100], [250, 200]);
    e.setLayer(drawn.id, { x: drawn.x - 50 });
    const b = paths(e).at(-1)!;
    e.selectedIds.set([a.id, b.id]);
    e.selectedId.set(b.id);
    expect(e.joinSelection()).toBe('chooseKind');
    expect(e.joinSelection('smooth')).toBe('joined');
    const joined = paths(e)[0];
    expect(joined.curves![0].nodes).toHaveLength(3);
  });

  it('averages the chosen anchors along the axis asked for', () => {
    const e = new EditorService();
    const layer = draw(e, [100, 100], [200, 160], [300, 100]);
    e.setTool('direct');
    e.selectedId.set(layer.id);
    e.activeNodes.set(['0:0', '0:1']);
    expect(e.averageSelection('vertical')).toBe(true);
    expect(points(paths(e)[0]).slice(0, 2)).toEqual([[100, 130], [200, 130]]);
    e.activeNodes.set(['0:0', '0:2']);
    expect(e.averageSelection('horizontal')).toBe(true);
    const [first, , last] = points(paths(e)[0]);
    expect(first[0]).toBe(200);
    expect(last[0]).toBe(200);
  });

  it('converts the chosen anchors to corners and back to smooth points', () => {
    const e = new EditorService();
    const layer = draw(e, [100, 100], [200, 160], [300, 100]);
    e.selectedId.set(layer.id);
    e.activeNodes.set(['0:1']);
    expect(e.convertSelectedAnchors('smooth')).toBe(true);
    expect(paths(e)[0].curves![0].nodes[1].smooth).toBe(true);
    expect(e.convertSelectedAnchors('corner')).toBe(true);
    const node = paths(e)[0].curves![0].nodes[1];
    expect(node.smooth).toBe(false);
    expect(node.incoming).toEqual(node.point);
  });

  it('removes the chosen anchors and keeps the path whole', () => {
    const e = new EditorService();
    const layer = draw(e, [100, 100], [200, 160], [300, 100]);
    e.selectedId.set(layer.id);
    e.activeNodes.set(['0:1']);
    expect(e.removeSelectedAnchors()).toBe(true);
    expect(paths(e)).toHaveLength(1);
    expect(points(paths(e)[0])).toEqual([[100, 100], [300, 100]]);
  });

  it('cuts the path at the chosen anchors', () => {
    const e = new EditorService();
    const layer = draw(e, [100, 100], [200, 160], [300, 100]);
    e.selectedId.set(layer.id);
    e.activeNodes.set(['0:1']);
    expect(e.cutAtSelectedAnchors()).toBe(true);
    expect(paths(e)).toHaveLength(2);
  });

  it('deletes the chosen anchors with their segments when Delete is pressed', () => {
    const e = new EditorService();
    const layer = draw(e, [100, 100], [200, 100], [300, 100], [400, 100], [500, 100]);
    e.selectedId.set(layer.id);
    e.activeNodes.set(['0:2']);
    e.remove();
    expect(paths(e)).toHaveLength(1);
    expect(paths(e)[0].curves!.map((c) => c.nodes.length)).toEqual([2, 2]);
  });

  it('previews Simplify, puts the path back on cancel and keeps the result on OK', () => {
    const e = new EditorService();
    // At a zoom of 1 the anchors lie well apart from the pixels the Pen picks an anchor within.
    e.zoom.set(1);
    const layer = draw(e, ...Array.from({ length: 30 }, (_, i) => [100 + i * 20, 200 + Math.round(Math.sin(i / 4) * 40)] as [number, number]));
    e.selectedId.set(layer.id);
    e.selectedIds.set([layer.id]);
    const counts = e.previewSimplify({ precision: 20, angleThreshold: 0, straightLines: true });
    expect(counts.original).toBe(30);
    expect(counts.current).toBeLessThan(30);
    e.finishSimplify(false);
    expect(paths(e)[0].curves![0].nodes).toHaveLength(30);
    e.previewSimplify({ precision: 20, angleThreshold: 0, straightLines: true });
    e.finishSimplify(true);
    expect(paths(e)[0].curves![0].nodes.length).toBeLessThan(30);
    e.undo();
    expect(paths(e)[0].curves![0].nodes).toHaveLength(30);
  });
});

describe('path settings', () => {
  it('starts from Illustrator’s defaults and keeps what is changed', () => {
    const p = new PreferencesService();
    expect(p.pathSettings().pencil).toEqual({ fidelity: 2.5, smoothness: 0, fill: false, keepSelected: true, editSelected: true, within: 12 });
    expect(p.pathSettings().paintbrush.fidelity).toBe(4);
    expect(p.pathSettings().paintbrush.keepSelected).toBe(false);
    expect(p.updatePathSettings({ autoAddDelete: false, handleStyle: 'cross' })).toBe(true);
    const again = new PreferencesService();
    expect(again.pathSettings().autoAddDelete).toBe(false);
    expect(again.pathSettings().handleStyle).toBe('cross');
  });

  it('falls back to the defaults for stored values that are out of range or unknown', () => {
    const settings = validPathSettings({ pencil: { fidelity: 999, smoothness: -3 }, handleStyle: 'stars', brush: { kind: 'art' } });
    expect(settings.pencil.fidelity).toBe(20);
    expect(settings.pencil.smoothness).toBe(0);
    expect(settings.handleStyle).toBe(PATH_SETTINGS_DEFAULTS.handleStyle);
    expect(settings.brush).toEqual(PATH_SETTINGS_DEFAULTS.brush);
  });
});
