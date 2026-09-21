import { createCanvas,loadImage } from '@napi-rs/canvas';
import { describe,it,expect } from 'vitest';
import { blankDocument,newLayer,svgExport,Layer } from '../../domain/src/document';
import { defaultDimensionFormat } from '../../domain/src/dimensions';
import { CanvasRenderer } from '../src/canvas-renderer';
function fixture():Layer{return {...newLayer('path','d',{x:20,y:20},'none','#ff0000',2),width:96,height:40,fontSize:12,dimension:{kind:'linear',anchors:[{x:0,y:0},{x:96,y:0}],labelPosition:{x:48,y:30},text:'',format:{...defaultDimensionFormat,unit:'in'},extension:{stroke:'#0000ff',strokeWidth:2,gap:2,overshoot:4}}};}
async function images(l:Layer){const doc={...blankDocument(),width:160,height:100,background:'#ffffff',layers:[l]};const canvas=createCanvas(160,100);new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement,doc,null,()=>{});const svg=createCanvas(160,100);svg.getContext('2d').drawImage(await loadImage(Buffer.from(svgExport(doc))),0,0);return [canvas.getContext('2d'),svg.getContext('2d')];}
describe('dimension Canvas and SVG geometry',()=>{
 it('composites dimension opacity consistently at intersecting components',async()=>{const l={...fixture(),opacity:0.5,lineEnds:{linked:true,start:{kind:'none' as const,placement:'tip' as const,size:10},end:{kind:'none' as const,placement:'tip' as const,size:10}}};const [canvas,svg]=await images(l);const a=canvas.getImageData(20,50,1,1).data,b=svg.getImageData(20,50,1,1).data;for(let i=0;i<4;i++)expect(Math.abs(a[i]-b[i])).toBeLessThanOrEqual(1);});
 it('renders independent extension and dimension colors at matching world coordinates',async()=>{for(const ctx of await images(fixture())){expect([...ctx.getImageData(20,30,1,1).data]).toEqual([0,0,255,255]);expect([...ctx.getImageData(36,50,1,1).data]).toEqual([255,0,0,255]);expect([...ctx.getImageData(60,30,1,1).data]).toEqual([255,255,255,255]);}});
 it('draws independent dot and cross endpoint markers in both outputs',async()=>{const l={...fixture(),dimension:undefined,points:[{x:0,y:20},{x:96,y:20}],lineEnds:{linked:false,start:{kind:'dot' as const,placement:'tip' as const,size:12},end:{kind:'cross' as const,placement:'base' as const,size:12}}};for(const ctx of await images(l)){expect(ctx.getImageData(26,43,1,1).data[1]).toBe(0);expect(ctx.getImageData(122,40,1,1).data[1]).toBeLessThan(255);}});
});
