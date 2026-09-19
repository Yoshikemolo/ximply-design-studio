import { Layer, StudioDocument } from '../../domain/src/document';
export class CanvasRenderer {
  private images=new Map<string,HTMLImageElement>();
  image(source:string,ready:()=>void):HTMLImageElement|undefined {
    if(!source)return undefined;
    const cached=this.images.get(source);if(cached)return cached.complete&&cached.naturalWidth>0?cached:undefined;
    const image=new Image();image.onload=ready;image.onerror=()=>this.images.delete(source);image.src=source;this.images.set(source,image);return undefined;
  }
  prune(layers:Layer[]){const active=new Set(layers.filter(l=>l.kind==='image').map(l=>l.source));for(const key of this.images.keys())if(!active.has(key))this.images.delete(key);}
  draw(canvas:HTMLCanvasElement,document:StudioDocument,selection:string|null,ready:()=>void,painting?:{id:string;canvas:HTMLCanvasElement},transparent=false) {
    if(canvas.width!==document.width)canvas.width=document.width;if(canvas.height!==document.height)canvas.height=document.height;
    const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);if(!transparent){ctx.fillStyle=document.background;ctx.fillRect(0,0,canvas.width,canvas.height);}
    for(const layer of document.layers)if(layer.visible)this.layer(ctx,layer,ready,painting?.id===layer.id?painting.canvas:undefined);
    const layer=document.layers.find(l=>l.id===selection&&l.visible);if(layer){ctx.save();this.transform(ctx,layer);ctx.strokeStyle='#0d59f2';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.strokeRect(-3,-3,layer.width+6,layer.height+6);ctx.setLineDash([]);for(const [x,y] of [[0,0],[layer.width,0],[0,layer.height],[layer.width,layer.height]]){ctx.fillStyle='#ffffff';ctx.fillRect(x-4,y-4,8,8);ctx.strokeRect(x-4,y-4,8,8);}ctx.restore();}
  }
  private transform(ctx:CanvasRenderingContext2D,l:Layer){ctx.translate(l.x+l.width/2,l.y+l.height/2);ctx.rotate(l.rotation*Math.PI/180);ctx.translate(-l.width/2,-l.height/2);}
  private layer(ctx:CanvasRenderingContext2D,l:Layer,ready:()=>void,painting?:HTMLCanvasElement){
    ctx.save();this.transform(ctx,l);ctx.globalAlpha=l.opacity;ctx.globalCompositeOperation=l.blend;ctx.fillStyle=l.fill;ctx.strokeStyle=l.stroke;ctx.lineWidth=l.strokeWidth;ctx.lineCap='round';ctx.lineJoin='round';
    if(l.kind==='rectangle'){ctx.fillRect(0,0,l.width,l.height);if(l.strokeWidth)ctx.strokeRect(0,0,l.width,l.height);}
    if(l.kind==='ellipse'){ctx.beginPath();ctx.ellipse(l.width/2,l.height/2,l.width/2,l.height/2,0,0,Math.PI*2);ctx.fill();if(l.strokeWidth)ctx.stroke();}
    if(l.kind==='path'&&l.points.length&&l.strokeWidth>0){ctx.beginPath();ctx.moveTo(l.points[0].x,l.points[0].y);for(const p of l.points.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke();}
    if(l.kind==='text'){ctx.font=`${l.fontSize}px sans-serif`;ctx.textBaseline='top';ctx.fillText(l.text,0,0);}
    if(l.kind==='image'){const image=painting??this.image(l.source,ready);ctx.filter=`brightness(${l.adjustments.brightness}%) contrast(${l.adjustments.contrast}%) saturate(${l.adjustments.saturation}%) blur(${l.adjustments.blur}px)`;if(image)ctx.drawImage(image,0,0,l.width,l.height);}
    ctx.restore();
  }
  async export(document:StudioDocument,transparent=false):Promise<HTMLCanvasElement>{
    await Promise.all(document.layers.filter(l=>l.kind==='image'&&l.source).map(async l=>{let image=this.images.get(l.source);if(!image){image=new Image();image.src=l.source;this.images.set(l.source,image);}await image.decode();}));
    const canvas=window.document.createElement('canvas');this.draw(canvas,document,null,()=>{},undefined,transparent);return canvas;
  }
}
