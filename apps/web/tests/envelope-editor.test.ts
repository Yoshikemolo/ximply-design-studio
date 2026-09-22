// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { Layer, newLayer, parseDocument, svgExport } from '../../../packages/domain/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';
import { materializeEnvelopes } from '../../../packages/domain/src/envelope';
import { worldCurves } from '../../../packages/domain/src/distort';
import { pdfDocument } from '../../../packages/domain/src/pdf';

const rect = (id: string, x: number, y: number, w = 100, h = 50, extra: Partial<Layer> = {}): Layer => ({ ...newLayer('rectangle', id, { x, y }, '#ff0000', 'none', 0), width: w, height: h, ...extra });
function editor(layers: Layer[]) {
  localStorage.clear();
  const e = new EditorService();
  e.zoom.set(1);
  e.document.update((d) => ({ ...d, version: 2, layers }));
  e.selectAll();
  return e;
}
const valid = (e: EditorService) => parseDocument(JSON.stringify(e.document()));
const drawnCorner = (e: EditorService) => worldCurves(materializeEnvelopes(e.document()).layers[0])![0].nodes[0].point;
beforeEach(() => localStorage.clear());

describe('making envelopes', () => {
  it('makes one envelope with a warp that holds the selection, as one step', () => {
    const e = editor([rect('a', 100, 100), rect('b', 150, 120)]);
    expect(e.makeEnvelope('warp', { warp: { style: 'flag', axis: 'horizontal', bend: 50, horizontal: 0, vertical: 0 } })).toBe(true);
    const [layer] = e.document().layers;
    expect(e.document().layers).toHaveLength(1);
    expect(layer.name).toBe('Envelope');
    expect(layer.envelope!.contents.map((c) => c.id)).toEqual(['a', 'b']);
    expect(layer.envelope!.origin).toBe('warp');
    expect(e.selectedId()).toBe(layer.id);
    valid(e);
    e.undo();
    expect(e.document().layers.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('leaves the contents where they are with an unedited mesh', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('mesh', { rows: 3, columns: 2 });
    const drawn = drawnCorner(e);
    expect(drawn.x).toBeCloseTo(100, 6);
    expect(drawn.y).toBeCloseTo(100, 6);
    expect(e.document().layers[0].envelope!.mesh.rows).toBe(3);
  });

  it('uses the top object as the shape of the envelope', () => {
    const diamond: Layer = { ...newLayer('path', 'shape', { x: 0, y: 0 }), width: 200, height: 200, curves: [{ closed: true, nodes: [{ x: 100, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 100 }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) }] };
    const e = editor([rect('a', 50, 50), diamond]);
    expect(e.makeEnvelope('object')).toBe(true);
    const [layer] = e.document().layers;
    expect(e.document().layers).toHaveLength(1);
    expect(layer.envelope!.origin).toBe('object');
    // The top left of the enveloped box lands on the diamond.
    const p = drawnCorner(e);
    expect(Math.abs(Math.abs(p.x - 100) + Math.abs(p.y - 100) - 100)).toBeLessThan(2);
  });

  it('asks for outlines of text first and leaves pictures out', () => {
    const e = editor([rect('a', 0, 0), { ...rect('t', 0, 0), kind: 'text', text: 'A' }]);
    expect(e.makeEnvelope('warp')).toBe(false);
    expect(e.status()).toContain('Create outlines of the text first');
    const f = editor([{ ...rect('i', 0, 0), kind: 'image' }]);
    expect(f.makeEnvelope('mesh')).toBe(false);
  });

  it('previews a warp without a step and confirms or cancels it', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('warp', { warp: { style: 'arc', axis: 'horizontal', bend: 30, horizontal: 0, vertical: 0 } }, true);
    e.makeEnvelope('warp', { warp: { style: 'bulge', axis: 'horizontal', bend: 30, horizontal: 0, vertical: 0 } }, true);
    expect(e.document().layers[0].envelope?.warp?.style).toBe('bulge');
    e.cancelEnvelopePreview();
    expect(e.document().layers.map((l) => l.id)).toEqual(['a']);
    e.makeEnvelope('warp', { warp: { style: 'arc', axis: 'horizontal', bend: 30, horizontal: 0, vertical: 0 } }, true);
    e.makeEnvelope('warp', { warp: { style: 'arc', axis: 'horizontal', bend: 30, horizontal: 0, vertical: 0 } });
    e.undo();
    expect(e.document().layers.map((l) => l.id)).toEqual(['a']);
  });
});

describe('working with an envelope', () => {
  it('releases the objects as they were with the shape above them', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('warp');
    expect(e.releaseEnvelope()).toBe(true);
    const layers = e.document().layers;
    expect(layers.map((l) => l.kind)).toEqual(['rectangle', 'path']);
    expect([layers[0].x, layers[0].y, layers[0].width]).toEqual([100, 100, 100]);
    expect(layers[1].name).toBe('Envelope shape');
    valid(e);
  });

  it('expands into the distorted paths', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('warp');
    const drawn = materializeEnvelopes(e.document()).layers[0];
    expect(e.expandEnvelope()).toBe(true);
    const [out] = e.document().layers;
    expect(out.envelope).toBeUndefined();
    expect(worldCurves(out)![0].nodes[3].point.x).toBeCloseTo(worldCurves(drawn)![0].nodes[3].point.x, 6);
  });

  it('edits the contents and the envelope in turn, recentring on the contents', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('mesh', { rows: 1, columns: 1 });
    const id = e.selectedId()!;
    expect(e.toggleEnvelopeEditing()).toBe(true);
    const member = e.document().layers.find((l) => l.id === 'a')!;
    expect(member.groupPath?.[0]).toBe(e.document().layers[0].envelope!.group);
    expect(e.selectedIds()).toEqual(['a']);
    valid(e);
    // The contents are edited with the ordinary tools, and still drawn through the envelope.
    e.updateLayer({ width: 200 });
    expect(materializeEnvelopes(e.document()).layers.map((l) => l.id)).toEqual([id + '::0']);
    expect(e.toggleEnvelopeEditing()).toBe(true);
    const holder = e.document().layers[0];
    expect(e.document().layers).toHaveLength(1);
    expect(holder.envelope!.contents[0].width).toBe(200);
    expect(holder.envelope!.source.width).toBe(200);
    expect(e.selectedId()).toBe(id);
  });

  it('sets the fidelity and resets the mesh keeping the shape', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('warp', { warp: { style: 'flag', axis: 'horizontal', bend: 60, horizontal: 0, vertical: 0 } });
    expect(e.setEnvelopeFidelity(90)).toBe(true);
    expect(e.document().layers[0].envelope!.fidelity).toBe(90);
    const before = drawnCorner(e);
    expect(e.resetEnvelopeWithMesh(8, 8, true)).toBe(true);
    const layer = e.document().layers[0];
    expect([layer.envelope!.mesh.rows, layer.envelope!.origin, layer.envelope!.warp]).toEqual([8, 'grid', undefined]);
    const after = drawnCorner(e);
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.5);
    expect(e.resetEnvelopeWithWarp({ style: 'arc', axis: 'vertical', bend: 20, horizontal: 0, vertical: 0 })).toBe(true);
    expect(e.document().layers[0].envelope!.warp?.style).toBe('arc');
    valid(e);
  });

  it('moves a mesh point with the Direct Selection tool and removes its lines with Delete', () => {
    const e = editor([rect('a', 100, 100, 100, 50)]);
    e.makeEnvelope('mesh', { rows: 2, columns: 2 });
    e.setTool('direct');
    // The middle node of a 2 by 2 grid over the box sits at its centre.
    e.start({ x: 150, y: 125 });
    e.move({ x: 170, y: 140 });
    e.end();
    const layer = e.document().layers[0];
    const middle = worldPoint(layer, layer.envelope!.mesh.nodes[4].point);
    expect(middle.x).toBeCloseTo(170, 6);
    expect(middle.y).toBeCloseTo(140, 6);
    expect(e.meshNode()).toEqual({ id: layer.id, index: 4 });
    e.remove();
    expect(e.document().layers[0].envelope!.mesh.rows).toBe(1);
    expect(e.document().layers).toHaveLength(1);
    valid(e);
  });

  it('adds a row and a column with the Mesh tool where it clicks', () => {
    const e = editor([rect('a', 100, 100, 100, 50)]);
    e.makeEnvelope('mesh', { rows: 1, columns: 1 });
    e.setTool('mesh');
    e.start({ x: 130, y: 110 });
    e.end();
    const mesh = e.document().layers[0].envelope!.mesh;
    expect([mesh.rows, mesh.columns]).toEqual([2, 2]);
    expect(mesh.us[1]).toBeCloseTo(0.3, 3);
    expect(mesh.vs[1]).toBeCloseTo(0.2, 3);
  });

  it('draws the same distortion on the canvas, in SVG and in PDF, and moves with the layer', () => {
    const e = editor([rect('a', 100, 100)]);
    e.makeEnvelope('warp', { warp: { style: 'arc', axis: 'horizontal', bend: 40, horizontal: 0, vertical: 0 } });
    expect(svgExport(e.document())).toContain('fill="#ff0000"');
    expect(pdfDocument([{ document: e.document() }]).data).toContain('1 0 0 rg');
    const before = drawnCorner(e);
    e.nudge(10, 5);
    const after = drawnCorner(e);
    expect(after.x - before.x).toBeCloseTo(10, 6);
    expect(after.y - before.y).toBeCloseTo(5, 6);
  });
});

describe('the Mesh tool on an envelope that is not selected', () => {
  it('takes the envelope it clicks on and adds a row and a column there', () => {
    const e = editor([rect('a', 100, 100, 100, 50)]);
    e.makeEnvelope('mesh', { rows: 1, columns: 1 });
    e.selectedIds.set([]);
    e.selectedId.set(null);
    e.setTool('mesh');
    e.start({ x: 150, y: 120 });
    e.end();
    const layer = e.document().layers[0];
    expect(e.selectedId()).toBe(layer.id);
    expect([layer.envelope!.mesh.rows, layer.envelope!.mesh.columns]).toEqual([2, 2]);
  });

  it('turns an object that is not an envelope into a gradient mesh', () => {
    const e = editor([rect('a', 100, 100)]);
    e.setTool('mesh');
    e.start({ x: 150, y: 120 });
    e.end();
    expect(e.document().layers[0].gradientMesh).toBeDefined();
  });
});
