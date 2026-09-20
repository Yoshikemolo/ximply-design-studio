import { describe,expect,it } from 'vitest';
import { blankDocument,Layer,newLayer,parseDocument } from '../src/document';
import { cubic,worldPoint } from '../src/curves';
import { defaultProcedural,generateProcedural,materializeProcedural,syncProcedurals,validProcedural } from '../src/procedural';
const make=(type:'wall'|'door'|'window'|'pillar'):Layer=>({...newLayer('path',type,{x:20,y:40}),width:200,height:100,procedural:defaultProcedural(type)});
describe('procedural parameter contracts and regeneration',()=>{
 it('joins collinear end faces and continues a wall component across opening layers',()=>{
  const first=generateProcedural(make('wall'));const second={...first,id:'wall2',x:first.x+200};
  const joined=materializeProcedural({...blankDocument(),layers:[first,second]});expect(joined.layers).toHaveLength(1);expect(joined.layers[0].curves![0].nodes).toHaveLength(4);
  const door=generateProcedural(make('door'));const crossed={...first,id:'crossed',x:first.x+80,rotation:90};const source={...blankDocument(),layers:[first,door,crossed]};const rendered=materializeProcedural(source);expect(rendered.layers.map(l=>l.id)).toEqual(['wall','door']);expect(source.layers).toHaveLength(3);
 });
 it('keeps physical perpendicular wall thickness and portal cuts under shear and rotation',()=>{
  const wall=generateProcedural({...make('wall'),rotation:31,skewX:38,procedural:{type:'wall',start:{x:10,y:0},end:{x:10,y:200},thickness:20}});
  if(wall.procedural?.type!=='wall')throw Error('wall');const a=worldPoint(wall,wall.procedural.start),b=worldPoint(wall,wall.procedural.end),length=Math.hypot(b.x-a.x,b.y-a.y),normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};
  for(const node of wall.curves![0].nodes){const q=worldPoint(wall,node.point);expect(Math.abs((q.x-a.x)*normal.x+(q.y-a.y)*normal.y)).toBeCloseTo(10,8);}
  const opening=make('door');if(opening.procedural?.type!=='door')throw Error('door');opening.procedural={...opening.procedural,width:40,leafWidths:[40],host:{wallId:wall.id,offset:.5}};
  const doc=syncProcedurals({...blankDocument(),layers:[wall,opening]});const rendered=materializeProcedural(doc).layers[0];const area=Math.abs(rendered.curves!.reduce((sum,path)=>sum+path.nodes.reduce((s,n,i)=>{const p=n.point,q=path.nodes[(i+1)%path.nodes.length].point;return s+p.x*q.y-p.y*q.x;},0)/2,0));expect(area).toBeCloseTo(length*20-40*20,6);
 });
 it('supports every registry entry and rejects coercible enum objects and inconsistent leaves',()=>{for(const type of ['wall','door','window','pillar'] as const){expect(validProcedural(defaultProcedural(type))).toBe(true);expect(generateProcedural(make(type)).curves!.length).toBeGreaterThan(0);}const door=defaultProcedural('door');expect(validProcedural({...door,swing:['left']})).toBe(false);expect(validProcedural({...door,leafWidths:[10,20]})).toBe(false);expect(validProcedural({...defaultProcedural('pillar'),shape:['circle']})).toBe(false);});
 it('keeps wall centerline fixed when changing thickness and remains idempotent with shear and rotation',()=>{const source={...make('wall'),rotation:23,skewX:19};const initial=generateProcedural(source);if(initial.procedural?.type!=='wall')throw Error('wall');const a=worldPoint(initial,initial.procedural.start),b=worldPoint(initial,initial.procedural.end);const updated=generateProcedural({...initial,procedural:{...initial.procedural,thickness:42}});if(updated.procedural?.type!=='wall')throw Error('wall');expect(worldPoint(updated,updated.procedural.start).x).toBeCloseTo(a.x);expect(worldPoint(updated,updated.procedural.end).y).toBeCloseTo(b.y);const next=generateProcedural(updated);expect(next.x).toBeCloseTo(updated.x);expect(next.y).toBeCloseTo(updated.y);expect(next.procedural).toEqual(updated.procedural);});
 it('uses cubic circular swing arcs with the correct radius and preserves a free portal when angle changes',()=>{const initial=generateProcedural(make('door'));const arc=initial.curves!.find(p=>p.nodes.length===2&&(p.nodes[0].outgoing.x!==p.nodes[0].point.x||p.nodes[0].outgoing.y!==p.nodes[0].point.y))!;expect(arc).toBeDefined();const jambs=initial.curves!.slice(0,2).flatMap(p=>p.nodes.map(n=>worldPoint(initial,n.point)));const center={x:jambs.reduce((sum,p)=>sum+p.x,0)/4,y:jambs.reduce((sum,p)=>sum+p.y,0)/4};if(initial.procedural?.type!=='door')throw Error('door');const updated=generateProcedural({...initial,procedural:{...initial.procedural,openingAngle:45}});const points=updated.curves!.slice(0,2).flatMap(p=>p.nodes.map(n=>worldPoint(updated,n.point)));expect(points.reduce((s,p)=>s+p.x,0)/4).toBeCloseTo(center.x);expect(points.reduce((s,p)=>s+p.y,0)/4).toBeCloseTo(center.y);const n=arc.nodes;const midpoint=cubic(n[0].point,n[0].outgoing,n[1].incoming,n[1].point,.5);const hinge=initial.curves![2].nodes[0].point;expect(Math.hypot(midpoint.x-hinge.x,midpoint.y-hinge.y)).toBeCloseTo(80,1);});
 it('roundtrips regenerated geometry and rejects old versions, dangling hosts and oversized generated bounds',()=>{const document=syncProcedurals({...blankDocument(),layers:[make('wall')]});expect(parseDocument(JSON.stringify(document))).toEqual(document);expect(()=>parseDocument(JSON.stringify({...document,version:1}))).toThrow();const door=make('door');if(door.procedural?.type!=='door')throw Error('door');door.procedural.host={wallId:'missing',offset:.5};expect(()=>parseDocument(JSON.stringify({...blankDocument(),layers:[door]}))).toThrow();const oversized=make('wall');oversized.procedural={type:'wall',start:{x:0,y:0},end:{x:11000,y:11000},thickness:16000};expect(()=>parseDocument(JSON.stringify({...blankDocument(),layers:[oversized]}))).toThrow(/bounds/);});
});

describe('materialized wall outlines',()=>{
 const wall=(id:string,start:{x:number;y:number},end:{x:number;y:number}):Layer=>generateProcedural({...newLayer('path',id,{x:0,y:0},'#333333','#111111',1),width:1,height:1,procedural:{type:'wall',start,end,thickness:20}});
 const ring=(layer:Layer)=>layer.curves![0].nodes.map(n=>({x:Math.round(n.point.x*100)/100,y:Math.round(n.point.y*100)/100}));
 it('keeps all four corners of a single wall instead of collapsing its start edge',()=>{
  const doc={...blankDocument(),layers:[wall('w',{x:100,y:100},{x:300,y:100})]};
  const drawn=materializeProcedural(doc).layers[0];
  expect(drawn.curves).toHaveLength(1);
  const corners=ring(drawn);
  expect(corners).toHaveLength(4);
  // A 200 by 20 wall centred on its axis spans both faces at both ends.
  expect(new Set(corners.map(p=>`${p.x},${p.y}`))).toEqual(new Set(['100,90','300,90','300,110','100,110']));
 });
 it('keeps both free ends of a connected run',()=>{
  const doc={...blankDocument(),layers:[wall('a',{x:100,y:100},{x:300,y:100}),wall('b',{x:300,y:100},{x:300,y:260})]};
  const drawn=materializeProcedural(doc).layers.filter(l=>l.curves?.length);
  const points=drawn.flatMap(l=>ring(l));
  expect(points.filter(p=>p.x===100)).toHaveLength(2);
  expect(points.filter(p=>p.y===260)).toHaveLength(2);
 });
});
