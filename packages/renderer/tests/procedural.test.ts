import { createCanvas,loadImage } from '@napi-rs/canvas';
import { describe,it,expect } from 'vitest';
import { blankDocument,newLayer,svgExport,Layer } from '../../domain/src/document';
import { defaultProcedural,syncProcedurals } from '../../domain/src/procedural';
import { CanvasRenderer } from '../src/canvas-renderer';
describe('procedural Canvas/SVG shared boundary rendering',()=>{
 it('renders a real hosted opening with no opaque fill and no crossing-wall internal seam',async()=>{
  const wall:Layer={...newLayer('path','wall',{x:20,y:40},'#808080','#000000',2),width:200,height:20,procedural:{type:'wall',start:{x:0,y:10},end:{x:200,y:10},thickness:20}};
  const cross:Layer={...wall,id:'cross',x:170,y:10,width:20,height:100,procedural:{type:'wall',start:{x:10,y:0},end:{x:10,y:100},thickness:20}};
  const p=defaultProcedural('door');if(p.type!=='door')throw Error('door');
  const opening:Layer={...newLayer('path','door',{x:0,y:0},'none','#000000',1),procedural:{...p,width:40,leafWidths:[40],host:{wallId:'wall',offset:.3}}};
  const doc=syncProcedurals({...blankDocument(),width:250,height:140,layers:[wall,cross,opening]});const canvas=createCanvas(250,140),svg=createCanvas(250,140);new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement,doc,null,()=>{});svg.getContext('2d').drawImage(await loadImage(Buffer.from(svgExport(doc))),0,0);
  for(const ctx of [canvas.getContext('2d'),svg.getContext('2d')]){expect([...ctx.getImageData(80,55,1,1).data]).toEqual([255,255,255,255]);expect([...ctx.getImageData(180,50,1,1).data]).toEqual([128,128,128,255]);expect([...ctx.getImageData(171,50,1,1).data]).toEqual([128,128,128,255]);}
 });
});
