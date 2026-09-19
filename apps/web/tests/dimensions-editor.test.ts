// @vitest-environment happy-dom
import '@angular/compiler';
import {beforeEach,describe,it,expect} from 'vitest';
import {EditorService} from '../src/app/editor.service';
import {newLayer,parseDocument} from '../../../packages/domain/src/document';
import {dimensionGeometry} from '../../../packages/domain/src/dimensions';
import {snapDimensionPoint} from '../src/app/dimension-snapping';
beforeEach(()=>localStorage.clear());
const a={x:100,y:100},b={x:250,y:100},label={x:175,y:60};
describe('dimension editing',()=>{
 it('places two anchors then the offset and records one undoable object',()=>{
  const e=new EditorService();e.setTool('dimensionSmart');e.start(a);e.end();e.start(b);e.end();expect(e.document().layers).toHaveLength(0);e.move(label);e.start(label);e.end();
  expect(e.selected()?.dimension?.anchors).toHaveLength(2);expect(e.dimensionDraft()).toBeNull();expect(parseDocument(JSON.stringify(e.document())).layers).toHaveLength(1);e.undo();expect(e.document().layers).toHaveLength(0);
 });
 it('angular placement uses the middle point as vertex and cancellation creates nothing',()=>{
  const e=new EditorService();e.setTool('dimensionAngular');for(const p of [a,b,{x:250,y:250},{x:190,y:160}]){e.start(p);e.end();}expect(dimensionGeometry(e.selected()!).value).toBeCloseTo(90);
  e.start(a);e.cancel();expect(e.dimensionDraft()).toBeNull();expect(e.document().layers).toHaveLength(1);
 });
 it('moves a label independently and rolls the complete gesture back with Escape',()=>{
  const e=new EditorService();e.createDimension('linear',[a,b],label);const before=structuredClone(e.selected());e.start(label);e.move({x:190,y:40});expect(dimensionGeometry(e.selected()!).labelPosition).toEqual({x:175,y:40});expect(e.selected()?.dimension?.anchors).toEqual(before?.dimension?.anchors);e.cancel();expect(e.selected()).toEqual(before);
  e.start(label);e.move({x:190,y:40});e.end();e.undo();expect(e.selected()?.dimension).toEqual(before?.dimension);
 });
 it('inherits measurement format while keeping each existing annotation independent',()=>{
  const e=new EditorService();e.createDimension('linear',[a,b],label);e.updateDimension({format:{scale:2,unit:'in',decimals:3,separator:','},text:'Custom'});const first=e.selected()!;e.createDimension('linear',[a,b],label);expect(e.selected()?.dimension?.format).toEqual(first.dimension?.format);expect(e.selected()?.dimension?.text).toBe('');e.updateDimension({format:{scale:0,unit:'in',decimals:3,separator:','}});expect(e.selected()?.dimension?.format.scale).toBe(2);
 });
 it('hidden dimensions do not intercept artwork selection or its context menu',()=>{
  const e=new EditorService();e.document.update(d=>({...d,layers:[{...newLayer('rectangle','art',{x:90,y:40}),width:180,height:90}]}));e.createDimension('linear',[a,b],label);e.dimensionsVisible.set(false);e.selectedId.set(null);e.selectedIds.set([]);e.start(label);e.end();expect(e.selected()?.id).toBe('art');expect(e.contextAt(label)?.layerId).toBe('art');
 });
 it('global locking protects dimensions while allowing new dimensions',()=>{
  const e=new EditorService();e.createDimension('linear',[a,b],label);e.setDimensionsLocked(true);e.updateDimension({text:'blocked'});expect(e.selected()?.dimension?.text).toBe('');expect(e.createDimension('linear',[a,b],label)).toBe(true);
 });
 it('resizes dimension geometry without resizing its label or markers and prevents unsupported conversion',()=>{
  const e=new EditorService();e.createDimension('linear',[a,b],label);const original=structuredClone(e.selected()!);e.transformBy(0,2);expect(dimensionGeometry(e.selected()!).value).toBeCloseTo(dimensionGeometry(original).value*2);expect(e.selected()?.fontSize).toBe(original.fontSize);expect(e.selected()?.lineEnds).toEqual(original.lineEnds);expect(e.selected()?.dimension?.labelSize).toEqual({width:160,height:40});
  const before=structuredClone(e.document());e.defineSymbol();e.pathAction('smooth');expect(e.document()).toEqual(before);expect(e.canCreateBlend()).toBe(false);
 });
 it('establishes an independent label frame when enabling layout on older annotations',()=>{
  const e=new EditorService();e.createDimension('linear',[a,b],label);e.document.update(d=>({...d,layers:d.layers.map(l=>({...l,dimension:{...l.dimension!,labelSize:undefined}}))}));e.updateTextLayout({fit:true});expect(e.selected()?.dimension?.labelSize).toEqual({width:160,height:40});
 });
 it('keeps marker endpoints linked and validates sizes',()=>{
  const e=new EditorService();e.setLineEnds({start:{kind:'dot',placement:'base',size:8}});expect(e.lineEnds().end).toEqual(e.lineEnds().start);e.setLineEnds({linked:false,end:{kind:'slash',placement:'tip',size:6}});expect(e.lineEnds().start.kind).toBe('dot');e.setLineEnds({end:{kind:'slash',placement:'tip',size:-1}});expect(e.lineEnds().end.size).toBe(6);
 });
});
describe('singular dimension snapping',()=>{
 const line=(id:string,points:{x:number;y:number}[])=>({...newLayer('path',id,{x:0,y:0}),width:200,height:200,points});
 it('snaps vertices, midpoints, line projections and final intersections',()=>{
  const horizontal=line('h',[{x:0,y:50},{x:200,y:50}]),vertical=line('v',[{x:60,y:0},{x:60,y:200}]);
  expect(snapDimensionPoint([horizontal],{x:2,y:51},5)?.kind).toBe('vertex');expect(snapDimensionPoint([horizontal],{x:102,y:51},5)?.kind).toBe('midpoint');expect(snapDimensionPoint([horizontal],{x:30,y:52},5)?.kind).toBe('line');expect(snapDimensionPoint([horizontal,vertical],{x:61,y:51},5,true)).toEqual({point:{x:60,y:50},kind:'intersection'});
 });
 it('does not snap hidden artwork or guides',()=>{expect(snapDimensionPoint([{...line('h',[a,b]),visible:false},{...line('g',[a,b]),guide:'vertical'}],a,10)).toBeNull();});
});
