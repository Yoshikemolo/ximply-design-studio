import * as clipping from 'polygon-clipping';
import type { Layer, Point, StudioDocument } from './document';
import { anchor, CurvePath, fitCurves, mapCurves, worldPoint } from './curves';
import { ellipsePath, polyline } from './shapes';
export type ProceduralKind = 'wall' | 'door' | 'window' | 'pillar';
export interface WallProcedure {
    type: 'wall';
    start: Point;
    end: Point;
    thickness: number;
}
export interface OpeningHost {
    wallId: string;
    offset: number;
}
/** Leaf mechanisms available per leaf; `opening` is an empty passage and only applies to the whole hole. */
export type LeafType = 'swing' | 'sliding' | 'folding' | 'pocket' | 'fixed';
export const LEAF_TYPES: LeafType[] = ['swing', 'sliding', 'folding', 'pocket', 'fixed'];
interface OpeningProcedure {
    width: number;
    depth: number;
    leafWidths: number[];
    /** Optional mechanism per leaf; a missing entry uses the opening mechanism. */
    leafTypes?: LeafType[];
    swing: 'left' | 'right';
    /** Wall face the leaves project towards. */
    side?: 'front' | 'back';
    openingAngle: number;
    host?: OpeningHost;
}
export interface DoorProcedure extends OpeningProcedure {
    type: 'door';
    operation: 'swing' | 'sliding' | 'folding' | 'pocket' | 'opening';
}
export interface WindowProcedure extends OpeningProcedure {
    type: 'window';
    operation: 'fixed' | 'swing' | 'sliding' | 'opening';
}
export interface PillarProcedure {
    type: 'pillar';
    shape: 'rectangle' | 'circle';
    width: number;
    depth: number;
}
export type Procedural = WallProcedure | DoorProcedure | WindowProcedure | PillarProcedure;
export function defaultProcedural(type: ProceduralKind): Procedural {
    if (type === 'wall')
        return { type, start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, thickness: 16 };
    if (type === 'pillar')
        return { type, shape: 'rectangle', width: 60, depth: 60 };
    if (type === 'door')
        return { type, width: 80, depth: 16, leafWidths: [80], operation: 'swing', swing: 'left', side: 'front', openingAngle: 90 };
    return { type, width: 100, depth: 16, leafWidths: [50, 50], operation: 'fixed', swing: 'left', side: 'front', openingAngle: 90 };
}
const line = (a: Point, b: Point) => polyline([a, b]);
const rectangle = (x: number, y: number, w: number, h: number) => polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
function arc(center: Point, radius: number, start: number, angle: number): CurvePath {
    const steps = Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 2))), nodes = [];
    for (let i = 0; i <= steps; i++) {
        const theta = start + angle * i / steps, p = { x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) }, node = anchor(p), k = 4 / 3 * Math.tan(angle / steps / 4) * radius;
        if (i > 0)
            node.incoming = { x: p.x + k * Math.sin(theta), y: p.y - k * Math.cos(theta) };
        if (i < steps)
            node.outgoing = { x: p.x - k * Math.sin(theta), y: p.y + k * Math.cos(theta) };
        nodes.push(node);
    }
    return { closed: false, nodes };
}
function wallPath(p: WallProcedure): CurvePath {
    const length = Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y) || 1, n = { x: -(p.end.y - p.start.y) * p.thickness / 2 / length, y: (p.end.x - p.start.x) * p.thickness / 2 / length };
    return polyline([{ x: p.start.x + n.x, y: p.start.y + n.y }, { x: p.end.x + n.x, y: p.end.y + n.y }, { x: p.end.x - n.x, y: p.end.y - n.y }, { x: p.start.x - n.x, y: p.start.y - n.y }], true);
}
/** Keep architectural wall thickness perpendicular in world space, even under shear. */
function transformedWallPath(layer: Layer, procedure: WallProcedure): CurvePath {
    const start = worldPoint(layer, procedure.start), end = worldPoint(layer, procedure.end);
    const world = wallPath({ ...procedure, start, end });
    const angle = -layer.rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    return mapCurves([world], point => {
        const x = point.x - layer.x - layer.width / 2, y = point.y - layer.y - layer.height / 2;
        const rotatedY = x * sine + y * cosine;
        const px = x * cosine - y * sine - Math.tan((layer.skewX ?? 0) * Math.PI / 180) * rotatedY + layer.width / 2;
        const py = rotatedY + layer.height / 2;
        return { x: layer.flipX ? layer.width - px : px, y: layer.flipY ? layer.height - py : py };
    })[0];
}
/** Leaf mechanism of one leaf: an explicit per-leaf type wins over the opening mechanism. */
export function leafType(p: DoorProcedure | WindowProcedure, index: number): LeafType | 'opening' {
    if (p.operation === 'opening')
        return 'opening';
    return p.leafTypes?.[index] ?? p.operation;
}
interface OpeningCurve { path: CurvePath; projection: boolean }
/** Swing and folding arcs are projections of the leaf travel and are drawn as broken lines. */
function openingCurves(p: DoorProcedure | WindowProcedure): OpeningCurve[] {
    const curves: OpeningCurve[] = [], center = p.depth / 2, face = p.side === 'back' ? 1 : -1;
    const solid = (path: CurvePath) => curves.push({ path, projection: false });
    const projected = (path: CurvePath) => curves.push({ path, projection: true });
    // Jambs terminate at the opening; the portal itself has no filled rectangle.
    solid(line({ x: 0, y: 0 }, { x: 0, y: p.depth }));
    solid(line({ x: p.width, y: 0 }, { x: p.width, y: p.depth }));
    let offset = 0;
    p.leafWidths.forEach((width, index) => {
        const type = leafType(p, index);
        if (type === 'opening')
            return;
        const reverse = p.swing === 'right' ? (index % 2 === 0) : (index % 2 === 1), hinge = { x: offset + (reverse ? width : 0), y: center };
        const slide = offset;
        if (type === 'swing' || type === 'folding') {
            const leaves = type === 'folding' ? 2 : 1, leaf = width / leaves;
            const start = reverse ? Math.PI : 0, direction = (reverse ? -1 : 1) * face, angle = direction * p.openingAngle * Math.PI / 180;
            const end = { x: hinge.x + leaf * Math.cos(start + angle), y: center + leaf * Math.sin(start + angle) };
            solid(line(hinge, end));
            if (type === 'folding') {
                const fold = { x: end.x + leaf * Math.cos(start), y: end.y + leaf * Math.sin(start) };
                solid(line(end, fold));
            }
            if (p.openingAngle > 0)
                projected(arc(hinge, leaf, start, angle));
        }
        else if (type === 'pocket') {
            // The leaf slides inside the wall, so its housed position is a projection.
            projected(rectangle(slide + (reverse ? width : -width), center - p.depth * .08, width, p.depth * .16));
            solid(rectangle(slide, center - p.depth * .08, width, p.depth * .16));
        }
        else {
            const y = type === 'sliding' ? center + (index % 2 ? 1 : -1) * p.depth * .18 * -face : center;
            solid(rectangle(slide, y - p.depth * .08, width, p.depth * .16));
            if (type === 'sliding') {
                const a = { x: slide + width * .3, y: y - p.depth * .3 }, b = { x: slide + width * .7, y: y - p.depth * .3 };
                solid(line(a, b));
                solid(line(b, { x: b.x - width * .08, y: b.y - p.depth * .12 }));
                solid(line(b, { x: b.x - width * .08, y: b.y + p.depth * .12 }));
            }
        }
        offset += width;
    });
    return curves;
}
function openingPaths(p: DoorProcedure | WindowProcedure): CurvePath[] {
    return openingCurves(p).map((curve) => curve.path);
}
/** Broken-line pattern for projection curves, proportional to the stroke so it stays visible. */
export function projectionDash(strokeWidth: number): number[] {
    const unit = Math.max(1, strokeWidth);
    return [unit * 3, unit * 2];
}
/** Which generated curves of a layer are projection lines; empty when the layer has none. */
export function projectionCurves(layer: Layer): boolean[] {
    const p = layer.procedural;
    if (p?.type !== 'door' && p?.type !== 'window')
        return [];
    const flags = openingCurves(p).map((curve) => curve.projection);
    return flags.some(Boolean) && flags.length === layer.curves?.length ? flags : [];
}
const generators: Record<ProceduralKind, (p: Procedural) => CurvePath[]> = {
    wall: p => [wallPath(p as WallProcedure)],
    door: p => openingPaths(p as DoorProcedure),
    window: p => openingPaths(p as WindowProcedure),
    pillar: p => { const v = p as PillarProcedure; return [v.shape === 'circle' ? ellipsePath(v.width / 2, v.depth / 2, v.width / 2, v.depth / 2) : rectangle(0, 0, v.width, v.depth)]; },
};
function pathBounds(paths: CurvePath[]) { const points = paths.flatMap(p => p.nodes.flatMap(n => [n.point, n.incoming, n.outgoing])); const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y)); return { x, y, width: Math.max(1, Math.max(...points.map(p => p.x)) - x), height: Math.max(1, Math.max(...points.map(p => p.y)) - y) }; }
function nearGeometry(a: unknown, b: unknown): boolean {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a-b) < 1e-9;
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const left = a as Record<string,unknown>, right = b as Record<string,unknown>;
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => nearGeometry(left[key], right[key]));
}
export function generateProcedural(layer: Layer, document?: StudioDocument): Layer {
    const p = layer.procedural;
    if (!p)
        return layer;
    if (p.type === 'wall') {
        const paths = [transformedWallPath(layer, p)], bounds = pathBounds(paths), fitted = fitCurves(layer, paths);
        const result: Layer = { ...fitted, points: [], procedural: { ...p, start: { x: p.start.x - bounds.x, y: p.start.y - bounds.y }, end: { x: p.end.x - bounds.x, y: p.end.y - bounds.y } } };
        // Avoid serialization churn from floating-point inverse transforms.
        return nearGeometry(result, layer) ? layer : result;
    }
    let metadata = structuredClone(p);
    const host = (p.type === 'door' || p.type === 'window') && p.host ? document?.layers.find(l => l.id === p.host!.wallId && l.procedural?.type === 'wall') : undefined;
    if (host && (metadata.type === 'door' || metadata.type === 'window'))
        metadata.depth = (host.procedural as WallProcedure).thickness;
    const paths = generators[metadata.type](metadata), bounds = pathBounds(paths);
    let result: Layer = { ...layer, width: bounds.width, height: bounds.height, curves: mapCurves(paths, q => ({ x: q.x - bounds.x, y: q.y - bounds.y })), points: [], procedural: metadata };
    if (host && (metadata.type === 'door' || metadata.type === 'window')) {
        const w = host.procedural as WallProcedure, a = worldPoint(host, w.start), b = worldPoint(host, w.end), length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length >= metadata.width) {
            const t = Math.max(metadata.width / 2 / length, Math.min(1 - metadata.width / 2 / length, metadata.host!.offset));
            metadata.host = { ...metadata.host!, offset: t };
            result = { ...result, rotation: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, skewX: 0, flipX: false, flipY: false };
            const portal = worldPoint(result, { x: metadata.width / 2 - bounds.x, y: metadata.depth / 2 - bounds.y });
            result.x += a.x + (b.x - a.x) * t - portal.x;
            result.y += a.y + (b.y - a.y) * t - portal.y;
        }
        else
            delete metadata.host;
    }
    else if ((metadata.type === 'door' || metadata.type === 'window') && metadata.host)
        delete metadata.host;
    if (!host && (metadata.type === 'door' || metadata.type === 'window') && layer.curves?.length && layer.curves[0].nodes.length === 2 && layer.curves[1]?.nodes.length === 2) {
        const jambs = [...layer.curves[0].nodes, ...layer.curves[1].nodes].map(n => worldPoint(layer, n.point));
        const previous = { x: jambs.reduce((a, p) => a + p.x, 0) / 4, y: jambs.reduce((a, p) => a + p.y, 0) / 4 };
        const portal = worldPoint(result, { x: metadata.width / 2 - bounds.x, y: metadata.depth / 2 - bounds.y });
        result.x += previous.x - portal.x;
        result.y += previous.y - portal.y;
    }
    return result;
}
export function syncProcedurals(document: StudioDocument): StudioDocument {
    const walls = { ...document, layers: document.layers.map(l => l.procedural?.type === 'wall' ? generateProcedural(l) : l) };
    return { ...walls, layers: walls.layers.map(l => l.procedural && l.procedural.type !== 'wall' ? generateProcedural(l, walls) : l) };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validProcedural(value: unknown): value is Procedural {
    if (!record(value))
        return false;
    const p = value, length = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 16384, point = (v: unknown): v is Point => record(v) && Object.keys(v).length === 2 && [v['x'], v['y']].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7);
    if (p['type'] === 'wall')
        return Object.keys(p).length === 4 && point(p['start']) && point(p['end']) && length(p['thickness']) && length(Math.hypot(p['end'].x - p['start'].x, p['end'].y - p['start'].y));
    if (p['type'] === 'pillar')
        return Object.keys(p).length === 4 && typeof p['shape'] === 'string' && ['rectangle', 'circle'].includes(p['shape']) && length(p['width']) && length(p['depth']) && (p['shape'] !== 'circle' || Math.abs(Number(p['width']) - Number(p['depth'])) <= 1e-6);
    if (p['type'] !== 'door' && p['type'] !== 'window')
        return false;
    const optional = ['host', 'leafTypes', 'side'].filter(key => p[key] !== undefined).length;
    if (p['side'] !== undefined && !['front', 'back'].includes(p['side'] as string))
        return false;
    if (p['leafTypes'] !== undefined && (!Array.isArray(p['leafTypes']) || p['leafTypes'].length !== (p['leafWidths'] as unknown[])?.length || !p['leafTypes'].every(type => typeof type === 'string' && (LEAF_TYPES as string[]).includes(type))))
        return false;
    if (Object.keys(p).length !== 7 + optional || !length(p['width']) || !length(p['depth']) || !Array.isArray(p['leafWidths']) || p['leafWidths'].length < 1 || p['leafWidths'].length > (p['type'] === 'door' ? 4 : 8) || !p['leafWidths'].every(length) || Math.abs(p['leafWidths'].reduce((a: number, b: number) => a + b, 0) - Number(p['width'])) > 1e-6 || typeof p['swing'] !== 'string' || !['left', 'right'].includes(p['swing']) || typeof p['operation'] !== 'string' || !(p['type'] === 'door' ? ['swing', 'sliding', 'folding', 'pocket', 'opening'] : ['fixed', 'swing', 'sliding', 'opening']).includes(p['operation']) || typeof p['openingAngle'] !== 'number' || !Number.isFinite(p['openingAngle']) || p['openingAngle'] < 0 || p['openingAngle'] > 180)
        return false;
    return p['host'] === undefined || (record(p['host']) && Object.keys(p['host']).length === 2 && typeof p['host']['wallId'] === 'string' && p['host']['wallId'].length > 0 && p['host']['wallId'].length <= 100 && typeof p['host']['offset'] === 'number' && Number.isFinite(p['host']['offset']) && p['host']['offset'] >= 0 && p['host']['offset'] <= 1);
}
export function validateProcedurals(doc: StudioDocument): void {
    for (const layer of doc.layers) {
        const p = layer.procedural;
        if (!p)
            continue;
        if (!validProcedural(p))
            throw new Error('Invalid procedural parameters.');
        if ((p.type === 'door' || p.type === 'window') && p.host) {
            const host = doc.layers.find(l => l.id === p.host!.wallId && l.procedural?.type === 'wall');
            if (!host)
                throw new Error('Invalid opening host.');
            const w = host.procedural as WallProcedure, a = worldPoint(host, w.start), b = worldPoint(host, w.end), length = Math.hypot(b.x - a.x, b.y - a.y), center = p.host.offset * length;
            if (center - p.width / 2 < -1e-6 || center + p.width / 2 > length + 1e-6)
                throw new Error('Opening exceeds its host wall.');
        }
    }
}
const worldPolygon = (layer: Layer, path: CurvePath): clipping.Polygon => [path.nodes.map(n => { const p = worldPoint(layer, n.point); return [p.x, p.y] as clipping.Pair; })];
function openingCut(layer: Layer): clipping.Polygon {
    const p = layer.procedural as DoorProcedure | WindowProcedure, raw = openingPaths(p), bounds = pathBounds(raw), path = rectangle(-bounds.x, -bounds.y, p.width, p.depth);
    return worldPolygon(layer, path);
}
function convexHull(points: Point[]): Point[] {
    const ordered = [...points].sort((a,b) => a.x-b.x || a.y-b.y);
    const cross = (a:Point,b:Point,c:Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const half = (source:Point[]) => { const result:Point[]=[]; for(const point of source){while(result.length>1 && cross(result[result.length-2],result[result.length-1],point)<=0)result.pop();result.push(point);}return result; };
    const lower=half(ordered),upper=half(ordered.reverse());return lower.slice(0,-1).concat(upper.slice(0,-1));
}
/** Shared endpoints receive a bounded miter; unattached endpoints retain butt caps. */
function wallJunctions(first:Layer,second:Layer):clipping.Polygon[] {
    const a=first.procedural as WallProcedure,b=second.procedural as WallProcedure;
    const firstEnds=[worldPoint(first,a.start),worldPoint(first,a.end)],secondEnds=[worldPoint(second,b.start),worldPoint(second,b.end)],result:clipping.Polygon[]=[];
    for(let i=0;i<2;i++)for(let j=0;j<2;j++){
        const joint=firstEnds[i],other=secondEnds[j];if(Math.hypot(joint.x-other.x,joint.y-other.y)>1e-6)continue;
        const vector=(end:Point)=>{const length=Math.hypot(end.x-joint.x,end.y-joint.y);return {x:(end.x-joint.x)/length,y:(end.y-joint.y)/length};};
        const u=vector(firstEnds[1-i]),v=vector(secondEnds[1-j]),det=u.x*v.y-u.y*v.x;
        if(Math.abs(det)<1e-9)continue;
        const na={x:-u.y*a.thickness/2,y:u.x*a.thickness/2},nb={x:-v.y*b.thickness/2,y:v.x*b.thickness/2};
        const points=[{x:joint.x+na.x,y:joint.y+na.y},{x:joint.x-na.x,y:joint.y-na.y},{x:joint.x+nb.x,y:joint.y+nb.y},{x:joint.x-nb.x,y:joint.y-nb.y}];
        for(const sign of [-1,1]){
            const origin={x:joint.x+na.x*sign,y:joint.y+na.y*sign},target={x:joint.x-nb.x*sign,y:joint.y-nb.y*sign};
            const dx=target.x-origin.x,dy=target.y-origin.y,t=(dx*v.y-dy*v.x)/det,intersection={x:origin.x+u.x*t,y:origin.y+u.y*t};
            if(Math.hypot(intersection.x-joint.x,intersection.y-joint.y)<=Math.max(a.thickness,b.thickness)*5)points.push(intersection);
        }
        result.push([convexHull(points).map(point=>[point.x,point.y] as clipping.Pair)]);
    }
    return result;
}
const sameStyle = (a: Layer, b: Layer) => a.fill === b.fill && a.stroke === b.stroke && a.strokeWidth === b.strokeWidth && a.opacity === b.opacity && a.blend === b.blend && JSON.stringify(a.strokeStyle) === JSON.stringify(b.strokeStyle) && JSON.stringify(a.groupPath) === JSON.stringify(b.groupPath);
/** Derived rendering only: originals and their identities remain editable. */
export function materializeProcedural(document: StudioDocument): StudioDocument {
    const synced = syncProcedurals(document), layers = synced.layers, used = new Set<string>(), result: Layer[] = [];
    for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        if (used.has(l.id))
            continue;
        if (l.procedural?.type !== 'wall' || !l.visible) {
            result.push(l);
            continue;
        }
        let geometry: clipping.MultiPolygon = [worldPolygon(l, l.curves![0])];
        const component = [l];
        used.add(l.id);
        // Compatible wall runs may contain openings; ordinary artwork remains a stacking boundary.
        let end = i + 1;
        while (end < layers.length) {
            const next = layers[end];
            if (next.procedural?.type === 'door' || next.procedural?.type === 'window') { end++; continue; }
            if (next.procedural?.type !== 'wall' || !next.visible || !sameStyle(l, next)) break;
            end++;
        }
        let changed = true;
        while (changed) {
            changed = false;
            for (let j = i + 1; j < end; j++) {
                const candidate = layers[j];
                if (candidate.procedural?.type !== 'wall' || used.has(candidate.id))
                    continue;
                const polygon = worldPolygon(candidate, candidate.curves![0]);
                const joined = clipping.union(geometry, polygon);
                if (joined.length < geometry.length + 1) {
                    geometry = joined;
                    component.push(candidate);
                    used.add(candidate.id);
                    changed = true;
                }
            }
        }
        let combined: clipping.MultiPolygon = [];
        for (const wall of component) {
            let cut: clipping.MultiPolygon = [worldPolygon(wall, wall.curves![0])];
            for (const opening of layers) {
                const p = opening.procedural;
                if (opening.visible && (p?.type === 'door' || p?.type === 'window') && p.host?.wallId === wall.id)
                    cut = clipping.difference(cut, openingCut(opening));
            }
            combined = combined.length ? clipping.union(combined, cut) : cut;
        }
        for(let a=0;a<component.length;a++)for(let b=a+1;b<component.length;b++){
            for(const patch of wallJunctions(component[a],component[b])){
                let joint:clipping.MultiPolygon=[patch];
                for(const opening of layers){const p=opening.procedural;if(opening.visible&&(p?.type==='door'||p?.type==='window')&&p.host&&(p.host.wallId===component[a].id||p.host.wallId===component[b].id))joint=clipping.difference(joint,openingCut(opening));}
                combined=clipping.union(combined,joint);
            }
        }
        geometry = combined;
        const curves = geometry.flatMap(polygon => polygon.map(ring => polyline(ring.slice(0, -1).map(([x, y]) => ({ x, y })), true)));
        result.push({ ...l, x: 0, y: 0, rotation: 0, skewX: 0, flipX: false, flipY: false, width: document.width, height: document.height, curves, points: [], procedural: undefined });
    }
    return { ...synced, layers: result };
}
export function resizeProcedural(layer: Layer, width: number, height: number): Procedural {
    const p = layer.procedural!, sx = width / layer.width, sy = height / layer.height;
    if (p.type === 'wall')
        return { ...p, start: { x: p.start.x * sx, y: p.start.y * sy }, end: { x: p.end.x * sx, y: p.end.y * sy } };
    if (p.type === 'pillar')
        return { ...p, width: p.width * sx, depth: p.shape === 'circle' ? p.width * sx : p.depth * sy };
    return { ...p, width: p.width * sx, leafWidths: p.leafWidths.map(w => w * sx) };
}
