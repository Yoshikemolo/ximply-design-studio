import type {Layer,Point} from '../../../../packages/domain/src/document';
import {worldPoint} from '../../../../packages/domain/src/curves';
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
