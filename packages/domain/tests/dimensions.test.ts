import { describe,it,expect } from 'vitest';
import { blankDocument,newLayer,parseDocument,resizeLayer,svgExport,hitTest,Layer } from '../src/document';
import { defaultDimensionFormat,dimensionGeometry,validDimension } from '../src/dimensions';
import { lineEndGeometry,validLineEnds } from '../src/line-endings';
import { readableAngle,DIMENSION_ARROW_SPREAD } from '../src/dimensions';
function fixture():Layer{return {...newLayer('path','dimension',{x:10,y:20},'#112233','#112233',1),width:96,height:40,fontSize:12,dimension:{kind:'linear',anchors:[{x:0,y:0},{x:96,y:0}],labelPosition:{x:48,y:30},text:'',format:{...defaultDimensionFormat,unit:'in'},extension:{stroke:'#112233',strokeWidth:1,gap:2,overshoot:4}}};}
describe('dimension geometry and contracts',()=>{
 it('measures world geometry and formats physical units independently of display zoom',()=>{const l=fixture(),g=dimensionGeometry(l);expect(g.value).toBe(1);expect(g.text).toBe('1.00 in');const dimensionLines=g.lines.filter(line=>!line.extension);expect(dimensionLines[0].a).toEqual({x:10,y:50});expect(dimensionLines.at(-1)!.b).toEqual({x:106,y:50});expect(dimensionGeometry(resizeLayer(l,192,80)).text).toBe('2.00 in');expect(dimensionGeometry({...l,rotation:90}).value).toBeCloseTo(1);});
 it('measures signed-side angular arcs without stretching text or marker sizes',()=>{const l=fixture();l.dimension!.kind='angular';l.dimension!.anchors=[{x:50,y:0},{x:0,y:0},{x:0,y:50}];const g=dimensionGeometry(l);expect(g.text).toBe('90.00°');expect(g.arc!.endAngle-g.arc!.startAngle).toBeCloseTo(Math.PI/2);const resized=resizeLayer(l,192,80);expect(resized.fontSize).toBe(12);expect(dimensionGeometry(resized).ends[0].style.size).toBe(10);});
 it('roundtrips metadata and rejects invalid bounded nested contracts and old versions',()=>{const l=fixture(),doc={...blankDocument(),layers:[l]};expect(parseDocument(JSON.stringify(doc))).toEqual(doc);expect(()=>parseDocument(JSON.stringify({...doc,version:1}))).toThrow();for(const decimals of [-1,9,0.5,Infinity])expect(validDimension({...l.dimension,format:{...l.dimension!.format,decimals}})).toBe(false);expect(validLineEnds({linked:true,start:{kind:'cross',placement:'tip',size:10},end:{kind:'dot',placement:'base',size:0}})).toBe(false);});
 it('supports label override escaping and world-space label hit testing',()=>{const l=fixture();l.dimension!.text='<custom>';const svg=svgExport({...blankDocument(),layers:[l]});expect(svg).toContain('&lt;');expect(svg).not.toContain('<custom>');expect(hitTest(l,{x:58,y:50})).toBe(true);expect(hitTest(l,{x:58,y:150})).toBe(false);});
 it('places tip at endpoint or extends outward from the base',()=>{const p={x:10,y:0},u={x:1,y:0};const tip=lineEndGeometry(p,u,{kind:'triangle',placement:'tip',size:10});expect(tip.points[1]).toEqual(p);const base=lineEndGeometry(p,u,{kind:'triangle',placement:'base',size:10});expect(base.points[1]).toEqual({x:20,y:0});expect(base.points[0].x).toBe(10);});
});
describe('professional linear dimension presentation',()=>{
 const measure=(text:string,size:number)=>text.length*size*0.5;
 const layer=(b:{x:number;y:number},placement:{x:number;y:number}):Layer=>({...newLayer('path','d',{x:0,y:0},'#000000','#000000',1),width:400,height:400,fontSize:10,dimension:{kind:'linear',anchors:[{x:100,y:100},b],labelPosition:placement,text:'',format:{...defaultDimensionFormat,unit:'px',decimals:0},extension:{stroke:'#000000',strokeWidth:1,gap:3,overshoot:5}}});
 it('breaks the dimension line around a centered label when label, arrows and clearances fit',()=>{
  // "200 px" is 6 glyphs: 30 wide at the 0.5 em test metric; 30 + 4 x 10 <= 200 so it fits inside.
  const g=dimensionGeometry(layer({x:300,y:100},{x:120,y:60}),measure),dims=g.lines.filter(l=>!l.extension);
  expect(g.placement).toBe('inside');expect(g.labelPosition).toEqual({x:200,y:60});expect(g.labelAngle).toBe(0);
  expect(dims).toHaveLength(2);expect(dims[0]).toEqual({a:{x:100,y:60},b:{x:180,y:60},extension:false});expect(dims[1]).toEqual({a:{x:220,y:60},b:{x:300,y:60},extension:false});
  expect(g.ends.map(e=>e.point)).toEqual([{x:100,y:60},{x:300,y:60}]);expect(g.ends.map(e=>e.direction.x)).toEqual([-1,1]);
 });
 it('starts extension lines a gap from the measured points and overshoots the dimension line',()=>{
  const ext=dimensionGeometry(layer({x:300,y:100},{x:120,y:60}),measure).lines.filter(l=>l.extension);
  expect(ext).toEqual([{a:{x:100,y:97},b:{x:100,y:55},extension:true},{a:{x:300,y:97},b:{x:300,y:55},extension:true}]);
 });
 it('moves arrows outside and the label beyond the nearest end when the span is too small',()=>{
  // "40 px" is 5 glyphs, 25 wide; 25 + 4 x 10 = 65 > 40, so the label cannot sit between the extension lines.
  // Outside: arrow + one arrowhead of clear line (20), half-arrow clearance (5), then half the label (12.5).
  const near=dimensionGeometry(layer({x:140,y:100},{x:150,y:60}),measure),far=dimensionGeometry(layer({x:140,y:100},{x:90,y:60}),measure);
  expect(near.placement).toBe('outside');
  expect(near.lines.filter(l=>!l.extension)).toEqual([{a:{x:80,y:60},b:{x:160,y:60},extension:false}]);
  expect(near.ends.map(e=>e.direction.x)).toEqual([1,-1]);
  expect(near.labelPosition).toEqual({x:140+20+5+12.5,y:60});expect(far.labelPosition).toEqual({x:100-20-5-12.5,y:60});
 });
 it('keeps labels readable and aligned with the dimension line in every direction',()=>{
  expect(dimensionGeometry(layer({x:-100,y:100},{x:0,y:60}),measure).labelAngle).toBeCloseTo(0);
  expect(dimensionGeometry(layer({x:100,y:300},{x:60,y:200}),measure).labelAngle).toBeCloseTo(Math.PI/2);
  expect(dimensionGeometry(layer({x:100,y:-100},{x:60,y:0}),measure).labelAngle).toBeCloseTo(Math.PI/2);
  for(const angle of [0,1,2,3,4,5,6])expect(Math.cos(readableAngle(angle))).toBeGreaterThanOrEqual(-1e-9);
 });
 it('draws drafting arrowheads three times longer than their width',()=>{
  const head=lineEndGeometry({x:0,y:0},{x:1,y:0},{kind:'triangle',placement:'tip',size:12},DIMENSION_ARROW_SPREAD).points;
  expect(Math.abs(head[0].x-head[1].x)/Math.abs(head[0].y-head[2].y)).toBeCloseTo(3);
 });
});
