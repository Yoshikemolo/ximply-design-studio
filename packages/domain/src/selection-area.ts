import type { Layer, Point } from "./document";
import { flatten, worldPoint } from "./curves";

export type AreaSelectionKind = "rectangle" | "ellipse" | "lasso";
export interface SelectionArea { kind: AreaSelectionKind; start: Point; end: Point; points: Point[] }
const EPSILON = 1e-8;
function cross(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.abs(cross(a, b, p)) < EPSILON && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
function contains(points: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (onSegment(p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function ellipsePoints(center: Point, rx: number, ry: number): Point[] {
  return Array.from({length:64}, (_, i) => { const angle = i * Math.PI / 32; return {x:center.x + rx*Math.cos(angle), y:center.y + ry*Math.sin(angle)}; });
}
function box(points: Point[]) {
  return points.reduce((b,p)=>({left:Math.min(b.left,p.x),right:Math.max(b.right,p.x),top:Math.min(b.top,p.y),bottom:Math.max(b.bottom,p.y)}),{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
}
function boxesOverlap(a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean { return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom; }
export function selectionAreaPolygon(area: SelectionArea): Point[] {
  if (area.kind === "lasso") return area.points;
  const {start: a, end: b} = area;
  if (area.kind === "rectangle") return [a, {x:b.x,y:a.y}, b, {x:a.x,y:b.y}];
  const radius = Math.hypot(b.x-a.x,b.y-a.y);
  return ellipsePoints(a,radius,radius);
}
/** Crossing selection against transformed contours, with even-odd compound fills. */
export function layerIntersectsArea(layer: Layer, area: SelectionArea): boolean {
  if (!layer.visible || layer.locked || layer.guide) return false;
  const polygon = selectionAreaPolygon(area);
  if (polygon.length < 3) return false;
  let contours: {points:Point[];closed:boolean}[];
  if (layer.curves) contours = layer.curves.map(path => ({points:flatten(path),closed:path.closed}));
  else if (layer.kind === "path") contours = [{points:layer.points,closed:false}];
  else if (layer.kind === "ellipse") contours = [{points:ellipsePoints({x:layer.width/2,y:layer.height/2},layer.width/2,layer.height/2),closed:true}];
  else contours = [{points:[{x:0,y:0},{x:layer.width,y:0},{x:layer.width,y:layer.height},{x:0,y:layer.height}],closed:true}];
  contours = contours.map(contour => ({...contour,points:contour.points.map(p=>worldPoint(layer,p))}));
  const areaBounds = box(polygon);
  const areaEdges = polygon.map((a,index)=> { const b=polygon[(index+1)%polygon.length]; return {a,b,bounds:box([a,b])}; });
  if (!contours.some(contour=>boxesOverlap(box(contour.points), areaBounds))) return false;
  for (const contour of contours) {
    if (!boxesOverlap(box(contour.points), areaBounds)) continue;
    if (contour.points.some(p=>contains(polygon,p))) return true;
    const count = contour.closed ? contour.points.length : contour.points.length-1;
    for (let i=0; i<count; i++) {
      const a=contour.points[i], b=contour.points[(i+1)%contour.points.length], segmentBounds=box([a,b]);
      if (!boxesOverlap(segmentBounds,areaBounds)) continue;
      for (const edge of areaEdges) if (boxesOverlap(segmentBounds,edge.bounds) && intersects(a,b,edge.a,edge.b)) return true;
    }
  }
  return polygon.some(p=>contours.reduce((inside, contour)=>contour.closed && contains(contour.points,p) ? !inside : inside,false));
}
