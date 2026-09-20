import type { Layer, Point } from './document';
import { worldPoint } from './curves';
import { fromPixels, isUnit, Unit } from './measurements';
import { defaultLineEnds, LineEnd } from './line-endings';
import { layoutText, TextLayoutResult, TextMeasurement } from './text-layout';
export interface DimensionFormat { scale:number; unit:Unit; decimals:number; separator:'.'|',' }
/** Where the label sits along the dimension line; the default keeps it centred. */
export type DimensionLabelPlacement = 'start'|'center'|'end';
export interface Dimension { kind:'linear'|'angular'|'radius'|'diameter'; anchors:Point[]; labelPosition:Point; labelSize?:{width:number;height:number}; labelPlacement?:DimensionLabelPlacement; centerMark?:boolean; text:string; format:DimensionFormat; extension:{stroke:string;strokeWidth:number;gap:number;overshoot:number} }
export const defaultDimensionFormat:DimensionFormat={scale:1,unit:'mm',decimals:2,separator:'.'};
/** How a linear annotation fits: the label inside a break of the dimension line, or beside an outer end. */
export type DimensionPlacement = 'inside'|'outside'|'angular';
/** Radial annotations carry their symbol before the value, as drawing standards require. */
export const RADIUS_SYMBOL = 'R';
export const DIAMETER_SYMBOL = '\u2300';
export interface DimensionEnd { point:Point;direction:Point;style:LineEnd;spread?:number }
export interface DimensionGeometry { anchors:Point[];labelPosition:Point;labelAngle:number;labelWidth:number;labelHeight:number;placement:DimensionPlacement;text:string;value:number;lines:{a:Point;b:Point;extension:boolean}[];arc?:{center:Point;radius:number;startAngle:number;endAngle:number};ends:DimensionEnd[] }
/** Drafting arrowheads are three times longer than their full width (ISO 129-1, ASME Y14.2). */
export const DIMENSION_ARROW_SPREAD=1/6;
/** Reading angle in (-90, 90] degrees so the label is never upside down. */
export function readableAngle(angle:number):number { let a=Math.atan2(Math.sin(angle),Math.cos(angle));if(a>Math.PI/2+1e-9)a-=Math.PI;else if(a<=-Math.PI/2+1e-9)a+=Math.PI;return a; }
export function dimensionLabelLayout(layer:Layer,text:string,measure?:TextMeasurement):TextLayoutResult {
 return layoutText({...layer,...layer.dimension!.labelSize,text,textLayout:layer.textLayout??{sizing:'content',wrap:false,hyphenate:false,fit:false}},measure);
}
/** Linear rules: extension lines start a small gap away from the measured points and overshoot the dimension line;
 * the label interrupts the middle of the dimension line when label + two arrowheads + one arrowhead of clearance on
 * each side fit between the extension lines; otherwise arrowheads point inward from outside and the label sits beyond
 * the end nearest the placement point. */
/** Radius and diameter: one arrow on the arc, or two through the centre, with an optional centre mark. */
function radialGeometry(layer:Layer,d:Dimension,a:Point[],placementPoint:Point,measure?:TextMeasurement):DimensionGeometry {
 const styles=layer.lineEnds??{...defaultLineEnds,start:{kind:'triangle' as const,placement:'tip' as const,size:10},end:{kind:'triangle' as const,placement:'tip' as const,size:10}};
 const lines:DimensionGeometry['lines']=[],ends:DimensionEnd[]=[];
 const center=a[0],edge=a[1],radius=Math.hypot(edge.x-center.x,edge.y-center.y)||1;
 const u={x:(edge.x-center.x)/radius,y:(edge.y-center.y)/radius};
 const diameter=d.kind==='diameter';
 const value=fromPixels(radius*(diameter?2:1)*d.format.scale,d.format.unit);
 const text=d.text||`${diameter?DIAMETER_SYMBOL:RADIUS_SYMBOL}${value.toFixed(d.format.decimals).replace('.',d.format.separator)} ${d.format.unit}`;
 const layout=dimensionLabelLayout(layer,text,measure),width=layout.width;
 const size=Math.max(styles.start.size,styles.end.size),clearance=size/2;
 const from=diameter?{x:center.x-u.x*radius,y:center.y-u.y*radius}:center;
 const span=diameter?radius*2:radius;
 const along=(t:number)=>({x:from.x+u.x*t,y:from.y+u.y*t});
 const placement=d.labelPlacement??'center';
 const fits=span>=width+(diameter?4:2)*size&&placement==='center';
 let label:Point;
 if(fits){
  const middle=span/2;label=along(middle);
  lines.push({a:from,b:along(middle-width/2-clearance),extension:false},{a:along(middle+width/2+clearance),b:along(span),extension:false});
 }else{
  const towardEnd=placement!=='start',tail=2*size;
  lines.push({a:diameter?along(-tail):from,b:along(span+tail),extension:false});
  label=towardEnd?along(span+tail+clearance+width/2):along(-(tail+clearance+width/2));
 }
 if(diameter)ends.push({point:from,direction:{x:-u.x,y:-u.y},style:styles.start,spread:DIMENSION_ARROW_SPREAD});
 ends.push({point:along(span),direction:u,style:styles.end,spread:DIMENSION_ARROW_SPREAD});
 if(d.centerMark){
  const arm=Math.min(size,radius/3);
  lines.push({a:{x:center.x-arm,y:center.y},b:{x:center.x+arm,y:center.y},extension:true},{a:{x:center.x,y:center.y-arm},b:{x:center.x,y:center.y+arm},extension:true});
 }
 return {anchors:a,labelPosition:label,labelAngle:readableAngle(Math.atan2(u.y,u.x)),labelWidth:layout.width,labelHeight:layout.height,placement:fits?'inside':'outside',text,value,lines,ends};
}
export function dimensionGeometry(layer:Layer,measure?:TextMeasurement):DimensionGeometry {
 const d=layer.dimension!;const a=d.anchors.map(p=>worldPoint(layer,p)),placementPoint=worldPoint(layer,d.labelPosition);const lines:DimensionGeometry['lines']=[];const ends:DimensionEnd[]=[];let value=0,arc:DimensionGeometry['arc'];
 const styles=layer.lineEnds??{...defaultLineEnds,start:{kind:'triangle' as const,placement:'tip' as const,size:10},end:{kind:'triangle' as const,placement:'tip' as const,size:10}};
 const extend=(p:Point,q:Point)=>{const length=Math.hypot(q.x-p.x,q.y-p.y);if(length<1e-9)return;const u={x:(q.x-p.x)/length,y:(q.y-p.y)/length};const from=length>d.extension.gap?{x:p.x+u.x*d.extension.gap,y:p.y+u.y*d.extension.gap}:q;lines.push({a:from,b:{x:q.x+u.x*d.extension.overshoot,y:q.y+u.y*d.extension.overshoot},extension:true});};
 if(d.kind==='radius'||d.kind==='diameter')return radialGeometry(layer,d,a,placementPoint,measure);
 if(d.kind==='linear'){
  const dx=a[1].x-a[0].x,dy=a[1].y-a[0].y,length=Math.hypot(dx,dy),u={x:dx/(length||1),y:dy/(length||1)},n={x:-u.y,y:u.x};
  value=fromPixels(length*d.format.scale,d.format.unit);
  const text=formatDimension(d,value),layout=dimensionLabelLayout(layer,text,measure);
  const offset=(placementPoint.x-a[0].x)*n.x+(placementPoint.y-a[0].y)*n.y;const p=a.map(v=>({x:v.x+n.x*offset,y:v.y+n.y*offset}));extend(a[0],p[0]);extend(a[1],p[1]);
  const size=Math.max(styles.start.size,styles.end.size),clearance=size/2,along=(t:number,from=p[0])=>({x:from.x+u.x*t,y:from.y+u.y*t});
  const width=layout.width,placement=d.labelPlacement??'center',inside=length>=width+4*size&&placement==='center';let label:Point;
  if(inside){
   const middle=length/2;label=along(middle);lines.push({a:p[0],b:along(middle-width/2-clearance),extension:false},{a:along(middle+width/2+clearance),b:p[1],extension:false});
   ends.push({point:p[0],direction:{x:-u.x,y:-u.y},style:styles.start,spread:DIMENSION_ARROW_SPREAD},{point:p[1],direction:u,style:styles.end,spread:DIMENSION_ARROW_SPREAD});
  }else{
   // Each outer arrow needs its own length plus one arrowhead of clear line beyond the extension line.
   const towardEnd=placement==='center'?(placementPoint.x-a[0].x)*u.x+(placementPoint.y-a[0].y)*u.y>length/2:placement==='end',tail=2*size;
   label=along(towardEnd?length+tail+clearance+width/2:-(tail+clearance+width/2));
   lines.push({a:along(-tail),b:along(length+tail),extension:false});
   ends.push({point:p[0],direction:u,style:styles.start,spread:DIMENSION_ARROW_SPREAD},{point:p[1],direction:{x:-u.x,y:-u.y},style:styles.end,spread:DIMENSION_ARROW_SPREAD});
  }
  return {anchors:a,labelPosition:label,labelAngle:readableAngle(Math.atan2(u.y,u.x)),labelWidth:layout.width,labelHeight:layout.height,placement:inside?'inside':'outside',text,value,lines,ends};
 }
 const center=a[1],start=Math.atan2(a[0].y-center.y,a[0].x-center.x);let delta=(Math.atan2(a[2].y-center.y,a[2].x-center.x)-start+Math.PI*2)%(Math.PI*2);if(delta>Math.PI)delta-=Math.PI*2;
 const radius=Math.max(1,Math.hypot(placementPoint.x-center.x,placementPoint.y-center.y));const p=(angle:number)=>({x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius});const end=start+delta;arc={center,radius,startAngle:start,endAngle:end};extend(a[0],p(start));extend(a[2],p(end));const sign=Math.sign(delta)||1;ends.push({point:p(start),direction:{x:Math.sin(start)*sign,y:-Math.cos(start)*sign},style:styles.start,spread:DIMENSION_ARROW_SPREAD},{point:p(end),direction:{x:-Math.sin(end)*sign,y:Math.cos(end)*sign},style:styles.end,spread:DIMENSION_ARROW_SPREAD});value=Math.abs(delta)*180/Math.PI*d.format.scale;
 const text=formatDimension(d,value),layout=dimensionLabelLayout(layer,text,measure);
 return {anchors:a,labelPosition:placementPoint,labelAngle:0,labelWidth:layout.width,labelHeight:layout.height,placement:'angular',text,value,lines,arc,ends};
}
function formatDimension(d:Dimension,value:number):string { return d.text||`${value.toFixed(d.format.decimals).replace('.',d.format.separator)}${d.kind==='angular'?'°':` ${d.format.unit}`}`; }
export function validDimension(value:unknown):boolean {
 const d=value as Dimension;const point=(p:Point)=>!!p&&Object.keys(p).length===2&&[p.x,p.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7);
 const optional=[d?.labelSize,d?.labelPlacement,d?.centerMark].filter(v=>v!==undefined).length;
 if(d?.centerMark!==undefined&&typeof d.centerMark!=='boolean')return false;
 if(d?.labelPlacement!==undefined&&!['start','center','end'].includes(d.labelPlacement))return false;
 if(!d||typeof d!=='object'||Object.keys(d).length!==(6+optional)||!['linear','angular','radius','diameter'].includes(d.kind)||!Array.isArray(d.anchors)||d.anchors.length!==(d.kind==='angular'?3:2)||!d.anchors.every(point)||!point(d.labelPosition)||typeof d.text!=='string'||d.text.length>10000)return false;
 if(d.labelSize!==undefined && (!d.labelSize || Object.keys(d.labelSize).length!==2 || ![d.labelSize.width,d.labelSize.height].every(n=>Number.isFinite(n)&&n>=1&&n<=1e6)))return false;
 const f=d.format,e=d.extension;return !!f&&Object.keys(f).length===4&&Number.isFinite(f.scale)&&f.scale>0&&f.scale<=1e6&&isUnit(f.unit)&&Number.isInteger(f.decimals)&&f.decimals>=0&&f.decimals<=8&&['.',','].includes(f.separator)&&!!e&&Object.keys(e).length===4&&typeof e.stroke==='string'&&/^(none|#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?)$/.test(e.stroke)&&[e.strokeWidth,e.gap,e.overshoot].every(n=>Number.isFinite(n)&&n>=0&&n<=1000);
}
