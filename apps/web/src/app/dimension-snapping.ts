import type { Layer, Point } from '../../../../packages/domain/src/document';
import { flatten, worldPoint } from '../../../../packages/domain/src/curves';
import { dimensionGeometry } from '../../../../packages/domain/src/dimensions';

export type DimensionSnap = { point: Point; kind: 'vertex' | 'midpoint' | 'line' | 'intersection' | 'dimension' };
type Segment = { a: Point; b: Point };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function projection(p: Point, {a,b}: Segment, bounded = true): Point {
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  let t=den ? ((p.x-a.x)*dx+(p.y-a.y)*dy)/den : 0;
  if(bounded)t=Math.max(0,Math.min(1,t));
  return {x:a.x+t*dx,y:a.y+t*dy};
}
function intersection(a: Segment,b: Segment): Point | null {
  const x=a.b.x-a.a.x,y=a.b.y-a.a.y,u=b.b.x-b.a.x,v=b.b.y-b.a.y,den=x*v-y*u;
  if(Math.abs(den)<1e-9)return null;
  const dx=b.a.x-a.a.x,dy=b.a.y-a.a.y,t=(dx*v-dy*u)/den,s=(dx*y-dy*x)/den;
  return t>=0&&t<=1&&s>=0&&s<=1 ? {x:a.a.x+t*x,y:a.a.y+t*y} : null;
}
/** Align a dimension line with a parallel one already in the drawing, so their offsets match. */
export function snapDimensionOffset(layers: Layer[], anchors: Point[], point: Point, radius: number): Point | null {
  if (anchors.length < 2) return null;
  const dx = anchors[1].x - anchors[0].x, dy = anchors[1].y - anchors[0].y, length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const u = { x: dx / length, y: dy / length };
  let best: Point | null = null, closest = radius;
  for (const layer of layers) {
    if (!layer.dimension || !layer.visible || layer.locked || layer.dimension.kind !== 'linear') continue;
    const line = dimensionGeometry(layer).lines.find(segment => !segment.extension);
    if (!line) continue;
    const vx = line.b.x - line.a.x, vy = line.b.y - line.a.y, span = Math.hypot(vx, vy);
    if (span < 1e-6) continue;
    // Only parallel annotations share an offset line; a degree of tolerance keeps hand-drawn runs usable.
    if (Math.abs((vx / span) * u.y - (vy / span) * u.x) > 0.02) continue;
    const projected = projection(point, { a: line.a, b: line.b }, false), distance = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (distance <= closest) { closest = distance; best = projected; }
  }
  return best;
}
/** Prefer singular points to projections; intersections use only nearby segments. */
export function snapDimensionPoint(layers: Layer[], point: Point, radius: number, finalAnchor = false): DimensionSnap | null {
  const candidates: DimensionSnap[] = [], nearby: Segment[] = [];
  const add=(p:Point,kind:DimensionSnap['kind'])=>{if(distance(p,point)<=radius)candidates.push({point:p,kind});};
  for(const layer of layers){
    if(!layer.visible||layer.guide)continue;
    if(layer.dimension){
      // Existing annotations are magnetic so consecutive dimensions line up with each other.
      if(layer.locked)continue;
      const geometry=dimensionGeometry(layer);
      for(const p of geometry.anchors)add(p,'dimension');
      for(const segment of geometry.lines)for(const p of [segment.a,segment.b])add(p,'dimension');
      continue;
    }
    let paths:{points:Point[];closed:boolean;vertices:Point[]}[];
    if(layer.curves) paths=layer.curves.map(path=>({points:flatten(path),closed:path.closed,vertices:path.nodes.map(n=>n.point)}));
    else if(layer.kind==='path')paths=[{points:layer.points,vertices:layer.points,closed:false}];
    else if(layer.kind==='ellipse'){
      const points=Array.from({length:96},(_,i)=>({x:layer.width/2*(1+Math.cos(i*Math.PI/48)),y:layer.height/2*(1+Math.sin(i*Math.PI/48))}));
      paths=[{points,closed:true,vertices:[points[0],points[24],points[48],points[72]]}];
      add(worldPoint(layer,{x:layer.width/2,y:layer.height/2}),'midpoint');
    }else{const points=[{x:0,y:0},{x:layer.width,y:0},{x:layer.width,y:layer.height},{x:0,y:layer.height}];paths=[{points,vertices:points,closed:true}];}
    for(const path of paths){
      path.vertices.forEach(p=>add(worldPoint(layer,p),'vertex'));
      if(layer.curves){
        const curve=layer.curves[paths.indexOf(path)];
        for(let i=0;i<curve.nodes.length-(curve.closed?0:1);i++){
          const a=curve.nodes[i],b=curve.nodes[(i+1)%curve.nodes.length];
          add(worldPoint(layer,{x:(a.point.x+3*a.outgoing.x+3*b.incoming.x+b.point.x)/8,y:(a.point.y+3*a.outgoing.y+3*b.incoming.y+b.point.y)/8}),'midpoint');
        }
      }
      const points=path.points.map(p=>worldPoint(layer,p));
      for(let i=0;i<points.length-(path.closed?0:1);i++){
        const a=points[i],b=points[(i+1)%points.length],segment={a,b};
        if(!layer.curves && layer.kind!=='ellipse')add({x:(a.x+b.x)/2,y:(a.y+b.y)/2},'midpoint');
        const projected=projection(point,segment);
        if(distance(projected,point)<=radius){add(projected,'line');nearby.push(segment);}
      }
    }
  }
  nearby.sort((a,b)=>distance(projection(point,a),point)-distance(projection(point,b),point));nearby.splice(128);
  if(finalAnchor)for(let i=0;i<nearby.length;i++)for(let j=i+1;j<nearby.length;j++){const p=intersection(nearby[i],nearby[j]);if(p)add(p,'intersection');}
  const rank={vertex:0,intersection:0,dimension:0,midpoint:1,line:2};
  return candidates.sort((a,b)=>rank[a.kind]-rank[b.kind]||distance(a.point,point)-distance(b.point,point))[0]??null;
}
