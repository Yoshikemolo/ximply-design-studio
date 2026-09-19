import type { Layer, Point } from './document';
export type LineEndKind = 'none'|'arrow'|'openArrow'|'triangle'|'dot'|'slash'|'cross';
export interface LineEnd { kind: LineEndKind; placement: 'tip'|'base'; size: number }
export interface LineEnds { start: LineEnd; end: LineEnd; linked: boolean }
export const defaultLineEnds: LineEnds = { start:{kind:'none',placement:'tip',size:10},end:{kind:'none',placement:'tip',size:10},linked:true };
export interface EndGeometry { points:Point[]; closed:boolean; circle?:{center:Point;radius:number}; segments?:Point[][] }
export function lineEndGeometry(point:Point,direction:Point,style:LineEnd):EndGeometry {
  const n=Math.hypot(direction.x,direction.y)||1,u={x:direction.x/n,y:direction.y/n},s=style.size;
  const tip=style.placement==='base'?{x:point.x+u.x*s,y:point.y+u.y*s}:point;
  const p=(x:number,y:number)=>({x:tip.x+u.x*x-u.y*y,y:tip.y+u.y*x+u.x*y});
  if(style.kind==='none')return {points:[],closed:false};
  if(style.kind==='dot')return {points:[],closed:true,circle:{center:p(-s/2,0),radius:s/2}};
  if(style.kind==='slash')return {points:[p(-s*.8,-s*.5),p(-s*.2,s*.5)],closed:false};
  if(style.kind==='cross')return {points:[],closed:false,segments:[[p(-s,-s/2),p(0,s/2)],[p(-s,s/2),p(0,-s/2)]]};
  return {points:style.kind==='arrow'?[p(-s,-s*.4),p(0,0),p(-s,s*.4),p(-s*.7,0)]:[p(-s,-s*.4),p(0,0),p(-s,s*.4)],closed:style.kind!=='openArrow'};
}
export function pathLineEnds(layer:Layer):{point:Point;direction:Point;style:LineEnd}[]{
  if(!layer.lineEnds||layer.kind!=='path')return [];
  const paths=layer.curves?.filter(p=>!p.closed).map(p=>p.nodes.map(n=>({point:n.point,incoming:n.incoming,outgoing:n.outgoing})))??[layer.points.map(point=>({point,incoming:point,outgoing:point}))];
  return paths.flatMap(nodes=>{if(nodes.length<2)return [];const a=nodes[0],b=nodes.at(-1)!;const next=a.outgoing.x!==a.point.x||a.outgoing.y!==a.point.y?a.outgoing:nodes[1].point;const prev=b.incoming.x!==b.point.x||b.incoming.y!==b.point.y?b.incoming:nodes.at(-2)!.point;return [{point:a.point,direction:{x:a.point.x-next.x,y:a.point.y-next.y},style:layer.lineEnds!.start},{point:b.point,direction:{x:b.point.x-prev.x,y:b.point.y-prev.y},style:layer.lineEnds!.end}];});
}
export function validLineEnds(value:unknown):boolean {
 const v=value as LineEnds;return !!v&&typeof v==='object'&&Object.keys(v).length===3&&typeof v.linked==='boolean'&&[v.start,v.end].every(e=>!!e&&typeof e==='object'&&Object.keys(e).length===3&&['none','arrow','openArrow','triangle','dot','slash','cross'].includes(e.kind)&&['tip','base'].includes(e.placement)&&Number.isFinite(e.size)&&e.size>0&&e.size<=1000);
}
