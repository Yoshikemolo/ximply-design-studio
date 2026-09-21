import * as clipping from 'polygon-clipping';
import type { Layer, Point } from './document';
import { CurvePath, anchor, flatten, worldPoint } from './curves';
import { defaultStrokeStyle } from './document';

/**
 * Turns the stroke of a path into the shape it paints, which is what Outline Stroke means:
 * the line becomes artwork that can be filled, cut and combined like any other. The band is
 * composed from the pieces the stroke is made of and united once, so joins and caps meet.
 */
const JOIN_STEPS = 12;
const EPSILON = 1e-9;

/** Coordinates are snapped before they are combined, which keeps the clipper stable. */
const snap = (value: number) => Math.round(value * 1e6) / 1e6;
const ring = (points: Point[]): clipping.Ring => {
  const values = points.map((point) => [snap(point.x), snap(point.y)] as clipping.Pair);
  const first = values[0], last = values[values.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) values.push(first);
  return values;
};
/** A disc, which is what a round join or a round cap adds to the band. */
function disc(centre: Point, radius: number): clipping.Polygon {
  const points: Point[] = [];
  for (let step = 0; step < JOIN_STEPS; step++) {
    // Half a step of offset keeps the vertices of the disc off the corners of the segments,
    // where an exact overlap makes the clipper stumble.
    const angle = ((step + 0.5) / JOIN_STEPS) * Math.PI * 2;
    points.push({ x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius });
  }
  return [ring(points)];
}
/** The rectangle a single segment paints, with square caps when the stroke asks for them. */
function segment(from: Point, to: Point, radius: number, extend: number): clipping.Polygon | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return null;
  const ux = dx / length, uy = dy / length;
  const nx = -uy * radius, ny = ux * radius;
  const a = { x: from.x - ux * extend, y: from.y - uy * extend };
  const b = { x: to.x + ux * extend, y: to.y + uy * extend };
  return [ring([
    { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
  ])];
}
/**
 * World points of every contour of a layer, flattened for the composition, with the
 * corners of the path kept apart: a join belongs to a corner, not to a sample, and a
 * disc at a sample near an end would bulge past the cap of the stroke.
 */
function contours(layer: Layer, steps = 16): { points: Point[]; corners: Point[]; closed: boolean }[] {
  const paths = layer.curves ?? [];
  return paths
    .map((path) => {
      const nodes = path.nodes.map((node) => worldPoint(layer, node.point));
      return {
        points: flatten(path, steps).map((point) => worldPoint(layer, point)),
        corners: path.closed ? nodes : nodes.slice(1, -1),
        closed: path.closed,
      };
    })
    .filter((contour) => contour.points.length > 1);
}
/**
 * The shape the stroke of this layer paints, as closed contours in document coordinates,
 * or null when the layer carries no stroke to outline.
 */
export function outlineStroke(layer: Layer, steps = 16): CurvePath[] | null {
  if (!layer.curves?.length || layer.stroke === 'none' || !(layer.strokeWidth > 0)) return null;
  const style = layer.strokeStyle ?? defaultStrokeStyle;
  const radius = layer.strokeWidth / 2;
  const square = style.cap === 'square';
  const round = style.cap === 'round';
  const pieces: clipping.Polygon[] = [];
  for (const contour of contours(layer, steps)) {
    const points = contour.points;
    const count = contour.closed ? points.length : points.length - 1;
    for (let index = 0; index < count; index++) {
      const from = points[index], to = points[(index + 1) % points.length];
      const ends = !contour.closed && (index === 0 || index === count - 1) && square ? radius : 0;
      const piece = segment(from, to, radius, ends);
      if (piece) pieces.push(piece);
    }
    // A disc at every corner joins the pieces; the ends get one only for a round cap.
    for (const point of contour.corners) pieces.push(disc(point, radius));
    if (!contour.closed && round) for (const point of [points[0], points[points.length - 1]]) pieces.push(disc(point, radius));
  }
  if (!pieces.length) return null;
  // The pieces are combined in batches: one difficult piece then costs one batch, not the
  // whole outline, and the result of a batch is simple enough for the next one.
  let united: clipping.MultiPolygon = [pieces[0]];
  for (let index = 1; index < pieces.length; index += 8) {
    const batch = pieces.slice(index, index + 8);
    try { united = clipping.union(united, ...batch); }
    catch { for (const piece of batch) { try { united = clipping.union(united, piece); } catch { /* This piece cannot be combined; the band keeps the rest. */ } } }
  }
  const curves: CurvePath[] = [];
  for (const polygon of united) {
    for (const contour of polygon) {
      const points = contour.slice(0, -1).map(([x, y]) => ({ x, y }));
      if (points.length > 2) curves.push({ closed: true, nodes: points.map((point) => anchor(point)) });
    }
  }
  return curves.length ? curves : null;
}
