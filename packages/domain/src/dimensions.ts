import type { Layer, Point } from './document';
import { worldPoint } from './curves';
import { fromPixels, isUnit, Unit } from './measurements';
import { defaultLineEnds, LineEnd } from './line-endings';
export interface DimensionFormat { scale:number; unit:Unit; decimals:number; separator:'.'|',' }
export interface Dimension { kind:'linear'|'angular'; anchors:Point[]; labelPosition:Point; labelSize?:{width:number;height:number}; text:string; format:DimensionFormat; extension:{stroke:string;strokeWidth:number;gap:number;overshoot:number} }
export const defaultDimensionFormat:DimensionFormat={scale:1,unit:'mm',decimals:2,separator:'.'};
export interface DimensionGeometry { anchors:Point[];labelPosition:Point;text:string;value:number;lines:{a:Point;b:Point;extension:boolean}[];arc?:{center:Point;radius:number;startAngle:number;endAngle:number};ends:{point:Point;direction:Point;style:LineEnd}[] }
export function dimensionGeometry(layer:Layer):DimensionGeometry {
 const d=layer.dimension!;const a=d.anchors.map(p=>worldPoint(layer,p)),label=worldPoint(layer,d.labelPosition);const lines:DimensionGeometry['lines']=[];const ends:DimensionGeometry['ends']=[];let value=0,arc:DimensionGeometry['arc'];
 const styles=layer.lineEnds??{...defaultLineEnds,start:{kind:'triangle' as const,placement:'tip' as const,size:10},end:{kind:'triangle' as const,placement:'tip' as const,size:10}};
 const extend=(p:Point,q:Point)=>{const length=Math.hypot(q.x-p.x,q.y-p.y);if(length<1e-9)return;const u={x:(q.x-p.x)/length,y:(q.y-p.y)/length};lines.push({a:{x:p.x+u.x*d.extension.gap,y:p.y+u.y*d.extension.gap},b:{x:q.x+u.x*d.extension.overshoot,y:q.y+u.y*d.extension.overshoot},extension:true});};
 if(d.kind==='linear'){
 const dx=a[1].x-a[0].x,dy=a[1].y-a[0].y,length=Math.hypot(dx,dy),u={x:dx/(length||1),y:dy/(length||1)},n={x:-u.y,y:u.x};const offset=(label.x-a[0].x)*n.x+(label.y-a[0].y)*n.y;const p=a.map(v=>({x:v.x+n.x*offset,y:v.y+n.y*offset}));extend(a[0],p[0]);extend(a[1],p[1]);lines.push({a:p[0],b:p[1],extension:false});ends.push({point:p[0],direction:{x:-u.x,y:-u.y},style:styles.start},{point:p[1],direction:u,style:styles.end});value=fromPixels(length*d.format.scale,d.format.unit);
 }else{
 const center=a[1],start=Math.atan2(a[0].y-center.y,a[0].x-center.x);let delta=(Math.atan2(a[2].y-center.y,a[2].x-center.x)-start+Math.PI*2)%(Math.PI*2);if(delta>Math.PI)delta-=Math.PI*2;
 const radius=Math.max(1,Math.hypot(label.x-center.x,label.y-center.y));const p=(angle:number)=>({x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius});const end=start+delta;arc={center,radius,startAngle:start,endAngle:end};extend(a[0],p(start));extend(a[2],p(end));const sign=Math.sign(delta)||1;ends.push({point:p(start),direction:{x:Math.sin(start)*sign,y:-Math.cos(start)*sign},style:styles.start},{point:p(end),direction:{x:-Math.sin(end)*sign,y:Math.cos(end)*sign},style:styles.end});value=Math.abs(delta)*180/Math.PI*d.format.scale;
 }
 const text=d.text||`${value.toFixed(d.format.decimals).replace('.',d.format.separator)}${d.kind==='angular'?'°':` ${d.format.unit}`}`;return {anchors:a,labelPosition:label,text,value,lines,arc,ends};
}
export function validDimension(value:unknown):boolean {
 const d=value as Dimension;const point=(p:Point)=>!!p&&Object.keys(p).length===2&&[p.x,p.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7);
 if(!d||typeof d!=='object'||Object.keys(d).length!==(d.labelSize === undefined ? 6 : 7)||!['linear','angular'].includes(d.kind)||!Array.isArray(d.anchors)||d.anchors.length!==(d.kind==='linear'?2:3)||!d.anchors.every(point)||!point(d.labelPosition)||typeof d.text!=='string'||d.text.length>10000)return false;
 if(d.labelSize!==undefined && (!d.labelSize || Object.keys(d.labelSize).length!==2 || ![d.labelSize.width,d.labelSize.height].every(n=>Number.isFinite(n)&&n>=1&&n<=1e6)))return false;
 const f=d.format,e=d.extension;return !!f&&Object.keys(f).length===4&&Number.isFinite(f.scale)&&f.scale>0&&f.scale<=1e6&&isUnit(f.unit)&&Number.isInteger(f.decimals)&&f.decimals>=0&&f.decimals<=8&&['.',','].includes(f.separator)&&!!e&&Object.keys(e).length===4&&typeof e.stroke==='string'&&/^(none|#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?)$/.test(e.stroke)&&[e.strokeWidth,e.gap,e.overshoot].every(n=>Number.isFinite(n)&&n>=0&&n<=1000);
}
