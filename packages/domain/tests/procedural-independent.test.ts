import { describe, expect, it } from 'vitest';
import { blankDocument, Layer, newLayer, StudioDocument } from '../src/document';
import { worldPoint } from '../src/curves';
import { defaultProcedural, generateProcedural, materializeProcedural, syncProcedurals } from '../src/procedural';

function wall(id: string, vertical = false): Layer {
  return generateProcedural({ ...newLayer('path', id, vertical ? { x: 90, y: -90 } : { x: 0, y: 0 }, '#cccccc', '#000000', 1), width: vertical ? 20 : 200, height: vertical ? 200 : 20, procedural: { type: 'wall', start: vertical ? { x: 10, y: 0 } : { x: 0, y: 10 }, end: vertical ? { x: 10, y: 200 } : { x: 200, y: 10 }, thickness: 20 } });
}
function doc(...layers: Layer[]): StudioDocument { return { ...blankDocument(), layers }; }
function opening(host: Layer): Layer {
  const defaults = defaultProcedural('door');
  if (defaults.type !== 'door') throw new Error('Expected door defaults');
  return { ...newLayer('path', 'door', { x: 0, y: 0 }), procedural: { ...defaults, width: 40, leafWidths: [40], host: { wallId: host.id, offset: .5 } } };
}
/** Signed ring integration is independent of the clipping algorithm. */
function area(layer: Layer): number {
  return Math.abs((layer.curves ?? []).filter(path => path.closed).reduce((sum, path) => {
    const points = path.nodes.map(node => worldPoint(layer, node.point));
    return sum + points.reduce((integral, point, i) => {
      const next = points[(i + 1) % points.length];
      return integral + point.x * next.y - point.y * next.x;
    }, 0) / 2;
  }, 0));
}

function wallFrom(id: string, end: { x: number; y: number }): Layer {
  return generateProcedural({ ...newLayer('path', id, { x: 100, y: 100 }, '#cccccc', '#000000', 1), procedural: { type: 'wall', start: { x: 0, y: 0 }, end: { x: end.x - 100, y: end.y - 100 }, thickness: 20 } });
}
/** Independent even/odd point inclusion, with samples strictly off the boundary. */
function contains(layer: Layer, x: number, y: number): boolean {
  let inside = false;
  for (const path of layer.curves ?? []) {
    if (!path.closed) continue;
    const points = path.nodes.map(node => worldPoint(layer, node.point));
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

describe('independent architectural geometry oracles', () => {
  it('unions crossing equal-style walls into their exterior and preserves editable source identities', () => {
    const source = doc(wall('horizontal'), wall('vertical', true));
    const before = structuredClone(source);
    const rendered = materializeProcedural(source);
    expect(source).toEqual(before);
    expect(source.layers.map(layer => layer.id)).toEqual(['horizontal', 'vertical']);
    expect(rendered.layers).toHaveLength(1);
    expect(area(rendered.layers[0])).toBeCloseTo(200 * 20 * 2 - 20 * 20);
    expect(rendered.layers[0].curves).toHaveLength(1);
    expect(rendered.layers[0].curves![0].nodes).toHaveLength(12);
  });
  it('cuts a hosted door by its clear width and wall thickness without a filled portal', () => {
    const host = wall('host');
    const rendered = materializeProcedural(doc(host, opening(host)));
    expect(area(rendered.layers[0])).toBeCloseTo(200 * 20 - 40 * 20);
    expect(rendered.layers[0].curves).toHaveLength(2);
    // Only the two frame sections are closed, and neither spans the clear opening.
    const closed = rendered.layers[1].curves!.filter(path => path.closed);
    expect(closed).toHaveLength(2);
    for (const path of closed) {
      const xs = path.nodes.map(node => node.point.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(20);
    }
  });
  it('keeps a crossing second wall solid when the opening belongs only to the first wall', () => {
    const host = wall('host');
    const rendered = materializeProcedural(doc(host, wall('crossing', true), opening(host)));
    expect(area(rendered.layers[0])).toBeCloseTo(7600 - 40 * 20 + 20 * 20);
  });
  it('does not merge walls through an intervening object or separate group boundary', () => {
    const first = wall('first'), second = wall('second', true);
    expect(materializeProcedural(doc(first, newLayer('rectangle', 'middle', { x: 0, y: 0 }), second)).layers).toHaveLength(3);
    expect(materializeProcedural(doc({ ...first, groupPath: ['a'] }, { ...second, groupPath: ['b'] })).layers).toHaveLength(2);
  });
  it('follows a moved and rotated host, leaves geometry unchanged on repeated synchronization, and detaches when host is removed', () => {
    const host = wall('host');
    const initial = syncProcedurals(doc(host, opening(host)));
    const moved = syncProcedurals({ ...initial, layers: initial.layers.map(layer => layer.id === host.id ? { ...layer, x: layer.x + 80, y: layer.y + 30, rotation: 90 } : layer) });
    const door = moved.layers[1];
    expect(door.rotation).toBeCloseTo(90);
    expect(door.procedural?.type === 'door' && door.procedural.host?.wallId).toBe('host');
    expect(syncProcedurals(moved)).toEqual(moved);
    const detached = syncProcedurals({ ...moved, layers: [door] }).layers[0];
    expect(detached.procedural?.type === 'door' && detached.procedural.host).toBeUndefined();
    expect({ x: detached.x, y: detached.y, rotation: detached.rotation }).toEqual({ x: door.x, y: door.y, rotation: door.rotation });
  });
  it('fills a right-angle wall junction outer corner without extending its free ends or filling the inner room', () => {
    const source = doc(wallFrom('right', { x: 300, y: 100 }), wallFrom('down', { x: 100, y: 300 }));
    const rendered = materializeProcedural(source);
    expect(rendered.layers).toHaveLength(1);
    const joined = rendered.layers[0];
    expect(contains(joined, 95, 95)).toBe(true);
    expect(contains(joined, 115, 115)).toBe(false);
    expect(contains(joined, 301, 100)).toBe(false);
    expect(contains(joined, 100, 301)).toBe(false);
    expect(area(joined)).toBeCloseTo(8000);
  });

  it('bounds nearly parallel acute junctions with a bevel instead of an unbounded miter spike', () => {
    const angle = Math.PI / 180;
    const rendered = materializeProcedural(doc(wallFrom('first', { x: 300, y: 100 }), wallFrom('second', { x: 100 + 200 * Math.cos(angle), y: 100 + 200 * Math.sin(angle) })));
    const points = rendered.layers.flatMap(layer => layer.curves!.flatMap(path => path.nodes.map(node => worldPoint(layer, node.point))));
    expect(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    // The joint cap is ten half-thicknesses (100 px); source free ends reach 300 px.
    expect(Math.min(...points.map(point => point.x))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...points.map(point => point.y))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...points.map(point => point.x))).toBeLessThanOrEqual(310);
    expect(Math.max(...points.map(point => point.y))).toBeLessThanOrEqual(200);
  });

});
