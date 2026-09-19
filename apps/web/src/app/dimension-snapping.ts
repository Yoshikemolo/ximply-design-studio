import type { Layer, Point } from '../../../../packages/domain/src/document';
import { flatten, worldPoint } from '../../../../packages/domain/src/curves';

export type DimensionSnap = { point: Point; kind: 'vertex' | 'midpoint' | 'line' | 'intersection' };
type Segment = { a: Point; b: Point };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function projection(p: Point, {a,b}: Segment): Point {
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)) : 0;
  return {x:a.x+t*dx,y:a.y+t*dy};
}
function intersection(a: Segment,b: Segment): Point | null {
  const x=a.b.x-a.a.x,y=a.b.y-a.a.y,u=b.b.x-b.a.x,v=b.b.y-b.a.y,den=x*v-y*u;
  if(Math.abs(den)<1e-9)return null;
  const dx=b.a.x-a.a.x,dy=b.a.y-a.a.y,t=(dx*v-dy*u)/den,s=(dx*y-dy*x)/den;
  return t>=0&&t<=1&&s>=0&&s<=1 ? {x:a.a.x+t*x,y:a.a.y+t*y} : null;
}
/** Prefer singular points to projections; intersections use only nearby segments. */
export function snapDimensionPoint(layers: Layer[], point: Point, radius: number, finalAnchor = false): DimensionSnap | null {
  const candidates: DimensionSnap[] = [], nearby: Segment[] = [];
  const add=(p:Point,kind:DimensionSnap['kind'])=>{if(distance(p,point)<=radius)candidates.push({point:p,kind});};
  for(const layer of layers){
    if(!layer.visible||layer.guide||layer.dimension)continue;
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
  const rank={vertex:0,intersection:0,midpoint:1,line:2};
  return candidates.sort((a,b)=>rank[a.kind]-rank[b.kind]||distance(a.point,point)-distance(b.point,point))[0]??null;
}
