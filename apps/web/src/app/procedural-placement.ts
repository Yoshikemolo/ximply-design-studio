import type {Layer,Point} from '../../../../packages/domain/src/document';
import {worldPoint} from '../../../../packages/domain/src/curves';
export type WallSnap = { point: Point; kind: 'end' | 'axis' };
/** Snap wall drawing to existing wall ends and axes so segments share exact joints. */
export function wallSnapPoint(layers: Layer[], point: Point, radius: number, exclude?: string): WallSnap | null {
  let best: WallSnap | null = null, distance = radius;
  for (const layer of layers) {
    const p = layer.procedural;
    if (p?.type !== 'wall' || !layer.visible || layer.locked || layer.id === exclude) continue;
    const a = worldPoint(layer, p.start), b = worldPoint(layer, p.end);
    for (const end of [a, b]) {
      const d = Math.hypot(point.x - end.x, point.y - end.y);
      if (d <= distance || (best?.kind === 'axis' && d <= radius)) { distance = d; best = { point: end, kind: 'end' }; }
    }
    if (best?.kind === 'end') continue;
    const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
    if (!squared) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
    const projected = { x: a.x + t * dx, y: a.y + t * dy }, d = Math.hypot(point.x - projected.x, point.y - projected.y);
    if (d <= distance) { distance = d; best = { point: projected, kind: 'axis' }; }
  }
  return best;
}
/** Find a nearby wall with enough usable length for an opening. */
export function openingHost(layers:Layer[],point:Point,width:number,radius:number):{wallId:string;offset:number}|undefined {
  let result:{wallId:string;offset:number}|undefined,distance=Infinity;
  for(const layer of layers){const p=layer.procedural;if(p?.type!=='wall'||!layer.visible||layer.locked)continue;
    const a=worldPoint(layer,p.start),b=worldPoint(layer,p.end),dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<width)continue;
    const t=Math.max(width/length/2,Math.min(1-width/length/2,((point.x-a.x)*dx+(point.y-a.y)*dy)/(length*length)));
    const d=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
    if(d<=Math.max(radius,p.thickness/2)&&d<distance){distance=d;result={wallId:layer.id,offset:t};}
  }
  return result;
}
