import { describe, expect, it } from 'vitest';
import { Layer, newLayer } from '../src/document';
import { worldCurves } from '../src/distort';
import { DEFAULT_WARP, WARP_STYLES, envelopeArtwork, envelopeMap, envelopeShell, gridMesh, materializeEnvelopes, meshBounds, meshLines, meshOutline, meshPoint, objectMesh, resampleMesh, warpMesh, warpPoint } from '../src/envelope';

const box = { x: 100, y: 50, width: 200, height: 100 };
const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => { expect(a.x).toBeCloseTo(b.x, digits); expect(a.y).toBeCloseTo(b.y, digits); };

describe('the envelope mesh', () => {
  it('maps every point to itself while it is a plain grid', () => {
    const map = envelopeMap(gridMesh(box, 3, 4), box);
    for (const p of [{ x: 100, y: 50 }, { x: 173, y: 91 }, { x: 300, y: 150 }, { x: 251, y: 60 }]) close(map(p), p, 9);
  });

  it('leaves every point in place for every warp style with no bend and no distortion', () => {
    for (const style of WARP_STYLES)
      for (const axis of ['horizontal', 'vertical'] as const)
        for (const [x, y] of [[-1, -1], [0.3, -0.6], [1, 1], [0, 0]]) close(warpPoint({ style, axis, bend: 0, horizontal: 0, vertical: 0 }, x, y), { x, y }, 9);
  });

  it('follows a warp: the arc style bends the centre line into an arc of the given angle', () => {
    const settings = { ...DEFAULT_WARP, style: 'arc' as const, bend: 100 };
    // A bend of 100 percent turns the ends of the centre line a quarter turn each: they meet the arc's diameter.
    const end = warpPoint(settings, 1, 0), radius = 2 / Math.PI;
    expect(end.x).toBeCloseTo(radius, 9);
    // Heights count half, so the drop of the end is doubled back into the box's own units.
    expect(end.y).toBeCloseTo(radius * 2, 9);
    // The mesh sampled from the warp follows it within a pixel on a 200 by 100 box.
    const map = envelopeMap(warpMesh(box, { ...settings, bend: 40 }), box);
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.83, 0.71]]) {
      const w = warpPoint({ ...settings, bend: 40 }, u * 2 - 1, v * 2 - 1);
      const exact = { x: 200 + (w.x * 200) / 2, y: 100 + (w.y * 100) / 2 };
      const drawn = map({ x: 100 + 200 * u, y: 50 + 100 * v });
      expect(Math.hypot(exact.x - drawn.x, exact.y - drawn.y)).toBeLessThan(1);
    }
  });

  it('fits the corners of the enveloped box to the extremes of a top object', () => {
    const diamond = { closed: true, nodes: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) };
    const mesh = objectMesh(diamond)!;
    expect(mesh).not.toBeNull();
    // The corners of the box land on the points of the diamond nearest the corners of its bounds.
    const corners = [meshPoint(mesh, 0, 0), meshPoint(mesh, 1, 0), meshPoint(mesh, 1, 1), meshPoint(mesh, 0, 1)];
    const onOutline = (p: { x: number; y: number }) => Math.abs(Math.abs(p.x - 50) + Math.abs(p.y - 50) - 50) < 1;
    corners.forEach((p) => expect(onOutline(p)).toBe(true));
    // The middle of each side of the box lands on the outline too.
    [meshPoint(mesh, 0.5, 0), meshPoint(mesh, 1, 0.5), meshPoint(mesh, 0.5, 1), meshPoint(mesh, 0, 0.5)].forEach((p) => expect(onOutline(p)).toBe(true));
  });

  it('keeps its shape when rows and columns are added or removed', () => {
    const mesh = warpMesh(box, { ...DEFAULT_WARP, style: 'flag', bend: 60 });
    const { us, vs } = meshLines(mesh);
    const finer = resampleMesh(mesh, [...us, 0.37], [...vs, 0.61]);
    expect([finer.rows, finer.columns]).toEqual([mesh.rows + 1, mesh.columns + 1]);
    for (const [u, v] of [[0.37, 0.61], [0.1, 0.9], [0.5, 0.5]]) {
      const a = meshPoint(mesh, u, v), b = meshPoint(finer, u, v);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-3);
    }
  });

  it('gives its outline back as a closed path through the border nodes', () => {
    const mesh = gridMesh(box, 2, 3);
    const outline = meshOutline(mesh);
    expect(outline.nodes).toHaveLength(2 * (2 + 3));
    expect(outline.nodes[0].point).toEqual({ x: 100, y: 50 });
    expect(meshBounds(mesh)).toEqual(box);
  });
});

describe('enveloped artwork', () => {
  const content: Layer = { ...newLayer('rectangle', 'c', { x: 100, y: 50 }, '#ff0000', 'none', 0), width: 200, height: 100 };
  const envelope = (mesh = gridMesh(box, 1, 1)) => ({ contents: [content], source: box, mesh, origin: 'grid' as const, fidelity: 50, editing: 'envelope' as const, group: 'g' });

  it('draws the contents through the mesh as paths keeping their paint', () => {
    const mesh = gridMesh(box, 1, 1);
    mesh.nodes[1].point = { x: 340, y: 20 };
    // The mesh is in the envelope layer's own coordinates; this layer sits at the origin.
    const holder: Layer = { ...newLayer('path', 'env', { x: 0, y: 0 }), width: 400, height: 300, envelope: envelope(mesh) };
    const [art] = envelopeArtwork(holder);
    expect(art.kind).toBe('path');
    expect(art.fill).toBe('#ff0000');
    close(worldCurves(art)![0].nodes[0].point, { x: 100, y: 50 });
    expect(worldCurves(art)![0].nodes.some((n) => Math.abs(n.point.x - 340) < 1e-6 && Math.abs(n.point.y - 20) < 1e-6)).toBe(true);
  });

  it('replaces envelopes by their artwork for drawing, and hides contents being edited', () => {
    const holder: Layer = { ...newLayer('path', 'env', { x: 100, y: 50 }), width: 200, height: 100, envelope: envelope() };
    const drawn = materializeEnvelopes({ ...({} as never), format: 'ximply-document', version: 2, name: 'd', width: 400, height: 300, background: '#ffffff', layers: [holder] } as never);
    expect(drawn.layers.map((l) => l.id)).toEqual(['env::0']);
    const editing: Layer = { ...holder, envelope: { ...envelope(), contents: [], editing: 'contents' } };
    const member: Layer = { ...content, id: 'm', groupPath: ['g'] };
    const shown = materializeEnvelopes({ format: 'ximply-document', version: 2, name: 'd', width: 400, height: 300, background: '#ffffff', layers: [editing, member] } as never);
    expect(shown.layers.map((l) => l.id)).toEqual(['env::0']);
  });

  it('accepts only well-formed envelopes', () => {
    expect(envelopeShell(envelope())).toHaveLength(1);
    expect(envelopeShell({ ...envelope(), fidelity: 101 })).toBeNull();
    expect(envelopeShell({ ...envelope(), origin: 'warp' })).toBeNull();
    expect(envelopeShell({ ...envelope(), contents: [] })).toBeNull();
    expect(envelopeShell({ ...envelope(), contents: [{ ...content, kind: 'text' }] })).toBeNull();
    expect(envelopeShell({ ...envelope(), mesh: { ...gridMesh(box, 1, 1), rows: 2 } })).toBeNull();
    expect(envelopeShell({ ...envelope(), mesh: { ...gridMesh(box, 1, 1), us: [0, 1.2] } })).toBeNull();
    expect(envelopeShell({ ...envelope(), origin: 'warp', warp: { ...DEFAULT_WARP, bend: 150 } })).toBeNull();
    expect(envelopeShell({ ...envelope(), origin: 'warp', warp: DEFAULT_WARP })).toHaveLength(1);
  });
});

describe('envelopes on the page', () => {
  it('carry their distortion when the layer is moved or resized', async () => {
    const { resizeLayer } = await import('../src/document');
    const content: Layer = { ...newLayer('rectangle', 'c', { x: 100, y: 50 }, '#ff0000', 'none', 0), width: 200, height: 100 };
    const holder: Layer = { ...newLayer('path', 'env', { x: 100, y: 50 }), width: 200, height: 100,
      envelope: { contents: [content], source: box, mesh: gridMesh({ x: 0, y: 0, width: 200, height: 100 }, 1, 1), origin: 'grid', fidelity: 0, editing: 'envelope', group: 'g' } };
    const first = (l: Layer) => worldCurves(envelopeArtwork(l)[0])![0].nodes[0].point;
    close(first(holder), { x: 100, y: 50 });
    close(first({ ...holder, x: 130, y: 70 }), { x: 130, y: 70 });
    const doubled = resizeLayer(holder, 400, 200);
    const far = worldCurves(envelopeArtwork(doubled)[0])![0].nodes.map((n) => n.point).reduce((m, p) => (p.x + p.y > m.x + m.y ? p : m));
    close(far, { x: 500, y: 250 });
  });

  it('refits its box to a mesh that grew past it', async () => {
    const { fitEnvelope } = await import('../src/envelope');
    const holder: Layer = { ...newLayer('path', 'env', { x: 100, y: 50 }), width: 200, height: 100,
      envelope: { contents: [{ ...newLayer('rectangle', 'c', { x: 0, y: 0 }), width: 10, height: 10 }], source: { x: 0, y: 0, width: 10, height: 10 }, mesh: gridMesh({ x: 0, y: 0, width: 200, height: 100 }, 1, 1), origin: 'grid', fidelity: 0, editing: 'envelope', group: 'g' } };
    holder.envelope!.mesh.nodes[0].point = { x: -20, y: -10 };
    const fitted = fitEnvelope(holder);
    expect([fitted.x, fitted.y, fitted.width, fitted.height]).toEqual([80, 40, 220, 110]);
    close(worldCurves(envelopeArtwork(fitted)[0])![0].nodes[0].point, { x: 80, y: 40 });
  });
});
