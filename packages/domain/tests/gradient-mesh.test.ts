import { describe, expect, it } from 'vitest';
import { Layer, newLayer, parseDocument } from '../src/document';
import { worldPoint } from '../src/curves';
import { addMeshPoint, gradientMeshFor, meshColorAt, meshFacets, meshPatches, placeGradientMesh, removeMeshPoint, validGradientMesh } from '../src/gradient-mesh';
import { meshPoint } from '../src/envelope';
import { meshShading } from '../src/pdf';

const box = (): Layer => ({ ...newLayer('rectangle', 'r', { x: 100, y: 50 }, '#ff0000', 'none', 0), width: 200, height: 100 });
const meshLayer = (gm = gradientMeshFor(box(), 1, 1, 'flat', 0, '#ff0000')!): Layer => {
  const { box: b, mesh } = placeGradientMesh(gm);
  return { ...newLayer('path', 'm', { x: b.x, y: b.y }, '#ff0000', 'none', 0), width: b.width, height: b.height, points: [], gradientMesh: mesh };
};

describe('gradient meshes', () => {
  it('take the outline of the object and its colour', () => {
    const gm = gradientMeshFor(box(), 2, 3, 'flat', 0, '#ff0000')!;
    expect([gm.mesh.rows, gm.mesh.columns]).toEqual([2, 3]);
    expect(gm.colors.every((c) => c === '#ff0000')).toBe(true);
    const corner = meshPoint(gm.mesh, 1, 1);
    expect(corner.x).toBeCloseTo(300, 6);
    expect(corner.y).toBeCloseTo(150, 6);
  });

  it('lighten the middle with To Center and the border with To Edge', () => {
    const centre = gradientMeshFor(box(), 2, 2, 'toCenter', 100, '#ff0000')!;
    expect(centre.colors[4]).toBe('#ffffff');
    expect(centre.colors[0]).toBe('#ff0000');
    const edge = gradientMeshFor(box(), 2, 2, 'toEdge', 50, '#ff0000')!;
    expect(edge.colors[0]).toBe('#ff8080');
    expect(edge.colors[4]).toBe('#ff0000');
  });

  it('blend the four colours of a patch by where a point lies in it', () => {
    const gm = { ...gradientMeshFor(box(), 1, 1, 'flat', 0, '#000000')! };
    gm.colors = ['#000000', '#ffffff', '#000000', '#ffffff'];
    expect(meshColorAt(gm, 0.5, 0.3)).toBe('#808080');
    expect(meshColorAt(gm, 0, 0.9)).toBe('#000000');
  });

  it('add a mesh point in the fill colour, or keep the colour there, and remove it again', () => {
    const gm = gradientMeshFor(box(), 1, 1, 'flat', 0, '#ff0000')!;
    const { mesh, index } = addMeshPoint(gm, 0.25, 0.5, '#0000ff');
    expect([mesh.mesh.rows, mesh.mesh.columns]).toEqual([2, 2]);
    expect(mesh.colors[index]).toBe('#0000ff');
    expect(addMeshPoint(gm, 0.25, 0.5, null).mesh.colors.every((c) => c === '#ff0000')).toBe(true);
    const back = removeMeshPoint(mesh, index)!;
    expect([back.mesh.rows, back.mesh.columns]).toEqual([1, 1]);
    expect(removeMeshPoint(mesh, 0)).toBeNull();
  });

  it('are validated in the native format and refused on text', () => {
    const layer = meshLayer();
    const doc = { format: 'ximply-document', version: 2, name: 'd', width: 400, height: 300, background: '#ffffff', layers: [layer] };
    expect(() => parseDocument(JSON.stringify(doc))).not.toThrow();
    expect(validGradientMesh({ ...layer.gradientMesh, colors: ['#ff0000'] })).toBe(false);
    expect(() => parseDocument(JSON.stringify({ ...doc, layers: [{ ...layer, curves: [] }] }))).toThrow();
    expect(() => parseDocument(JSON.stringify({ ...doc, version: 1 }))).toThrow();
    expect(gradientMeshFor({ ...box(), kind: 'text', text: 'A' }, 1, 1, 'flat', 0, '#000000')).toBeNull();
  });

  it('are drawn as facets that cover the object in the colour where they lie', () => {
    const facets = meshFacets(meshLayer(), 20);
    const area = facets.reduce((sum, f) => { const [a, b, c] = f.points; return sum + Math.abs((b.x - a.x) * (c.y - a.y)); }, 0);
    expect(area).toBeCloseTo(200 * 100, 0);
    expect(facets.every((f) => f.color === '#ff0000')).toBe(true);
  });

  it('are written to PDF as a Coons patch mesh with each patch in order', () => {
    const layer = meshLayer();
    const [patch] = meshPatches(layer);
    expect(patch.points).toHaveLength(12);
    expect(worldPoint(layer, layer.gradientMesh!.mesh.nodes[0].point)).toEqual(patch.points[0]);
    const { shading } = meshShading(layer);
    expect(shading).toContain('/ShadingType 6');
    // One patch: a flag byte, twelve points of two 32-bit numbers and four colours of three bytes.
    expect(shading).toContain(`/Length ${1 + 12 * 8 + 4 * 3}`);
  });
});
