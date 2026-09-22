import type { Layer, Point } from "./document";
import { cubic, worldPoint } from "./curves";
import { EnvelopeMesh, mapMesh, meshBounds, meshPoint, objectMesh, resampleMesh, validMesh } from "./envelope";
import { worldCurves } from "./distort";
import { mixColors } from "./paint";

/**
 * Gradient meshes, as Illustrator's Mesh tool and Object > Create Gradient Mesh make them:
 * a mesh of Coons patches, the same kind the envelopes use, whose points carry colours
 * that blend across each patch. The mesh is in the layer's own coordinates.
 */
export interface GradientMesh { mesh: EnvelopeMesh; colors: string[] }
export type MeshAppearance = "flat" | "toCenter" | "toEdge";
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

export function validGradientMesh(value: unknown): value is GradientMesh {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  return Object.keys(g).length === 2 && validMesh(g["mesh"]) && Array.isArray(g["colors"]) &&
    g["colors"].length === (g["mesh"] as EnvelopeMesh).nodes.length && g["colors"].every((c) => typeof c === "string" && HEX.test(c));
}

/** The cell of the grid holding u and v, and where in it they lie. */
function cellAt(mesh: EnvelopeMesh, u: number, v: number) {
  const find = (lines: number[], x: number) => {
    const c = Math.max(0, Math.min(1, x));
    let k = 0;
    while (k < lines.length - 2 && c > lines[k + 1]) k++;
    return { k, f: (c - lines[k]) / ((lines[k + 1] - lines[k]) || 1) };
  };
  const { k: j, f: s } = find(mesh.us, u), { k: i, f: t } = find(mesh.vs, v);
  return { i, j, s, t };
}
/** The colour of the mesh at u and v: the four colours of the patch blended by where the point lies in it. */
export function meshColorAt(gm: GradientMesh, u: number, v: number): string {
  const { i, j, s, t } = cellAt(gm.mesh, u, v), w = gm.mesh.columns + 1;
  const top = mixColors(gm.colors[i * w + j], gm.colors[i * w + j + 1], s);
  const bottom = mixColors(gm.colors[(i + 1) * w + j], gm.colors[(i + 1) * w + j + 1], s);
  return mixColors(top, bottom, t);
}

/** Lines at other places, the shape and the colours kept: the colours are sampled from the old mesh. */
export function resampleGradientMesh(gm: GradientMesh, us: number[], vs: number[]): GradientMesh {
  const mesh = resampleMesh(gm.mesh, us, vs);
  const colors = mesh.vs.flatMap((v) => mesh.us.map((u) => meshColorAt(gm, u, v)));
  return { mesh, colors };
}
/**
 * A click of the Mesh tool: a row and a column through the point at u and v, whose new mesh
 * point takes `color`, or keeps the colour already there when `color` is null, as Shift does.
 */
export function addMeshPoint(gm: GradientMesh, u: number, v: number, color: string | null): { mesh: GradientMesh; index: number } {
  const fresh = (lines: number[], x: number) => (lines.some((l) => Math.abs(l - x) < 1e-3) ? lines : [...lines, x]);
  const next = resampleGradientMesh(gm, fresh(gm.mesh.us, u), fresh(gm.mesh.vs, v));
  const j = next.mesh.us.findIndex((x) => Math.abs(x - u) < 1e-3), i = next.mesh.vs.findIndex((x) => Math.abs(x - v) < 1e-3);
  const index = i * (next.mesh.columns + 1) + j;
  if (color) next.colors[index] = color;
  return { mesh: next, index };
}
/** Alt-click on a mesh point with the Mesh tool: its row and its column go, the border stays. */
export function removeMeshPoint(gm: GradientMesh, index: number): GradientMesh | null {
  const w = gm.mesh.columns + 1, j = index % w, i = Math.floor(index / w);
  const us = gm.mesh.us.filter((_, k) => k !== j || k === 0 || k === gm.mesh.columns), vs = gm.mesh.vs.filter((_, k) => k !== i || k === 0 || k === gm.mesh.rows);
  if (us.length === gm.mesh.us.length && vs.length === gm.mesh.vs.length) return null;
  return resampleGradientMesh(gm, us, vs);
}

/**
 * Object > Create Gradient Mesh and the first click of the Mesh tool: the outline of the
 * object split into four sides bounds one patch, divided into rows and columns. Flat paints
 * every point in the object's colour; To Center lightens the middle and To Edge the border,
 * by the highlight, the percentage of white. The result is in page coordinates.
 */
export function gradientMeshFor(layer: Layer, rows: number, columns: number, appearance: MeshAppearance, highlight: number, color: string): GradientMesh | null {
  const outline = worldCurves(layer)?.find((path) => path.closed && path.nodes.length > 1);
  const patch = outline ? objectMesh(outline, 1) : null;
  if (!patch) return null;
  const lines = (n: number) => Array.from({ length: n + 1 }, (_, k) => k / n);
  const mesh = resampleMesh(patch, lines(columns), lines(rows));
  const white = mixColors(color.slice(0, 7), "#ffffff", Math.max(0, Math.min(100, highlight)) / 100) + (color.length === 9 ? color.slice(7) : "");
  const colors = mesh.vs.flatMap((v, i) => mesh.us.map((u, j) => {
    const border = i === 0 || j === 0 || i === mesh.rows || j === mesh.columns;
    if (appearance === "toEdge") return border ? white : color;
    if (appearance === "toCenter") {
      // The highlight fades from the middle of the object to its border.
      const d = Math.min(1, Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2);
      return border ? color : mixColors(white, color, d);
    }
    return color;
  }));
  return { mesh, colors };
}

/** A new layer box for a mesh given in page coordinates, the mesh moved into it. */
export function placeGradientMesh(gm: GradientMesh): { box: { x: number; y: number; width: number; height: number }; mesh: GradientMesh } {
  const box = meshBounds(gm.mesh);
  return { box, mesh: { mesh: mapMesh(gm.mesh, (p) => ({ x: p.x - box.x, y: p.y - box.y })), colors: [...gm.colors] } };
}

/**
 * The mesh drawn as small facets on the page, each with the colour at its middle: the
 * canvas and SVG draw these, fine enough that no facet is wider than `size` pixels.
 */
export function meshFacets(layer: Layer, size = 4): { points: Point[]; color: string }[] {
  const gm = layer.gradientMesh!, mesh = gm.mesh, out: { points: Point[]; color: string }[] = [];
  const w = (p: Point) => worldPoint(layer, p);
  for (let i = 0; i < mesh.rows; i++)
    for (let j = 0; j < mesh.columns; j++) {
      const u0 = mesh.us[j], u1 = mesh.us[j + 1], v0 = mesh.vs[i], v1 = mesh.vs[i + 1];
      const corners = [meshPoint(mesh, u0, v0), meshPoint(mesh, u1, v0), meshPoint(mesh, u1, v1), meshPoint(mesh, u0, v1)].map(w);
      const span = Math.max(...corners.map((p, k) => Math.hypot(p.x - corners[(k + 1) % 4].x, p.y - corners[(k + 1) % 4].y)));
      const n = Math.max(2, Math.min(32, Math.ceil(span / size)));
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const at = (x: number, y: number) => w(meshPoint(mesh, u0 + (u1 - u0) * x, v0 + (v1 - v0) * y));
          const x0 = b / n, x1 = (b + 1) / n, y0 = a / n, y1 = (a + 1) / n;
          out.push({
            points: [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)],
            color: meshColorAt(gm, u0 + (u1 - u0) * (x0 + x1) / 2, v0 + (v1 - v0) * (y0 + y1) / 2),
          });
        }
    }
  return out;
}

/** The twelve control points and four colours of each patch, in the order a PDF Coons patch mesh takes them. */
export function meshPatches(layer: Layer): { points: Point[]; colors: string[] }[] {
  const gm = layer.gradientMesh!, mesh = gm.mesh, cols = mesh.columns + 1, w = (p: Point) => worldPoint(layer, p);
  const out: { points: Point[]; colors: string[] }[] = [];
  for (let i = 0; i < mesh.rows; i++)
    for (let j = 0; j < mesh.columns; j++) {
      const a = mesh.nodes[i * cols + j], b = mesh.nodes[i * cols + j + 1], c = mesh.nodes[(i + 1) * cols + j], d = mesh.nodes[(i + 1) * cols + j + 1];
      // Around the boundary: along the top, down the right, back along the bottom and up the left.
      out.push({
        points: [a.point, a.right, b.left, b.point, b.down, d.up, d.point, d.left, c.right, c.point, c.up, a.down].map(w),
        colors: [gm.colors[i * cols + j], gm.colors[i * cols + j + 1], gm.colors[(i + 1) * cols + j + 1], gm.colors[(i + 1) * cols + j]],
      });
    }
  return out;
}
/** A point of a patch edge, for tests and hit testing. */
export const meshEdgePoint = (a: Point, b: Point, c: Point, d: Point, t: number) => cubic(a, b, c, d, t);
