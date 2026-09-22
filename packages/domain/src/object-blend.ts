import type { Layer, StudioDocument } from "./document";
import { CurvePath, lerp, splitSegment } from "./curves";
import { ellipsePath, polyline } from "./shapes";
import { blendFillPaint } from "./paint";

export type BlendEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export interface ObjectBlend {
  id: string;
  groupId: string;
  backIds: string[];
  frontIds: string[];
  stepIds: string[][];
  steps: number;
  easing: BlendEasing;
}
const EASINGS: BlendEasing[] = ["linear", "ease-in", "ease-out", "ease-in-out"];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function blendProgress(t: number, easing: BlendEasing): number {
  if (!Number.isFinite(t) || t < 0 || t > 1 || !EASINGS.includes(easing)) throw new Error("Invalid blend progression.");
  if (easing === "ease-in") return t * t;
  if (easing === "ease-out") return 1 - (1 - t) ** 2;
  if (easing === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return t;
}

function curvesFor(layer: Layer): CurvePath[] {
  if (layer.guide || layer.symbolId || layer.dimension || layer.procedural || !["rectangle", "ellipse", "path"].includes(layer.kind))
    throw new Error("Object blends require ordinary vector objects.");
  let paths: CurvePath[];
  if (layer.kind === "rectangle") paths = [polyline([{x:0,y:0},{x:layer.width,y:0},{x:layer.width,y:layer.height},{x:0,y:layer.height}], true)];
  else if (layer.kind === "ellipse") paths = [ellipsePath(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2)];
  else paths = layer.curves ?? [polyline(layer.points)];
  if (!paths.length || paths.some((path) => path.nodes.length < (path.closed ? 3 : 2) || path.nodes.length > 256))
    throw new Error("Blend contours require 2–256 anchors, or at least 3 for a closed contour.");
  return paths.map((path) => ({ ...path, nodes: path.nodes.map((node) => {
    const reflect = (point: {x:number;y:number}) => ({ x: layer.flipX ? layer.width - point.x : point.x, y: layer.flipY ? layer.height - point.y : point.y });
    return { ...node, point: reflect(node.point), incoming: reflect(node.incoming), outgoing: reflect(node.outgoing) };
  }) }));
}

function subdivide(path: CurvePath, count: number): CurvePath {
  let result = structuredClone(path);
  while (result.nodes.length < count) {
    let longest = -1, at = 0;
    const segments = result.closed ? result.nodes.length : result.nodes.length - 1;
    for (let index = 0; index < segments; index++) {
      const a = result.nodes[index], b = result.nodes[(index + 1) % result.nodes.length];
      const distance = Math.hypot(a.outgoing.x - a.point.x, a.outgoing.y - a.point.y) + Math.hypot(b.incoming.x - a.outgoing.x, b.incoming.y - a.outgoing.y) + Math.hypot(b.point.x - b.incoming.x, b.point.y - b.incoming.y);
      if (distance > longest) { longest = distance; at = index; }
    }
    result = splitSegment(result, at);
  }
  return result;
}
function pairCurves(back: Layer, front: Layer): [CurvePath[], CurvePath[]] {
  const a = curvesFor(back), b = curvesFor(front);
  if (a.length !== b.length || a.some((path, index) => path.closed !== b[index].closed))
    throw new Error("Blend endpoints need matching contour counts and closure.");
  const counts = a.map((path, index) => Math.max(path.nodes.length, b[index].nodes.length));
  if (counts.reduce((sum, count) => sum + count, 0) > 20000) throw new Error("Blend geometry exceeds the native anchor limit.");
  return [a.map((path, index) => subdivide(path, counts[index])), b.map((path, index) => subdivide(path, counts[index]))];
}
export function blendCompatible(back: Layer[], front: Layer[]): void {
  if (!back.length || back.length !== front.length) throw new Error("Blend endpoint groups need the same number of vector objects.");
  back.forEach((layer, index) => pairCurves(layer, front[index]));
}

function rgba(value: string): number[] {
  if (value === "none") return [0,0,0,0];
  if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) throw new Error("Invalid blend paint.");
  return [1,3,5].map((index) => Number.parseInt(value.slice(index,index+2),16)).concat(value.length === 9 ? Number.parseInt(value.slice(7),16) / 255 : 1);
}
export function interpolateBlendPaint(back: string, front: string, t: number): string {
  blendProgress(t,"linear");
  const a = rgba(back), b = rgba(front), alpha = mix(a[3], b[3], t);
  if (alpha <= 0) return "none";
  const channels = [0,1,2].map((index) => Math.round(mix(a[index] * a[3], b[index] * b[3], t) / alpha));
  const byte = (value: number) => Math.max(0, Math.min(255,value)).toString(16).padStart(2,"0");
  const opacity = Math.round(alpha * 255);
  return "#" + channels.map(byte).join("") + (opacity === 255 ? "" : byte(opacity));
}

/** Index-corresponding cubic interpolation; extra anchors use exact de Casteljau subdivision. */
export function interpolateBlendLayer(back: Layer, front: Layer, t: number, id: string): Layer {
  blendProgress(t,"linear");
  if (!isId(id)) throw new Error("Invalid generated blend identity.");
  const [a,b] = pairCurves(back,front);
  const rotationDelta = ((front.rotation - back.rotation) % 360 + 540) % 360 - 180;
  const curves = a.map((path,index) => ({ closed:path.closed, nodes:path.nodes.map((node,nodeIndex) => {
    const other = b[index].nodes[nodeIndex];
    return { point:lerp(node.point,other.point,t), incoming:lerp(node.incoming,other.incoming,t), outgoing:lerp(node.outgoing,other.outgoing,t), smooth:node.smooth && other.smooth };
  }) }));
  if (curves.some((path) => path.nodes.some((node) => [node.point,node.incoming,node.outgoing].some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 100000 || Math.abs(point.y) > 100000))))
    throw new Error("Generated blend geometry exceeds native coordinate limits.");
  const result: Layer = {
    ...structuredClone(t < 0.5 ? back : front), id, kind:"path", name:"Blend step",
    x:mix(back.x,front.x,t), y:mix(back.y,front.y,t), width:mix(back.width,front.width,t), height:mix(back.height,front.height,t),
    rotation:((back.rotation + rotationDelta * t + 180) % 360 + 360) % 360 - 180,
    skewX:mix(back.skewX ?? 0,front.skewX ?? 0,t), flipX:false, flipY:false,
    fill:interpolateBlendPaint(back.fill,front.fill,t), stroke:interpolateBlendPaint(back.stroke,front.stroke,t),
    strokeWidth:mix(back.strokeWidth,front.strokeWidth,t), opacity:mix(back.opacity,front.opacity,t),
    points:[], curves, source:"", text:"", locked:false,
  };
  // Gradients blend between the ends, and a gradient fades into a flat colour at the other.
  const fillPaint = blendFillPaint(back, front, t);
  if (fillPaint && result.fill !== "none") result.fillPaint = fillPaint;
  else if (fillPaint?.kind === "gradient") { result.fill = fillPaint.stops[0].color.slice(0, 7); result.fillPaint = fillPaint; }
  else delete result.fillPaint;
  delete result.groupPath;
  delete result.symbolId;
  delete result.traceSourceId;
  delete result.typography;
  delete result.textLayout;
  return result;
}

/** Strict native reference validation; derived geometry is regenerated separately. */
export function validateBlends(document: StudioDocument): void {
  if (document.blends === undefined) return;
  if (document.version !== 2 || !Array.isArray(document.blends) || document.blends.length > 150 || document.layers.length > 150)
    throw new Error("Invalid native object blends.");
  const ids = new Set<string>(), groups = new Set<string>(), references = new Set<string>();
  const layerMap = new Map(document.layers.map((layer) => [layer.id,layer]));
  for (const blend of document.blends) {
    if (!isRecord(blend) || Object.keys(blend).length !== 7 || !isId(blend.id) || !isId(blend.groupId) || ids.has(blend.id) || groups.has(blend.groupId) ||
      !Number.isInteger(blend.steps) || blend.steps < 1 || blend.steps > 100 || typeof blend.easing !== "string" || !EASINGS.includes(blend.easing) ||
      !Array.isArray(blend.backIds) || !blend.backIds.length || !Array.isArray(blend.frontIds) || blend.backIds.length !== blend.frontIds.length ||
      !Array.isArray(blend.stepIds) || blend.stepIds.length !== blend.steps || blend.stepIds.some((row) => !Array.isArray(row) || row.length !== blend.backIds.length))
      throw new Error("Invalid object blend definition.");
    ids.add(blend.id); groups.add(blend.groupId);
    const ordered = [...blend.backIds,...blend.stepIds.flat(),...blend.frontIds];
    if (ordered.some((id) => !isId(id) || !layerMap.has(id) || references.has(id)) || new Set(ordered).size !== ordered.length)
      throw new Error("Invalid or overlapping blend references.");
    ordered.forEach((id) => references.add(id));
    const first = layerMap.get(blend.backIds[0])!, path = first.groupPath ?? [], depth = path.indexOf(blend.groupId);
    if (depth < 0 || depth + 2 > 16) throw new Error("Invalid blend group depth.");
    const prefix = path.slice(0,depth+1);
    const members = document.layers.filter((layer) => layer.groupPath?.includes(blend.groupId));
    if (members.length !== ordered.length || members.some((layer,index) => layer.id !== ordered[index] || !prefix.every((id,at) => layer.groupPath?.[at] === id)))
      throw new Error("Invalid blend group membership or ordering.");
    const start = document.layers.indexOf(members[0]);
    if (ordered.some((id,index) => document.layers[start+index]?.id !== id)) throw new Error("Blend members must remain contiguous.");
    blend.stepIds.forEach((row) => row.forEach((id) => {
      const layer = layerMap.get(id)!;
      if (layer.kind !== "path" || layer.guide || layer.symbolId || layer.dimension || layer.procedural || layer.groupPath?.length !== prefix.length + 1 || layer.groupPath[prefix.length] !== row[0])
        throw new Error("Invalid generated blend subgroup.");
      pairCurves(layerMap.get(blend.backIds[row.indexOf(id)])!, layer);
    }));
    blendCompatible(blend.backIds.map((id) => layerMap.get(id)!),blend.frontIds.map((id) => layerMap.get(id)!));
  }
}

/** Rebuilds derived artwork with stable identities; never modifies endpoint objects. */
export function syncBlends(document: StudioDocument): StudioDocument {
  if (!document.blends?.length) return document;
  validateBlends(document);
  const byId = new Map(document.layers.map((layer) => [layer.id,layer]));
  const replacements = new Map<string,Layer>();
  for (const blend of document.blends) {
    const first = byId.get(blend.backIds[0])!;
    const prefix = first.groupPath!.slice(0,first.groupPath!.indexOf(blend.groupId)+1);
    blend.stepIds.forEach((row,step) => {
      const t = blendProgress((step+1)/(blend.steps+1),blend.easing);
      row.forEach((id,index) => {
        const layer = interpolateBlendLayer(byId.get(blend.backIds[index])!,byId.get(blend.frontIds[index])!,t,id);
        const current = byId.get(id)!;
        replacements.set(id,{ ...layer, locked:current.locked, visible:current.visible, name:current.name, groupPath:[...prefix,row[0]] });
      });
    });
  }
  return { ...document,layers:document.layers.map((layer) => replacements.get(layer.id) ?? layer) };
}
