// @vitest-environment happy-dom
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { EditorService } from '../src/app/editor.service';
import { newLayer, parseDocument } from '../../../packages/domain/src/document';

beforeEach(() => {
  localStorage.clear();
  const canvases = new WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvas>>();
  const native = (element: HTMLCanvasElement) => {
    let canvas = canvases.get(element);
    if (!canvas) { canvas = createCanvas(element.width, element.height); canvases.set(element, canvas); }
    return canvas;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) { return native(this).getContext('2d') as never; });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function(this: HTMLCanvasElement) { return native(this).toDataURL('image/png'); });
});
afterEach(() => vi.restoreAllMocks());
function editor() { const e = new EditorService(); e.tool.set('brush'); e.size.set(20); e.fill.set('#ff0000'); return e; }
async function cache(e: EditorService) { vi.spyOn(e.renderer, 'image').mockReturnValue(await loadImage(e.selected()!.source) as unknown as HTMLImageElement); }

describe('bounded paint objects', () => {
  it('keeps the page frame during the stroke then crops with exact world pixels', async () => {
    const e = editor(); e.start({x:50,y:50}); e.move({x:80,y:50});
    expect(e.selected()!.width).toBe(e.document().width);
    const before = e.painting!.canvas.getContext('2d')!.getImageData(0,0,120,100).data;
    e.end();
    const l = e.selected()!;
    expect(l.paintLayer).toBe(true); expect(l.width).toBeLessThan(60); expect(l.height).toBeLessThan(30);
    const result = createCanvas(120,100); result.getContext('2d').drawImage(await loadImage(l.source),l.x,l.y,l.width,l.height);
    expect(result.getContext('2d').getImageData(0,0,120,100).data).toEqual(before);
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
    e.undo(); expect(e.document().layers).toHaveLength(0); e.redo(); expect(e.selected()!.source).toBe(l.source);
  });
  it('expands an existing paint object so later strokes can reach the rest of the page', async () => {
    const e = editor(); e.start({x:50,y:50}); e.end(); await cache(e);
    e.start({x:200,y:200}); expect(e.selected()!.width).toBe(e.document().width); e.end();
    const l=e.selected()!; expect(l.x).toBeLessThan(50); expect(l.x+l.width).toBeGreaterThan(200);
    const c=createCanvas(240,240); c.getContext('2d').drawImage(await loadImage(l.source),l.x,l.y,l.width,l.height);
    expect(c.getContext('2d').getImageData(50,50,1,1).data[3]).toBe(255);
    expect(c.getContext('2d').getImageData(200,200,1,1).data[3]).toBe(255);
  });
  it('preserves selection and redo for transparent and cancelled gestures', () => {
    const e=editor(); e.start({x:50,y:50}); e.end(); e.undo(); const before=JSON.stringify(e.document()); const selection=e.selectedId();
    e.fill.set('#ff000000'); e.start({x:100,y:100}); e.end(); expect(JSON.stringify(e.document())).toBe(before); expect(e.selectedId()).toBe(selection);
    e.redo(); expect(e.document().layers).toHaveLength(1);
    const id=e.selectedId(); e.selectedId.set(null); e.selectedIds.set([]); e.fill.set('#ff0000'); e.start({x:300,y:300}); e.cancel();
    expect(e.document().layers.map(l=>l.id)).toEqual([id]); expect(e.selectedId()).toBe(null); expect(e.selectedIds()).toEqual([]);
  });
  it('leaves imported image frames unchanged', async () => {
    const e=editor(), l=newLayer('image','import',{x:30,y:40}); l.width=100;l.height=90;
    const source=createCanvas(100,90); source.getContext('2d').fillRect(0,0,100,90);l.source=source.toDataURL('image/png');
    e.document.update(d=>({...d,layers:[l]}));e.selectedId.set(l.id);await cache(e);
    e.start({x:50,y:50});e.end();expect(e.selected()).toMatchObject({x:30,y:40,width:100,height:90});expect(e.selected()!.paintLayer).toBeUndefined();
  });
  it('bakes rotated and reflected paint without moving existing pixels or changing opacity', async () => {
    const e=editor(); const l=newLayer('image','transformed',{x:30,y:40});
    Object.assign(l,{width:40,height:20,rotation:90,flipX:true,opacity:0.4,paintLayer:true});
    const source=createCanvas(40,20); source.getContext('2d').fillStyle='#00ff00';source.getContext('2d').fillRect(0,0,20,20);l.source=source.toDataURL('image/png');
    e.document.update(d=>({...d,layers:[l]}));e.selectedId.set(l.id);await cache(e);
    const before=createCanvas(100,100);e.renderer.draw(before as unknown as HTMLCanvasElement,e.document(),null,()=>{},undefined,true);
    e.start({x:200,y:200});e.end();await cache(e);
    const after=createCanvas(100,100);e.renderer.draw(after as unknown as HTMLCanvasElement,e.document(),null,()=>{},undefined,true);
    expect(after.getContext('2d').getImageData(0,0,100,100).data).toEqual(before.getContext('2d').getImageData(0,0,100,100).data);
    expect(e.selected()).toMatchObject({rotation:0,flipX:false,opacity:0.4});
  });
  it('rolls back oversized results before touching history', async () => {
    const e=editor();e.start({x:50,y:50});e.end();await cache(e);
    e.updateLayer({x:-20000});const before=structuredClone(e.document());const ids=[...e.selectedIds()];
    e.size.set(100);e.start({x:100,y:100});e.end();
    expect(e.document()).toEqual(before);expect(e.selectedIds()).toEqual(ids);expect(e.status()).toBe('Paint bounds exceed document limits');
    e.undo();expect(e.selected()!.x).toBeGreaterThan(0);
  });
  it('removes a completely erased paint object and restores it on undo', async () => {
    const e=editor();e.start({x:50,y:50});e.end();const original=structuredClone(e.document());await cache(e);
    e.tool.set('eraser');e.size.set(100);e.start({x:50,y:50});e.end();expect(e.document().layers).toHaveLength(0);
    e.undo();expect(e.document()).toEqual(original);
  });
  it('validates the optional marker without coercion', () => {
    const e=editor();e.start({x:50,y:50});e.end();const d=structuredClone(e.document());
    for(const value of [false,null,1,0,'true']) { (d.layers[0] as any).paintLayer=value; expect(()=>parseDocument(JSON.stringify(d))).toThrow(); }
    d.layers[0].paintLayer=true;d.layers[0].kind='rectangle';expect(()=>parseDocument(JSON.stringify(d))).toThrow();
    d.layers[0].kind='image';d.version=1;expect(()=>parseDocument(JSON.stringify(d))).toThrow();
  });
});
