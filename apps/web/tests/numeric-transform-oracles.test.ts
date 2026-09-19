// @vitest-environment happy-dom
import '@angular/compiler';
import {beforeEach,describe,it,expect} from 'vitest';
import {EditorService} from '../src/app/editor.service';
import {Layer,Point,newLayer} from '../../../packages/domain/src/document';
import {anchor} from '../../../packages/domain/src/curves';
import {dimensionGeometry} from '../../../packages/domain/src/dimensions';
// Independent matrix oracle: reflect, shear, rotate, translate about the layer center.
const world=(l:Layer,p:Point):Point=>{const u=(l.flipX?-1:1)*(p.x-l.width/2),v=(l.flipY?-1:1)*(p.y-l.height/2),h=u+Math.tan((l.skewX??0)*Math.PI/180)*v,t=l.rotation*Math.PI/180;return {x:l.x+l.width/2+Math.cos(t)*h-Math.sin(t)*v,y:l.y+l.height/2+Math.sin(t)*h+Math.cos(t)*v};};
const rotate=(p:Point,pivot:Point,degrees:number):Point=>{const t=degrees*Math.PI/180,x=p.x-pivot.x,y=p.y-pivot.y;return {x:pivot.x+Math.cos(t)*x-Math.sin(t)*y,y:pivot.y+Math.sin(t)*x+Math.cos(t)*y};};
const close=(actual:Point,expected:Point)=>{expect(actual.x).toBeCloseTo(expected.x,8);expect(actual.y).toBeCloseTo(expected.y,8);};
beforeEach(()=>localStorage.clear());
describe('independent numeric transformation oracles',()=>{
 it('rotates all group geometry about an external pivot even with child shear and reflection',()=>{
  const e=new EditorService();const layers=[{...newLayer('rectangle','a',{x:10,y:20}),width:150,height:75,rotation:37,skewX:23,flipX:true,groupPath:['g']},{...newLayer('rectangle','b',{x:200,y:-70}),width:60,height:95,rotation:-29,skewX:-17,flipY:true,groupPath:['g']}];e.document.update(d=>({...d,layers}));e.selectLayer('a');const pivot={x:-63,y:51},angle=71;
  expect(e.rotateSelection(angle,pivot)).toBe(true);e.document().layers.forEach((next,i)=>{for(const p of [{x:0,y:0},{x:layers[i].width,y:layers[i].height},{x:35,y:12}])close(world(next,p),rotate(world(layers[i],p),pivot,angle));});
 });
 it('rotates selected Bezier anchor and both handles in world coordinates while preserving every unselected control',()=>{
  const e=new EditorService();const layer:Layer={...newLayer('path','a',{x:45,y:-30}),width:130,height:95,rotation:41,skewX:28,flipX:true,curves:[{closed:false,nodes:[{...anchor({x:20,y:15}),incoming:{x:0,y:9},outgoing:{x:60,y:32}},{...anchor({x:110,y:80}),incoming:{x:70,y:90},outgoing:{x:120,y:85}}]}]};e.document.update(d=>({...d,layers:[layer]}));e.selectLayer('a');e.activeNodes.set(['0:0']);const pivot={x:34,y:17};expect(e.rotateSelection(-53,pivot)).toBe(true);const next=e.selected()!;
  for(const part of ['point','incoming','outgoing'] as const){close(world(next,next.curves![0].nodes[0][part]),rotate(world(layer,layer.curves![0].nodes[0][part]),pivot,-53));close(world(next,next.curves![0].nodes[1][part]),world(layer,layer.curves![0].nodes[1][part]));}
 });
 it('keeps independent label frame and markers unchanged when scaling dimension anchors',()=>{
  const e=new EditorService();e.createDimension('linear',[{x:10,y:30},{x:110,y:30}],{x:60,y:5});e.updateDimension({labelSize:{width:80,height:22}});const before=structuredClone(e.selected()!),geometry=dimensionGeometry(before);e.transformBy(0,3);const after=e.selected()!;expect(dimensionGeometry(after).value).toBeCloseTo(geometry.value*3);expect(after.dimension!.labelSize).toEqual({width:80,height:22});expect(after.fontSize).toBe(before.fontSize);expect(after.lineEnds).toEqual(before.lineEnds);
 });
});
