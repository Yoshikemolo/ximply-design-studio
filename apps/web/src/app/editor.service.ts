import { Injectable, computed, signal } from '@angular/core';
import { blankDocument, bounds, DocumentHistory, Layer, localPoint, newLayer, normalizePath, parseDocument, pick, Point, resizeLayer, resizeFromCorner, StudioDocument, svgExport } from '../../../../packages/domain/src/document';
import { CanvasRenderer } from '../../../../packages/renderer/src/canvas-renderer';
import { ToolId } from './tools';
@Injectable({providedIn:'root'})
export class EditorService {
  readonly document=signal<StudioDocument>(blankDocument());readonly selectedId=signal<string|null>(null);readonly tool=signal<ToolId>('select');readonly fill=signal('#0d59f2');readonly stroke=signal('#163363');readonly size=signal(4);readonly zoom=signal(.7);readonly status=signal('Ready to create');readonly revision=signal(0);
  readonly selected=computed(()=>this.document().layers.find(l=>l.id===this.selectedId())??null);readonly history=new DocumentHistory();readonly renderer=new CanvasRenderer();
  painting?:{id:string;canvas:HTMLCanvasElement};private gesture?:{before:StudioDocument;start:Point;last:Point;id:string;points:Point[];original:Layer;mode:string};
  constructor(){try{const draft=localStorage.getItem('xds-draft');if(draft)this.document.set(parseDocument(draft));}catch{this.status.set('Previous draft could not be restored. Open a saved project.');}}
  private changed(){this.revision.update(x=>x+1);this.renderer.prune(this.document().layers);try{const text=JSON.stringify(this.document());if(text.length<4_000_000)localStorage.setItem('xds-draft',text);else {localStorage.removeItem('xds-draft');this.status.set('Large project: save a project file to preserve your work.');}}catch{this.status.set('Browser storage is full. Save a project file.');}}
  private setLayer(id:string,patch:Partial<Layer>){this.document.update(d=>({...d,layers:d.layers.map(l=>l.id===id?{...l,...patch}:l)}));}
  updateLayer(patch:Partial<Layer>){const layer=this.selected();if(!layer||layer.locked)return;this.history.commit(this.document());if(patch.width!==undefined||patch.height!==undefined)patch=resizeLayer(layer,patch.width??layer.width,patch.height??layer.height);this.setLayer(layer.id,patch);this.changed();}
  toggle(id:string,key:'visible'|'locked'){this.history.commit(this.document());const layer=this.document().layers.find(l=>l.id===id)!;this.setLayer(id,{[key]:!layer[key]});this.changed();}
  rename(name:string){this.history.commit(this.document());this.document.update(d=>({...d,name:name.slice(0,150)}));this.changed();}
  background(value:string){this.history.commit(this.document());this.document.update(d=>({...d,background:value}));this.changed();}
  moveOrder(delta:number){const id=this.selectedId(),layers=[...this.document().layers],i=layers.findIndex(l=>l.id===id),j=i+delta;if(i<0||j<0||j>=layers.length)return;this.history.commit(this.document());[layers[i],layers[j]]=[layers[j],layers[i]];this.document.update(d=>({...d,layers}));this.changed();}
  remove(){const layer=this.selected();if(!layer||layer.locked)return;this.history.commit(this.document());this.document.update(d=>({...d,layers:d.layers.filter(l=>l.id!==layer.id)}));this.selectedId.set(null);this.changed();}
  duplicate(){const layer=this.selected();if(!layer||this.document().layers.length>=150)return;this.history.commit(this.document());const copy={...structuredClone(layer),id:crypto.randomUUID(),name:layer.name+' copy',x:layer.x+20,y:layer.y+20};this.document.update(d=>({...d,layers:[...d.layers,copy]}));this.selectedId.set(copy.id);this.changed();}
  undo(){this.cancel();this.document.set(this.history.undo(this.document()));this.changed();}
  redo(){this.cancel();this.document.set(this.history.redo(this.document()));this.changed();}
  reset(){this.history.commit(this.document());this.document.set(blankDocument());this.selectedId.set(null);this.changed();}
  open(text:string){const doc=parseDocument(text);this.history.commit(this.document());this.document.set(doc);this.selectedId.set(null);this.changed();this.status.set('Project opened');}
  start(point:Point){
    const tool=this.tool();if(tool==='hand')return;const before=structuredClone(this.document());
    if(tool==='select'){const active=this.selected();if(active&&!active.locked){const p=localPoint(active,point);const corners=[['tl',0,0],['tr',active.width,0],['bl',0,active.height],['br',active.width,active.height]] as const;const corner=corners.find(c=>Math.hypot(p.x-c[1],p.y-c[2])<14);if(corner){this.gesture={before,start:point,last:point,id:active.id,points:[],original:structuredClone(active),mode:'resize:'+corner[0]};return;}}
      const layer=pick(this.document().layers,point);this.selectedId.set(layer?.id??null);if(layer)this.gesture={before,start:point,last:point,id:layer.id,points:[],original:structuredClone(layer),mode:'move'};return;
    }
    if(this.document().layers.length>=150){this.status.set('Preview limit: 150 layers');return;}
    if(tool==='brush'||tool==='eraser'){
      let layer=this.selected();if(layer?.locked){this.status.set('Unlock the layer first');return;}
      if(tool==='eraser'&&layer?.kind!=='image'){this.status.set('Select an image or paint layer to erase');return;}
      if(layer?.kind!=='image'){layer=newLayer('image',crypto.randomUUID(),{x:0,y:0});layer.width=this.document().width;layer.height=this.document().height;layer.name='Paint layer';this.document.update(d=>({...d,layers:[...d.layers,layer!]}));}
      const canvas=window.document.createElement('canvas');canvas.width=Math.min(4096,Math.ceil(layer.width));canvas.height=Math.min(4096,Math.ceil(layer.height));const ctx=canvas.getContext('2d')!;
      if(layer.source){const image=this.renderer.image(layer.source,()=>{});if(!image){this.document.set(before);this.status.set('Image is loading. Try again.');return;}ctx.drawImage(image,0,0,canvas.width,canvas.height);}
      this.selectedId.set(layer.id);this.painting={id:layer.id,canvas};this.gesture={before,start:point,last:point,id:layer.id,points:[],original:structuredClone(layer),mode:tool};this.paint(point);return;
    }
    const layer=newLayer(tool,crypto.randomUUID(),point,this.fill(),this.stroke(),this.size());if(tool==='text'){layer.width=280;layer.height=60;layer.name='Text';}
    this.document.update(d=>({...d,layers:[...d.layers,layer]}));this.selectedId.set(layer.id);this.gesture={before,start:point,last:point,id:layer.id,points:[point],original:structuredClone(layer),mode:tool};
  }
  move(point:Point){const g=this.gesture;if(!g)return;
    if(g.mode==='move')this.setLayer(g.id,{x:g.original.x+point.x-g.start.x,y:g.original.y+point.y-g.start.y});
    else if(g.mode.startsWith('resize:'))this.setLayer(g.id,resizeFromCorner(g.original,point,g.mode.slice(7) as 'tl'|'tr'|'bl'|'br')); 
    else if(g.mode==='rectangle'||g.mode==='ellipse')this.setLayer(g.id,bounds(g.start,point));
    else if(g.mode==='path'){if(g.points.length<20000&&Math.hypot(point.x-g.last.x,point.y-g.last.y)>1){g.points.push(point);this.setLayer(g.id,normalizePath(g.original,g.points));}}
    else if(g.mode==='brush'||g.mode==='eraser')this.paint(point);g.last=point;
  }
  private paint(point:Point){const g=this.gesture,painting=this.painting;if(!g||!painting)return;const ctx=painting.canvas.getContext('2d')!,a=localPoint(g.original,g.last),b=localPoint(g.original,point);ctx.save();ctx.scale(painting.canvas.width/g.original.width,painting.canvas.height/g.original.height);ctx.globalCompositeOperation=g.mode==='eraser'?'destination-out':'source-over';ctx.strokeStyle=this.fill();ctx.fillStyle=this.fill();ctx.lineWidth=this.size();ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.beginPath();ctx.arc(b.x,b.y,this.size()/2,0,Math.PI*2);ctx.fill();ctx.restore();this.revision.update(v=>v+1);}
  end(){const g=this.gesture;if(!g)return;if(this.painting)this.setLayer(g.id,{source:this.painting.canvas.toDataURL('image/png')});this.history.commit(g.before);this.gesture=undefined;this.painting=undefined;this.changed();}
  cancel(){if(this.gesture)this.document.set(this.gesture.before);this.gesture=undefined;this.painting=undefined;this.revision.update(x=>x+1);}
  async importImage(file:File){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20_000_000)throw new Error('Choose a PNG, JPEG or WebP image under 20 MB.');const bitmap=await createImageBitmap(file);const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));const canvas=window.document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const layer=newLayer('image',crypto.randomUUID(),{x:40,y:40});layer.name=file.name.slice(0,150);layer.width=canvas.width;layer.height=canvas.height;layer.source=canvas.toDataURL('image/png');if(this.document().layers.length>=150)throw new Error('Preview limit: 150 layers');this.history.commit(this.document());this.document.update(d=>({...d,layers:[...d.layers,layer]}));this.selectedId.set(layer.id);this.tool.set('select');this.changed();}
  download(content:Blob,name:string){const url=URL.createObjectURL(content),link=window.document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  save(){this.download(new Blob([JSON.stringify(this.document())],{type:'application/json'}),this.document().name+'.ximply');this.status.set('Project file saved');}
  exportSvg(){this.download(new Blob([svgExport(this.document())],{type:'image/svg+xml'}),this.document().name+'.svg');this.status.set('SVG exported; raster layers remain embedded images');}
  async exportPng(){const canvas=await this.renderer.export(this.document());canvas.toBlob(blob=>{if(blob)this.download(blob,this.document().name+'.png');},'image/png');}
}
