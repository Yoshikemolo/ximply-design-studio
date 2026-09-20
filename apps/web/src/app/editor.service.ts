import { Procedural, defaultProcedural, generateProcedural, syncProcedurals, validProcedural } from "../../../../packages/domain/src/procedural";
import { openingHost, wallSnapPoint, WallSnap } from "./procedural-placement";
import { BrushSettings, BrushType, BRUSH_TYPES, brushStamps, defaultBrush, validBrushSettings } from "../../../../packages/domain/src/brush";
import { wallAxis, wallBoolean, WallOperation } from "../../../../packages/domain/src/wall-boolean";
import { MarginGuides, MARGIN_GUIDE_PREFIX, marginGuidePositions, PageEdges, PageSize, PAGE_MAXIMUM, PAGE_MINIMUM, pageSizeFits, RegistrationMarks, REGISTRATION_LAYER_NAME, registrationFits, registrationLayer, resizePage } from "../../../../packages/domain/src/page-setup";
import { Dimension, DimensionFormat, defaultDimensionFormat, dimensionGeometry } from "../../../../packages/domain/src/dimensions";
import { LineEnds, defaultLineEnds, validLineEnds } from "../../../../packages/domain/src/line-endings";
import { snapDimensionPoint, snapDimensionOffset, DimensionSnap } from "./dimension-snapping";
import { AreaSelectionKind, SelectionArea, layerInsideArea, layerIntersectsArea } from "../../../../packages/domain/src/selection-area";
import { blendCompatible, blendProgress, interpolateBlendLayer, syncBlends, ObjectBlend, BlendEasing } from "../../../../packages/domain/src/object-blend";
import { defaultTypography, defaultTextLayout, FONT_FAMILIES, layoutText, TextLayoutOptions, TextTypography } from "../../../../packages/domain/src/text-layout";
import { snapPoint, SnapConfig, rulerSnapSteps } from "../../../../packages/domain/src/measurements";
import { transformLayers } from "../../../../packages/domain/src/affine";
import {
  alignLayers,
  booleanLayers,
  selectionBounds,
} from "../../../../packages/domain/src/arrange";
import {
  eraseFilled,
  eraseStroke,
} from "../../../../packages/domain/src/erase";
import {
  nineSlice,
  symbolEffect,
} from "../../../../packages/domain/src/symbols";
import {
  tracePixels,
  TraceOptions,
} from "../../../../packages/domain/src/tracing";
import {
  anchor,
  CurvePath,
  fitCurves,
  flatten,
  mapCurves,
  moveAnchor,
  nearestSegment,
  rotationFromDrag,
  snapDirection,
  smoothPath,
  splitSegment,
  simplifyPoints,
  worldPoint,
} from "../../../../packages/domain/src/curves";
import {
  construction,
  ConstructionTool,
  DEFAULT_SHAPE,
  ellipsePath,
  polyline,
  ShapeOptions,
} from "../../../../packages/domain/src/shapes";
import { Injectable, computed, signal } from "@angular/core";
import { ImportResult, importSvg } from "../../../../packages/domain/src/svg-import";
import { importDxf } from "../../../../packages/domain/src/dxf-import";
import { knifeCut, scissorCut } from "../../../../packages/domain/src/cut";
import { PdfImage, PdfPageSource, pdfDocument } from "../../../../packages/domain/src/pdf";
import { ArraySettings, arraySteps, copyLayer, validArraySettings } from "../../../../packages/domain/src/array-copy";
import {
  blankDocument,
  defaultStrokeStyle,
  StrokeStyle,
  validDashPattern,
  bounds,
  DocumentHistory,
  Layer,
  localPoint,
  newLayer,
  normalizePath,
  parseDocument,
  pick,
  Point,
  resizeLayer,
  resizeFromCorner,
  StudioDocument,
  svgExport,
} from "../../../../packages/domain/src/document";
import { CanvasRenderer } from "../../../../packages/renderer/src/canvas-renderer";
import { ToolId } from "./tools";
export type StyleScope = "fill" | "stroke" | "both";
export type ContextAction = "duplicateSeries" | "copy" | "cut" | "paste" | "pasteInFront" | "pasteInBack" | "duplicate" | "toggleBoundingBox" | "displacement" | "rotation" | "group" | "ungroup" | "regroup" | "hide" | "show" | "delete" | "backward" | "forward" | "toBack" | "toFront" | "corner" | "smooth" | "collapseIncoming" | "collapseOutgoing" | "expandIncoming" | "expandOutgoing" | "deleteNode";
export type ContextTarget = { revision: number; layerId: string } & (
  { kind: "object"; groupPath?: string[]; selectionIds?: string[] } |
  { kind: "node"; path: number; index: number }
);
/** Walls within this angle of a 45 degree direction are drawn on it, which keeps plans orthogonal. */
const WALL_ANGLE_TOLERANCE = 6 * Math.PI / 180;
const WALL_POCHE = "#3f4753";
const WALL_OUTLINE = "#161b22";
const WORKSPACE_KEY = "xds-workspace";
const MAX_TABS = 12;
interface WorkspaceTab { document: StudioDocument; history: DocumentHistory; dirty: boolean; selectedId: string | null; selectedIds: string[] }

@Injectable({ providedIn: "root" })
export class EditorService {
  contextAt(point: Point): ContextTarget | null {
    const selected = this.selected();
    if (selected && this.selectedLayers().length === 1 && selected.visible && !selected.guide && !selected.dimension && !selected.procedural && selected.curves) {
      const hit = this.findCurveNode(selected, point);
      if (hit) {
        if(!this.activeNodes().includes(hit.path + ":" + hit.index))this.activeNodes.set([hit.path + ":" + hit.index]);
        return { kind: "node", layerId: selected.id, path: hit.path, index: hit.index, revision: this.revision() };
      }
    }
    const hit = pick(this.document().layers.filter(layer=>!layer.dimension || this.dimensionsVisible()).map((layer) => ({ ...layer, locked: false })), point);
    return hit ? this.contextForLayer(hit.id) : null;
  }
  contextForLayer(id: string, selectGroup = true): ContextTarget | null {
    const layer = this.document().layers.find((item) => item.id === id);
    if (!layer) return null;
    let groupPath: string[] | undefined;
    if (selectGroup && layer.groupPath?.length) {
      groupPath = layer.groupPath.slice(0, 1);
      const selectedIds = new Set(this.selectedLayers().map((item) => item.id));
      for (let depth = 1; depth <= layer.groupPath.length; depth++) {
        const prefix = layer.groupPath.slice(0, depth);
        const members = this.document().layers.filter((item) => this.inGroup(item, prefix));
        if (members.length > 1 && members.length === selectedIds.size && members.every((item) => selectedIds.has(item.id))) groupPath = prefix;
      }
    }
    const selection = this.selectedLayers();
    const preserve = selectGroup && selection.length > 1 && selection.some((item) => item.id === id);
    const groupedMembers = groupPath ? this.document().layers.filter((item) => this.inGroup(item, groupPath!)) : [];
    const exactGroup = groupedMembers.length === selection.length && groupedMembers.every((item) => selection.some((selected) => selected.id === item.id));
    const target: ContextTarget = { kind: "object", layerId: id, revision: this.revision(),
      ...(preserve && !exactGroup ? { selectionIds: selection.map((item) => item.id) } : groupPath ? { groupPath } : {}) };
    const members = this.contextMembers(target);
    this.selectedIds.set(members.map((item) => item.id));
    this.selectedId.set(id);
    this.activeNodes.set([]);
    return target;
  }
  private inGroup(layer: Layer, prefix: string[]) {
    return prefix.every((id, index) => layer.groupPath?.[index] === id);
  }
  private contextMembers(target: ContextTarget): Layer[] {
    if (target.revision !== this.revision()) return [];
    const layer = this.document().layers.find((item) => item.id === target.layerId);
    if (!layer) return [];
    if (target.kind === "object" && target.selectionIds) return this.document().layers.filter((item) => target.selectionIds!.includes(item.id));
    return target.kind === "object" && target.groupPath?.length
      ? this.document().layers.filter((item) => this.inGroup(item, target.groupPath!)) : [layer];
  }
  private contextSiblings(target: ContextTarget): { blocks: Layer[][]; index: number; positions: number[] } {
    const members = this.contextMembers(target), first = members[0];
    if (!first || target.kind !== "object") return { blocks: [], index: -1, positions: [] };
    const parent = target.groupPath ? target.groupPath.slice(0, -1) : (first.groupPath ?? []);
    const blocks: Layer[][] = [], keys: string[] = [], positions: number[] = [];
    this.document().layers.forEach((layer, position) => {
      if (!this.inGroup(layer, parent)) return;
      const group = layer.groupPath?.[parent.length];
      const key = group ? "group:" + group : "layer:" + layer.id;
      let index = keys.indexOf(key);
      if (index < 0) { index = keys.length; keys.push(key); blocks.push([]); }
      blocks[index].push(layer);
      positions.push(position);
    });
    const ids = new Set(members.map((layer) => layer.id));
    return { blocks, positions, index: blocks.findIndex((block) => block.some((layer) => ids.has(layer.id))) };
  }
  contextActions(target: ContextTarget): { id: ContextAction; enabled: boolean }[] {
    const members = this.contextMembers(target);
    if (!members.length) return [];
    const editable = members.every((layer) => !this.isEffectivelyLocked(layer));
    if (target.kind === "node") {
      const layer = members[0], node = layer.curves?.[target.path]?.nodes[target.index];
      if (!node || layer.guide) return [];
      const collapsed = (part: "incoming" | "outgoing") => Math.hypot(node[part].x - node.point.x, node[part].y - node.point.y) < 1e-8;
      return [
        {id:"displacement",enabled:editable}, {id:"rotation",enabled:editable},
        { id: "corner", enabled: editable && node.smooth },
        { id: "smooth", enabled: editable && (!node.smooth || collapsed("incoming") || collapsed("outgoing")) },
        { id: "collapseIncoming", enabled: editable && !collapsed("incoming") },
        { id: "collapseOutgoing", enabled: editable && !collapsed("outgoing") },
        { id: "expandIncoming", enabled: editable && collapsed("incoming") },
        { id: "expandOutgoing", enabled: editable && collapsed("outgoing") },
        { id: "deleteNode", enabled: editable },
      ];
    }
    const siblings = this.contextSiblings(target);
    const groupable = members.every((layer) => !layer.guide && !this.isEffectivelyLocked(layer));
    const groups = target.groupPath ? this.document().layers.filter((layer) => this.inGroup(layer, target.groupPath!)) : this.groupingMembers(members, true);
    const canOrder = !target.selectionIds;
    const grouping: { id: ContextAction; enabled: boolean }[] = [];
    if (members.length > 1) grouping.push({ id: "group", enabled: groupable && members.every((layer) => (layer.groupPath?.length ?? 0) < 16) });
    if (members.some((layer) => layer.groupPath?.length)) grouping.push({ id: "ungroup", enabled: groups.length > 0 && groups.every((layer) => !this.isEffectivelyLocked(layer)) });
    if (members.some((layer) => layer.regroupPath?.length)) grouping.push({ id: "regroup", enabled: this.regroupMembers(members).length > 0 });
    const artwork = members.every((layer) => !layer.guide);
    return [
      { id: "copy", enabled: artwork && editable },
      { id: "cut", enabled: artwork && editable },
      { id: "paste", enabled: this.clipboard.length > 0 },
      { id: "pasteInFront", enabled: this.clipboard.length > 0 },
      { id: "pasteInBack", enabled: this.clipboard.length > 0 },
      { id: "duplicate", enabled: artwork && editable },
      { id: "duplicateSeries", enabled: artwork && editable },
      { id: "toggleBoundingBox", enabled: true },
      ...grouping,
      {id:"displacement",enabled:editable && members.every(l=>!l.guide)}, {id:"rotation",enabled:editable && members.every(l=>!l.guide)},
      { id: members.some((layer) => layer.visible) ? "hide" : "show", enabled: true },
      { id: "delete", enabled: editable },
      { id: "backward", enabled: editable && canOrder && siblings.index > 0 },
      { id: "forward", enabled: editable && canOrder && siblings.index >= 0 && siblings.index < siblings.blocks.length - 1 },
      { id: "toBack", enabled: editable && canOrder && siblings.index > 0 },
      { id: "toFront", enabled: editable && canOrder && siblings.index >= 0 && siblings.index < siblings.blocks.length - 1 },
    ];
  }
  runContextAction(target: ContextTarget, action: ContextAction): boolean {
    // The dialogs are opened by the shell, which owns them.
    if(action === "displacement" || action === "rotation" || action === "duplicateSeries")return false;
    if (!this.contextActions(target).some((entry) => entry.id === action && entry.enabled)) return false;
    const members = this.contextMembers(target), ids = new Set(members.map((layer) => layer.id));
    // The clipboard actions work on the selection, so the target becomes the selection first.
    if (["copy", "cut", "duplicate"].includes(action)) {
      this.selectedIds.set([...ids]);
      this.selectedId.set(target.layerId);
      if (action === "copy") return this.copySelection();
      if (action === "cut") return this.cutSelection();
      this.duplicate();
      return true;
    }
    if (action === "paste" || action === "pasteInFront" || action === "pasteInBack") {
      if (action !== "paste") { this.selectedIds.set([...ids]); this.selectedId.set(target.layerId); }
      return this.paste(action === "pasteInFront" ? "front" : action === "pasteInBack" ? "back" : "offset");
    }
    if (action === "toggleBoundingBox") { this.toggleBoundingBox(); return true; }
    if (action === "group" || action === "ungroup" || action === "regroup") {
      this.selectedIds.set([...ids]); this.selectedId.set(target.layerId);
      if (action === "regroup") this.regroup(); else this.group(action === "ungroup", target.kind === "object" ? target.groupPath : undefined);
      return true;
    }
    const before = structuredClone(this.document());
    if (target.kind === "node") this.contextNodeAction(target, action);
    else if (action === "hide" || action === "show") this.document.update((doc) => ({ ...doc, layers: doc.layers.map((layer) => ids.has(layer.id) ? { ...layer, visible: action === "show" } : layer) }));
    else if (action === "delete") {
      this.document.update((doc) => ({ ...doc, layers: doc.layers.filter((layer) => !ids.has(layer.id)) }));
      this.selectedIds.set([]); this.selectedId.set(null);
    } else {
      const { blocks, positions, index } = this.contextSiblings(target);
      const destination = action === "toBack" ? 0 : action === "toFront" ? blocks.length - 1 : index + (action === "backward" ? -1 : 1);
      const [block] = blocks.splice(index, 1); blocks.splice(destination, 0, block);
      const reordered = blocks.flat();
      this.document.update((doc) => {
        const layers = [...doc.layers]; positions.forEach((position, offset) => layers[position] = reordered[offset]);
        return { ...doc, layers };
      });
    }
    this.commitStep(before);
    this.changed();
    return true;
  }
  private contextNodeAction(target: Extract<ContextTarget, { kind: "node" }>, action: ContextAction) {
    const layer = this.contextMembers(target)[0], curves = structuredClone(layer.curves!);
    const path = curves[target.path], node = path.nodes[target.index];
    if (action === "deleteNode") {
      path.nodes.splice(target.index, 1);
      if (path.nodes.length < 3) path.closed = false;
      if (!path.nodes.length) curves.splice(target.path, 1);
      if (!curves.length) {
        this.document.update((doc) => ({ ...doc, layers: doc.layers.filter((item) => item.id !== layer.id) }));
        this.selectedIds.set([]); this.selectedId.set(null);
      } else this.setLayer(layer.id, fitCurves(layer, curves));
      this.activeNodes.set([]);
      return;
    }
    const previous = path.nodes[target.index - 1] ?? (path.closed ? path.nodes.at(-1) : undefined);
    const next = path.nodes[target.index + 1] ?? (path.closed ? path.nodes[0] : undefined);
    const tangent = { x: (next?.point.x ?? node.point.x) - (previous?.point.x ?? node.point.x), y: (next?.point.y ?? node.point.y) - (previous?.point.y ?? node.point.y) };
    let magnitude = Math.hypot(tangent.x, tangent.y);
    if (magnitude < 1e-8) { tangent.x = 1; tangent.y = 0; magnitude = 1; }
    const extend = (part: "incoming" | "outgoing", preserveLength: boolean) => {
      const neighbor = part === "incoming" ? previous ?? next : next ?? previous;
      const existing = Math.hypot(node[part].x - node.point.x, node[part].y - node.point.y);
      const fallback = neighbor ? Math.hypot(neighbor.point.x - node.point.x, neighbor.point.y - node.point.y) / 3 : Math.max(layer.width, layer.height) / 3;
      const length = preserveLength && existing > 1e-8 ? existing : Math.max(1, fallback);
      const sign = part === "incoming" ? -1 : 1;
      node[part] = { x: node.point.x + sign * tangent.x / magnitude * length, y: node.point.y + sign * tangent.y / magnitude * length };
    };
    if (action === "corner") node.smooth = false;
    else if (action === "smooth") { extend("incoming", true); extend("outgoing", true); node.smooth = true; }
    else {
      const part = action.endsWith("Incoming") ? "incoming" : "outgoing";
      if (action.startsWith("collapse")) node[part] = { ...node.point };
      else extend(part, false);
      node.smooth = false;
    }
    this.setLayer(layer.id, fitCurves(layer, curves));
  }
  readonly selectedBlend = computed(() => {
    const ids = this.selectedLayers().map((layer) => layer.id);
    if (!ids.length) return null;
    return this.document().blends?.find((blend) => {
      const members = new Set([...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()]);
      return ids.every((id) => members.has(id));
    }) ?? null;
  });
  readonly canCreateBlend = computed(() => this.blendCandidates() !== null);
  readonly canEditBlend = computed(() => {
    const blend = this.selectedBlend();
    return !!blend && !this.blendMembers(blend).some((layer) => layer.locked);
  });
  private blendMembers(blend: ObjectBlend): Layer[] {
    const ids = new Set([...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()]);
    return this.document().layers.filter((layer) => ids.has(layer.id));
  }
  private isEffectivelyLocked(layer: Layer): boolean {
    if (layer.locked || (layer.dimension && (this.dimensionsLocked() || !this.dimensionsVisible()))) return true;
    return this.document().blends?.some((blend) => {
      const ids = [...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()];
      return ids.includes(layer.id) && this.document().layers.some((member) => ids.includes(member.id) && member.locked);
    }) ?? false;
  }
  selectLayerExact(id: string, add = false) {
    const layer = this.document().layers.find((item) => item.id === id);
    if (!layer || !layer.visible || this.isEffectivelyLocked(layer)) return;
    const existing = add ? this.selectedLayers().map((item) => item.id) : [];
    const ids = existing.includes(id) ? existing.filter((item) => item !== id) : [...existing, id];
    this.selectedIds.set(ids); this.selectedId.set(ids.at(-1) ?? null); this.activeNodes.set([]);
    if (!layer.guide) { this.lineEnds.set(structuredClone(layer.lineEnds ?? defaultLineEnds)); this.fill.set(layer.fill); this.stroke.set(layer.stroke); this.size.set(layer.strokeWidth); this.strokeStyle.set({ ...defaultStrokeStyle, ...layer.strokeStyle }); }
  }
  selectBlendEndpoint(side: "back" | "front") {
    const blend = this.selectedBlend();
    if (!blend) return;
    const ids = side === "back" ? blend.backIds : blend.frontIds;
    this.selectedIds.set([...ids]); this.selectedId.set(ids.at(-1) ?? null); this.activeNodes.set([]);
  }
  private blendCandidates(): { back: Layer[]; front: Layer[]; parent: string[] } | null {
    const selected = this.selectedLayers();
    if (selected.length < 2 || selected.some((layer) => this.isEffectivelyLocked(layer) || layer.guide || layer.dimension || layer.procedural || !layer.visible)) return null;
    const existing = new Set(this.document().blends?.flatMap((blend) => [...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()]) ?? []);
    if (selected.some((layer) => existing.has(layer.id))) return null;
    const parent = [...(selected[0].groupPath ?? [])];
    while (parent.length && !selected.every((layer) => this.inGroup(layer, parent))) parent.pop();
    if (parent.length > 14 || selected.some((layer) => (layer.groupPath?.length ?? 0) >= 16)) return null;
    const units = new Map<string, Layer[]>();
    for (const layer of selected) {
      const group = layer.groupPath?.[parent.length], key = group ? "group:" + group : "layer:" + layer.id;
      if (!units.has(key)) units.set(key, []);
      units.get(key)!.push(layer);
    }
    if (units.size !== 2) return null;
    const [back, front] = [...units.values()];
    for (const unit of [back, front]) {
      const group = unit[0].groupPath?.[parent.length];
      if (group && this.document().layers.filter((layer) => this.inGroup(layer, [...parent, group])).length !== unit.length) return null;
    }
    try { blendCompatible(back, front); } catch { return null; }
    return { back, front, parent };
  }
  createBlend(steps = 5, easing: BlendEasing = "linear"): boolean {
    const candidates = this.blendCandidates();
    if (!candidates || !this.validBlendOptions(steps, easing)) return false;
    const { back, front, parent } = candidates;
    if (this.document().layers.length + steps * back.length > 150) return false;
    const blend: ObjectBlend = { id: crypto.randomUUID(), groupId: crypto.randomUUID(), backIds: back.map((layer) => layer.id), frontIds: front.map((layer) => layer.id), steps, easing, stepIds: Array.from({ length: steps }, () => back.map(() => crypto.randomUUID())) };
    const ids = new Set([...blend.backIds, ...blend.frontIds]);
    const insert = (layer: Layer) => ({ ...layer, groupPath: [...parent, blend.groupId, ...(layer.groupPath ?? []).slice(parent.length)] });
    const generated = blend.stepIds.flatMap((step, stepIndex) => back.map((layer, index) => ({ ...interpolateBlendLayer(layer, front[index], blendProgress((stepIndex + 1) / (steps + 1), easing), step[index]), name: `Blend step ${stepIndex + 1}`, groupPath: [...parent, blend.groupId, step[0]] })));
    const block = [...back.map(insert), ...generated, ...front.map(insert)];
    const before = this.document(), first = before.layers.findIndex((layer) => ids.has(layer.id));
    const layers = before.layers.filter((layer) => !ids.has(layer.id)); layers.splice(first, 0, ...block);
    const next = syncBlends({ ...before, layers, blends: [...(before.blends ?? []), blend] });
    this.commitStep(before); this.document.set(next);
    this.selectedIds.set(block.map((layer) => layer.id)); this.selectedId.set(front.at(-1)!.id);
    this.changed(); return true;
  }
  private validBlendOptions(steps: number, easing: string): easing is BlendEasing {
    return Number.isInteger(steps) && steps >= 1 && steps <= 100 && ["linear", "ease-in", "ease-out", "ease-in-out"].includes(easing);
  }
  updateBlend(patch: { steps?: number; easing?: BlendEasing }): boolean {
    const blend = this.selectedBlend();
    if (!blend || !this.canEditBlend()) return false;
    const steps = patch.steps ?? blend.steps, easing = patch.easing ?? blend.easing;
    if (!this.validBlendOptions(steps, easing) || (steps === blend.steps && easing === blend.easing)) return false;
    const before = this.document(), oldGenerated = new Set(blend.stepIds.flat());
    if (before.layers.length - oldGenerated.size + steps * blend.backIds.length > 150) return false;
    const nextBlend = { ...blend, steps, easing, stepIds: Array.from({ length: steps }, (_, index) => blend.stepIds[index] ?? blend.backIds.map(() => crypto.randomUUID())) };
    const source = before.layers.find((layer) => layer.id === blend.backIds[0])!;
    const parent = source.groupPath!.slice(0, source.groupPath!.indexOf(blend.groupId));
    const generated = nextBlend.stepIds.flatMap((step, stepIndex) => step.map((id, index) => ({ ...interpolateBlendLayer(before.layers.find((layer) => layer.id === blend.backIds[index])!, before.layers.find((layer) => layer.id === blend.frontIds[index])!, blendProgress((stepIndex + 1) / (steps + 1), easing), id), name: `Blend step ${stepIndex + 1}`, groupPath: [...parent, blend.groupId, step[0]] })));
    const layers = before.layers.filter((layer) => !oldGenerated.has(layer.id));
    const position = layers.findIndex((layer) => layer.id === blend.frontIds[0]); layers.splice(position, 0, ...generated);
    const next = syncBlends({ ...before, layers, blends: before.blends!.map((item) => item.id === blend.id ? nextBlend : item) });
    this.commitStep(before);
    this.document.set(next);
    const remaining = new Set(this.document().layers.map((layer) => layer.id));
    this.selectedIds.update((ids) => ids.filter((id) => remaining.has(id)));
    if (!remaining.has(this.selectedId() ?? "")) this.selectedId.set(blend.frontIds[0]);
    this.changed(); return true;
  }
  expandBlend(): boolean {
    const blend = this.selectedBlend();
    if (!blend || !this.canEditBlend()) return false;
    this.commitStep(this.document());
    this.document.update((doc) => ({ ...doc, blends: doc.blends!.filter((item) => item.id !== blend.id) }));
    this.changed(); return true;
  }
  releaseBlend(): boolean {
    const blend = this.selectedBlend();
    if (!blend || !this.canEditBlend()) return false;
    const generated = new Set(blend.stepIds.flat()), endpoints = new Set([...blend.backIds, ...blend.frontIds]);
    this.commitStep(this.document());
    this.document.update((doc) => ({ ...doc, blends: doc.blends!.filter((item) => item.id !== blend.id), layers: doc.layers.filter((layer) => !generated.has(layer.id)).map((layer) => endpoints.has(layer.id) ? { ...layer, groupPath: (layer.groupPath ?? []).filter((id) => id !== blend.groupId) } : layer) }));
    this.selectedIds.set([...endpoints]); this.selectedId.set(blend.frontIds.at(-1) ?? null);
    this.changed(); return true;
  }

  readonly proceduralDefaults = signal<Record<Procedural['type'],Procedural>>({wall:defaultProcedural('wall'),door:defaultProcedural('door'),window:defaultProcedural('window'),pillar:defaultProcedural('pillar'),stair:defaultProcedural('stair')});
  private proceduralGesture?: {before:StudioDocument;start:Point;type:'wall'|'pillar'|'stair';id:string;selectedId:string|null;selectedIds:string[]};
  updateProceduralDefaults(type:Procedural['type'],patch:Record<string,unknown>):boolean {
    const value=this.proceduralPatch(this.proceduralDefaults()[type],patch);if(!validProcedural(value))return false;
    this.proceduralDefaults.update(all=>({...all,[type]:value}));return true;
  }
  private proceduralPatch(value:Procedural,patch:Record<string,unknown>):Procedural {
    const next={...value,...patch,type:value.type} as Procedural;
    // An explicit undefined clears an optional parameter instead of storing an empty key.
    for(const key of Object.keys(patch))if(patch[key]===undefined)delete (next as unknown as Record<string,unknown>)[key];
    if((next.type==='door'||next.type==='window')&&(value.type==='door'||value.type==='window')&&patch['width']!==undefined&&patch['leafWidths']===undefined)next.leafWidths=value.leafWidths.map(w=>w*next.width/value.width);
    if(next.type==='pillar'&&next.shape==='circle'){if(patch['depth']!==undefined&&patch['width']===undefined)next.width=next.depth;else next.depth=next.width;}
    return next;
  }
  updateProcedural(patch:Record<string,unknown>):boolean {
    const layer=this.selected();if(!layer?.procedural||this.isEffectivelyLocked(layer))return false;
    const procedural=this.proceduralPatch(layer.procedural,patch);if(!validProcedural(procedural))return false;
    let next:StudioDocument;try{next=syncProcedurals({...this.document(),layers:this.document().layers.map(l=>l.id===layer.id?{...l,procedural}:l)});parseDocument(JSON.stringify(next));}catch{return false;}
    this.commitStep(this.document());this.document.set(next);const defaults=structuredClone(procedural);if(defaults.type==='door'||defaults.type==='window')delete defaults.host;
    this.proceduralDefaults.update(all=>({...all,[procedural.type]:defaults}));this.changed();return true;
  }
  /** Point where the next wall of a run starts; cleared when the run ends. */
  readonly wallChain = signal<Point|null>(null);
  readonly wallSnapTarget = signal<WallSnap|null>(null);
  /** Wall ends and axes take priority over the ordinary grid snap so runs share exact joints. */
  wallPoint(point:Point,exclude?:string):Point {
    const target=wallSnapPoint(this.document().layers,point,12/this.zoom(),exclude);
    this.wallSnapTarget.set(target);
    return target?.point??this.snap(point);
  }
  hoverWall(point:Point) { if(this.tool()==='wall'&&!this.proceduralGesture)this.wallTarget(this.wallChain(),point); }
  /** Where the wall being drawn ends: a wall joint when one is near, otherwise a point that leans to 45 degrees. */
  wallTarget(start:Point|null,point:Point,exclude?:string):Point {
    const snapped=this.wallPoint(point,exclude);
    if(this.wallSnapTarget()||!start)return snapped;
    const dx=point.x-start.x,dy=point.y-start.y;
    if(Math.hypot(dx,dy)<1e-6)return snapped;
    const step=Math.PI/4,angle=Math.atan2(dy,dx),nearest=Math.round(angle/step)*step;
    let difference=Math.abs(angle-nearest);
    if(difference>Math.PI)difference=Math.PI*2-difference;
    return difference<=WALL_ANGLE_TOLERANCE?snapDirection(start,point,45):snapped;
  }
  private proceduralLayer(type:Procedural['type'],start:Point,end?:Point,id:string=crypto.randomUUID()):Layer {
    let procedural=structuredClone(this.proceduralDefaults()[type]);
    // Architectural defaults: walls read as solid construction, openings as outlines.
    const paint=type==='door'||type==='window'?{fill:'none',stroke:WALL_OUTLINE}:{fill:WALL_POCHE,stroke:WALL_OUTLINE};
    let layer={...newLayer('path',id,start,paint.fill,paint.stroke,Math.min(this.size(),2)),strokeStyle:{alignment:'center' as const,join:'miter' as const,cap:'butt' as const}};
    if(type==='wall'&&procedural.type==='wall'){const b=end??{x:start.x+1,y:start.y};procedural={...procedural,start:{x:0,y:0},end:{x:b.x-start.x,y:b.y-start.y}};}
    if(type==='pillar'&&procedural.type==='pillar'&&end){const box=bounds(start,end);layer={...layer,...box};procedural={...procedural,width:Math.max(1,box.width),depth:Math.max(1,box.height)};if(procedural.shape==='circle')procedural.depth=procedural.width;}
    if(type==='stair'&&procedural.type==='stair'&&end){const box=bounds(start,end);layer={...layer,...box};procedural={...procedural,width:Math.max(1,box.width),length:Math.max(1,box.height)};}
    if(procedural.type==='door'||procedural.type==='window'){const host=openingHost(this.document().layers,start,procedural.width,12/this.zoom());if(host)procedural.host=host;else delete procedural.host;layer.x=start.x-procedural.width/2;layer.y=start.y-procedural.depth/2;}
    layer.name=type[0].toUpperCase()+type.slice(1);layer.procedural=procedural;return generateProcedural(layer,this.document());
  }
  createProcedural(type:Procedural['type'],start:Point,end?:Point):boolean {
    if(this.document().layers.length>=150)return false;
    let layer:Layer,next:StudioDocument;try{layer=this.proceduralLayer(type,start,end);next=syncProcedurals({...this.document(),layers:[...this.document().layers,layer]});parseDocument(JSON.stringify(next));}catch{return false;}
    this.commitStep(this.document());this.document.set(next);this.selectedId.set(layer.id);this.selectedIds.set([layer.id]);this.changed();return true;
  }
  private startProcedural(type:Procedural['type'],point:Point) {
    if(type==='door'||type==='window'){this.createProcedural(type,this.snap(point));return;}
    if(this.document().layers.length>=150)return;
    if(type==='wall'){
      const chain=this.wallChain(),target=this.wallTarget(this.wallChain(),point);
      if(chain&&Math.hypot(target.x-chain.x,target.y-chain.y)>=1){
        if(this.createProcedural('wall',chain,target))this.wallChain.set(target);
        return;
      }
      this.wallChain.set(target);
      this.proceduralGesture={before:structuredClone(this.document()),start:target,type,id:crypto.randomUUID(),selectedId:this.selectedId(),selectedIds:[...this.selectedIds()]};
      return;
    }
    point=this.snap(point);
    this.proceduralGesture={before:structuredClone(this.document()),start:point,type,id:crypto.randomUUID(),selectedId:this.selectedId(),selectedIds:[...this.selectedIds()]};
  }
  /** Ends an open wall run without removing what it already drew. */
  finishWallRun() { this.wallChain.set(null); this.wallSnapTarget.set(null); }
  private detachUnselectedHost(layer:Layer,ids:Set<string>):Layer {
    const p=layer.procedural;return (p?.type==='door'||p?.type==='window')&&p.host&&!ids.has(p.host.wallId)?this.detachOpening(layer):layer;
  }
  private detachOpening(layer:Layer):Layer {
    const p=layer.procedural;if((p?.type==='door'||p?.type==='window')&&p.host){const procedural={...p};delete procedural.host;return {...layer,procedural};}return layer;
  }

  // Transform pivot: the point scaling, rotation and mirroring work about.
  readonly pivotVisible = signal(true);
  readonly pivotLocked = signal(false);
  readonly pivotSnap = signal(true);
  private readonly pivotOverride = signal<{ key: string; point: Point } | null>(null);
  private pivotGesture?: { before: { key: string; point: Point } | null };
  /** Where a pivot placed by hand stood when the current move started. */
  private movePivot?: Point;
  readonly selectionKey = computed(() => this.selectedLayers().map((layer) => layer.id).sort().join(","));
  /** The moved pivot while the same objects stay selected; otherwise the geometric centre. */
  readonly pivot = computed<Point>(() => {
    const override = this.pivotOverride();
    return override && override.key === this.selectionKey() ? override.point : this.transformationCenter();
  });
  readonly pivotMoved = computed(() => this.pivotOverride()?.key === this.selectionKey());
  /**
   * Carries a pivot placed by hand to the selection that replaces the old one, so a copy
   * keeps turning and scaling around the point its original did.
   */
  private carryPivot(point: Point | null) {
    if (point) this.setPivot(point);
  }
  setPivot(point: Point) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !this.selectedLayers().length) return;
    this.pivotOverride.set({ key: this.selectionKey(), point });
  }
  resetPivot() { this.pivotOverride.set(null); }
  /**
   * Magnetism for the pivot: the centre of the selection, then the corners, edge middles
   * and edges of its box, then vertices and edges of other artwork, then the active aids.
   */
  pivotPoint(point: Point): Point {
    if (!this.pivotSnap()) return point;
    const radius = this.dimensionSnapRadius() / this.zoom();
    const distance = (candidate: Point) => Math.hypot(point.x - candidate.x, point.y - candidate.y);
    const centre = this.transformationCenter();
    if (distance(centre) <= radius) return centre;
    const box = selectionBounds(this.selectedLayers().filter((layer) => !layer.guide));
    const singular: Point[] = [];
    if (box.width || box.height) {
      const left = box.x, right = box.x + box.width, top = box.y, bottom = box.y + box.height;
      const middleX = box.x + box.width / 2, middleY = box.y + box.height / 2;
      singular.push(
        { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
        { x: middleX, y: top }, { x: right, y: middleY }, { x: middleX, y: bottom }, { x: left, y: middleY },
      );
    }
    const nearest = singular.filter((candidate) => distance(candidate) <= radius).sort((a, b) => distance(a) - distance(b))[0];
    if (nearest) return nearest;
    if (box.width || box.height) {
      // The sides of the box attract as lines, not only at their singular points.
      const edges: [Point, Point][] = [
        [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }],
        [{ x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }],
        [{ x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }],
        [{ x: box.x, y: box.y + box.height }, { x: box.x, y: box.y }],
      ];
      const projections = edges.map(([a, b]) => {
        const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
        return { x: a.x + dx * t, y: a.y + dy * t };
      }).filter((candidate) => distance(candidate) <= radius).sort((a, b) => distance(a) - distance(b));
      if (projections[0]) return projections[0];
    }
    const target = snapDimensionPoint(this.document().layers, point, radius, true);
    return target?.point ?? this.snap(point);
  }
  /**
   * The handle can be grabbed whenever it is shown, unlocked and something is selected, with the
   * selection and transform tools. A locked pivot never takes a press, so the artwork moves.
   */
  readonly pivotGrabbable = computed(() =>
    this.pivotVisible() && !this.pivotLocked() && this.selectedLayers().length > 0 &&
    ["select", "rotate", "scale", "mirror"].includes(this.tool()));
  /** Half the extent of the drawn mark, the box inside which a press belongs to the pivot. */
  private pivotReach() { return 9 / this.zoom(); }
  /**
   * The pivot belongs to the selection, so a translation of the artwork carries it along; only a
   * press on its own mark, which a locked pivot never takes, moves it away from the objects.
   */
  private shiftPivot(dx: number, dy: number) {
    const override = this.pivotOverride();
    if (!override || override.key !== this.selectionKey()) return;
    this.pivotOverride.set({ key: override.key, point: { x: override.point.x + dx, y: override.point.y + dy } });
  }
  /**
   * A double press on the mark returns the pivot to the geometric centre of the selection.
   * Returns whether the press was taken, so the canvas leaves the artwork alone when it was.
   */
  resetPivotAt(point: Point): boolean {
    if (!this.pivotGrabbable() || !this.pivotMoved()) return false;
    const pivot = this.pivot();
    if (Math.abs(point.x - pivot.x) > this.pivotReach() || Math.abs(point.y - pivot.y) > this.pivotReach()) return false;
    this.resetPivot();
    this.revision.update((x) => x + 1);
    return true;
  }
  private startPivotDrag(point: Point): boolean {
    if (!this.pivotGrabbable()) return false;
    // A press inside the mark takes the pivot; anywhere else moves the artwork and the pivot with it.
    const pivot = this.pivot();
    if (Math.abs(point.x - pivot.x) > this.pivotReach() || Math.abs(point.y - pivot.y) > this.pivotReach()) return false;
    this.pivotGesture = { before: this.pivotOverride() };
    this.setPivot(this.pivotPoint(point));
    return true;
  }
  readonly dimensionsVisible = signal(true);
  readonly dimensionsLocked = signal(false);
  readonly dimensionsSnap = signal(true);
  readonly dimensionSnapRadius = signal(10);
  readonly dimensionDefaults = signal<DimensionFormat>({ ...defaultDimensionFormat });
  /** While on, a measurement format edit applies to every dimension in the document. */
  readonly unifyDimensionFormat = signal(false);
  setUnifyDimensionFormat(value:boolean) {
    this.unifyDimensionFormat.set(value);
    if(value)this.applyFormatToDimensions(this.selected()?.dimension?.format??this.dimensionDefaults());
  }
  private applyFormatToDimensions(format:DimensionFormat):boolean {
    const before=this.document();
    const layers=before.layers.map(layer=>layer.dimension&&!this.isEffectivelyLocked(layer)
      ?{...layer,dimension:{...layer.dimension,format:{...format,...(layer.dimension.kind==='angular'?{unit:layer.dimension.format.unit}:{})}}}
      :layer);
    if(JSON.stringify(layers)===JSON.stringify(before.layers))return false;
    try{parseDocument(JSON.stringify({...before,layers}));}catch{return false;}
    this.commitStep(before);this.document.set({...before,layers});this.dimensionDefaults.set({...format});this.changed();return true;
  }
  readonly lineEnds = signal<LineEnds>(structuredClone(defaultLineEnds));
  readonly dimensionDraft = signal<{kind:'linear'|'angular'|'chain'|'radius'|'diameter';points:Point[];cursor:Point;ready?:boolean} | null>(null);
  readonly dimensionSnapTarget = signal<DimensionSnap | null>(null);
  private dimensionLabelGesture?: {before:StudioDocument;id:string};
  setDimensionsLocked(value:boolean) { this.dimensionsLocked.set(value); if(value&&this.dimensionLabelGesture)this.cancel(); }
  /** Label placement lines up with a parallel dimension already in the drawing when magnetism is on. */
  dimensionOffsetPoint(anchors:Point[],point:Point):Point {
    if(!this.dimensionsSnap())return point;
    return snapDimensionOffset(this.document().layers,anchors,point,this.dimensionSnapRadius()/this.zoom())??point;
  }
  private dimensionPoint(point:Point,finalAnchor:boolean):Point {
    const target=this.dimensionsSnap()?snapDimensionPoint(this.document().layers,point,this.dimensionSnapRadius()/this.zoom(),finalAnchor):null;
    this.dimensionSnapTarget.set(target);return target?.point??this.snap(point);
  }
  /** One offset line shared by consecutive measurements, committed as a single history entry. */
  createChainDimension(points:Point[],labelPosition:Point):boolean {
    if(points.length<3||this.document().layers.length+points.length-1>150)return false;
    const layers:Layer[]=[];
    for(let i=0;i<points.length-1;i++){
      const layer=this.buildDimension('linear',[points[i],points[i+1]],labelPosition,crypto.randomUUID());
      if(!layer)return false;
      layers.push(layer);
    }
    const before=this.document();
    let next:StudioDocument;
    try{next=syncProcedurals({...before,layers:[...before.layers,...layers]});parseDocument(JSON.stringify(next));}catch{return false;}
    this.commitStep(before);this.document.set(next);
    this.selectedIds.set(layers.map(l=>l.id));this.selectedId.set(layers.at(-1)!.id);this.changed();return true;
  }
  private startChainDimension(point:Point) {
    const draft=this.dimensionDraft();
    if(!draft||draft.kind!=='chain'){const p=this.dimensionPoint(point,true);this.dimensionDraft.set({kind:'chain',points:[p],cursor:p});return;}
    if(draft.ready){
      if(this.createChainDimension(draft.points,this.dimensionOffsetPoint(draft.points,point))){this.dimensionDraft.set(null);this.dimensionSnapTarget.set(null);}
      return;
    }
    const p=this.dimensionPoint(point,true),last=draft.points.at(-1)!;
    // Clicking the last point again closes the chain and asks for the offset.
    if(Math.hypot(p.x-last.x,p.y-last.y)<1e-6){
      if(draft.points.length>=3)this.dimensionDraft.set({...draft,ready:true,cursor:p});
      return;
    }
    if(draft.points.length>=12)return;
    this.dimensionDraft.set({...draft,points:[...draft.points,p],cursor:p});
  }
  private startDimension(point:Point,kind:'linear'|'angular'|'radius'|'diameter') {
    let draft=this.dimensionDraft();if(draft&&draft.kind!==kind)draft=null;
    const count=kind==='angular'?3:2;
    if(!draft){const p=this.dimensionPoint(point,true);this.dimensionDraft.set({kind,points:[p],cursor:p});return;}
    if(draft.points.length<count){const p=this.dimensionPoint(point,true);if(draft.points.some(previous=>Math.hypot(p.x-previous.x,p.y-previous.y)<1e-6))return;this.dimensionDraft.set({...draft,points:[...draft.points,p],cursor:p});return;}
    this.createDimension(kind,draft.points,this.dimensionOffsetPoint(draft.points,point));this.dimensionDraft.set(null);this.dimensionSnapTarget.set(null);
  }
  /** Snapped hover target while a dimension tool waits for an anchor; placement of the label is free. */
  hoverDimension(point:Point) {
    const draft=this.dimensionDraft(),count=draft?.kind==='chain'?Infinity:(draft?.kind==='angular'?3:2);
    if(draft&&(draft.ready===true||draft.points.length>=count)){this.dimensionSnapTarget.set(null);return;}
    this.dimensionPoint(point,true);
  }
  /** Live annotation shown once every anchor is fixed, so the offset and label side are visible before the last click. */
  readonly dimensionPreview=computed<Layer|null>(()=>{
    const draft=this.dimensionDraft();
    if(!draft)return null;
    if(draft.kind==='chain')return draft.ready?this.buildDimension('linear',[draft.points[0],draft.points.at(-1)!],draft.cursor,'__dimension_preview__'):null;
    if(draft.points.length<(draft.kind==='angular'?3:2))return null;
    return this.buildDimension(draft.kind,draft.points,draft.cursor,'__dimension_preview__');
  });
  private buildDimension(kind:Dimension['kind'],anchors:Point[],labelPosition:Point,id:string):Layer|null {
    if(anchors.length!==(kind==='angular'?3:2)||[...anchors,labelPosition].some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
    if(Math.hypot(anchors[1].x-anchors[0].x,anchors[1].y-anchors[0].y)<1e-6)return null;
    const points=[...anchors,labelPosition],x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    const local=(p:Point)=>({x:p.x-x,y:p.y-y});
    // Extension gap ~1.5 mm and overshoot ~2 mm at 96 ppi (ASME Y14.2 / ISO 129-1 practice).
    return {...newLayer('path',id,{x,y},this.stroke(),this.stroke(),Math.min(this.size(),2)),name:kind==='linear'?'Linear dimension':kind==='angular'?'Angular dimension':kind==='radius'?'Radius dimension':'Diameter dimension',width:Math.max(1,...points.map(p=>p.x-x)),height:Math.max(1,...points.map(p=>p.y-y)),fontSize:14,points:anchors.map(local),lineEnds:{start:{kind:'triangle',placement:'tip',size:10},end:{kind:'triangle',placement:'tip',size:10},linked:true},dimension:{kind,anchors:anchors.map(local),labelPosition:local(labelPosition),text:'',labelSize:{width:160,height:40},format:{...this.dimensionDefaults()},extension:{stroke:this.stroke(),strokeWidth:1,gap:6,overshoot:8}}};
  }
  createDimension(kind:Dimension['kind'],anchors:Point[],labelPosition:Point):boolean {
    if(this.document().layers.length>=150)return false;
    const layer=this.buildDimension(kind,anchors,labelPosition,crypto.randomUUID());if(!layer)return false;
    try{parseDocument(JSON.stringify({...this.document(),layers:[...this.document().layers,layer]}));}catch{return false;}
    this.commitStep(this.document());this.document.update(d=>({...d,layers:[...d.layers,layer]}));this.selectedId.set(layer.id);this.selectedIds.set([layer.id]);this.changed();return true;
  }
  updateDimension(patch:Partial<Dimension>) {
    const selected=this.selected();if(!selected?.dimension||this.isEffectivelyLocked(selected))return;
    const dimension={...selected.dimension,...patch};
    try{parseDocument(JSON.stringify({...this.document(),layers:this.document().layers.map(l=>l.id===selected.id?{...l,dimension}:l)}));}catch{return;}
    if(JSON.stringify(dimension)===JSON.stringify(selected.dimension))return;
    this.commitStep(this.document());this.setLayer(selected.id,{dimension});this.dimensionDefaults.set({...dimension.format});this.changed();
    if(patch.format&&this.unifyDimensionFormat())this.applyFormatToDimensions(dimension.format);
  }
  setLineEnds(patch:Partial<LineEnds>) {
    const value={...this.lineEnds(),...patch};
    if(value.linked){if(patch.end&&!patch.start)value.start={...value.end};else value.end={...value.start};}
    try{if(!validLineEnds(value))return;}catch{return;}
    this.lineEnds.set(structuredClone(value));this.applyAppearance({lineEnds:value});
  }

  readonly guidesLocked = signal(false);
  setGuidesLocked(locked: boolean) {
    this.guidesLocked.set(locked);
    if (locked && this.guideGesture?.before.layers.some((layer) => layer.id === this.guideGesture?.id)) this.cancelGuideDrag();
  }
  readonly snapAngle = signal(45);
  readonly snapConfig = signal<SnapConfig | null>(null);
  snap(point: Point): Point {
    const config = this.snapConfig();
    return config ? snapPoint(point, { ...config, zoom: this.zoom() }) : point;
  }
  private snapMovement(original: Layer, dx: number, dy: number): Point {
    const box = selectionBounds([original]);
    let correctionX = Infinity, correctionY = Infinity;
    for (const fraction of [0, 0.5, 1]) {
      const point = { x: box.x + box.width * fraction + dx, y: box.y + box.height * fraction + dy };
      const snapped = this.snap(point);
      const x = snapped.x - point.x, y = snapped.y - point.y;
      if ((x !== 0 || this.isSnapTarget("x", point.x)) && Math.abs(x) < Math.abs(correctionX)) correctionX = x;
      if ((y !== 0 || this.isSnapTarget("y", point.y)) && Math.abs(y) < Math.abs(correctionY)) correctionY = y;
    }
    return { x: dx + (Number.isFinite(correctionX) ? correctionX : 0), y: dy + (Number.isFinite(correctionY) ? correctionY : 0) };
  }
  private isSnapTarget(axis: "x" | "y", value: number): boolean {
    const config = this.snapConfig();
    if (!config) return false;
    if (config.guides.enabled && config.guides.visible && config.guides.items.some((guide) => guide.axis === axis && Math.abs(guide.position - value) < 1e-8)) return true;
    const steps = [...rulerSnapSteps(config.rulers), ...(config.grid.enabled && config.grid.visible ? [config.grid.step] : [])];
    return steps.some((step) => Number.isFinite(step) && step > 0 && Math.abs(Math.round(value / step) * step - value) < 1e-8);
  }
  readonly shapeOptions = signal<ShapeOptions>({ ...DEFAULT_SHAPE });
  readonly activeNodes = signal<string[]>([]);
  readonly penId = signal<string | null>(null);
  readonly activeSymbol = signal<string | null>(null);
  readonly symbolRadius = signal(70);
  readonly symbolIntensity = signal(0.25);
  readonly showHandles = signal(true);
  /** The frame and handles around the selection, which can be hidden while drawing. */
  readonly boundingBoxVisible = signal(true);
  toggleBoundingBox() {
    this.boundingBoxVisible.update((visible) => !visible);
    this.status.set(this.boundingBoxVisible() ? "Bounding box shown" : "Bounding box hidden");
    this.revision.update((x) => x + 1);
  }
  readonly handleSize = signal(4);
  readonly document = signal<StudioDocument>(blankDocument());
  readonly selectedId = signal<string | null>(null);
  readonly tool = signal<ToolId>("select");
  readonly styleScope = signal<StyleScope>("both");
  readonly strokeStyle = signal<StrokeStyle>({ ...defaultStrokeStyle });
  readonly fill = signal("#0d59f2");
  readonly stroke = signal("#163363");
  readonly size = signal(4);
  readonly zoom = signal(0.7);
  readonly status = signal("Ready to create");
  readonly revision = signal(0);
  readonly selectedIds = signal<string[]>([]);
  readonly selectedLayers = computed(() => {
    const primary = this.selectedId(),
      ids = this.selectedIds();
    return this.document().layers.filter((l) =>
      ids.includes(primary ?? "") ? ids.includes(l.id) : l.id === primary,
    );
  });
  readonly selectionLayer = computed(() => {
    const layers = this.selectedLayers().filter((layer) => !layer.guide);
    return layers.length > 1
      ? {
          ...newLayer("rectangle", "__selection__", { x: 0, y: 0 }),
          ...selectionBounds(layers),
        }
      : (layers[0]?.guide ? null : (layers[0] ?? null));
  });
  readonly selected = computed(
    () =>
      this.document().layers.find((l) => l.id === this.selectedId()) ?? null,
  );
  history = new DocumentHistory();
  readonly renderer = new CanvasRenderer();
  painting?: { id: string; canvas: HTMLCanvasElement };
  // Brush and eraser keep their own tip settings.
  readonly brushSettings = signal<Record<"brush" | "eraser", BrushSettings>>({ brush: { ...defaultBrush }, eraser: { ...defaultBrush } });
  brushFor(tool: "brush" | "eraser") { return this.brushSettings()[tool]; }
  updateBrush(tool: "brush" | "eraser", patch: Partial<BrushSettings>): boolean {
    const next = { ...this.brushSettings()[tool], ...patch };
    if (!validBrushSettings(next)) return false;
    this.brushSettings.update((all) => ({ ...all, [tool]: next }));
    return true;
  }
  /** Brush subtools pick a tip shape and switch to the brush itself. */
  setBrushType(type: BrushType) { if (BRUSH_TYPES.includes(type)) this.updateBrush("brush", { type }); }
  private guideGesture?: { before: StudioDocument; id: string; selectedId: string | null; selectedIds: string[] };

  private applyAppearance(patch: Partial<Layer>) {
    const ids = new Set(this.selectedLayers().filter((layer) => !this.isEffectivelyLocked(layer) && !layer.guide).map((layer) => layer.id));
    const changes = this.document().layers.some((layer) => ids.has(layer.id) && Object.entries(patch).some(([key, value]) => layer[key as keyof Layer] !== value));
    if (!changes) return;
    this.commitStep(this.document());
    this.expandGeneratedForIds(ids);
    this.document.update((doc) => ({ ...doc, layers: doc.layers.map((layer) => ids.has(layer.id) ? { ...layer, ...patch } : layer) }));
    this.changed();
  }
  setStrokeStyle(patch: Partial<StrokeStyle>) {
    if (patch.dash !== undefined && patch.dash.length && !validDashPattern(patch.dash)) return;
    if (patch.alignment !== undefined && !["center", "inside", "outside"].includes(patch.alignment)) return;
    if (patch.join !== undefined && !["round", "bevel", "miter"].includes(patch.join)) return;
    if (patch.cap !== undefined && !["butt", "square", "round"].includes(patch.cap)) return;
    const strokeStyle = { ...this.strokeStyle(), ...patch };
    this.strokeStyle.set(strokeStyle);
    const ids = new Set(this.selectedLayers().filter((layer) => !this.isEffectivelyLocked(layer) && !layer.guide).map((layer) => layer.id));
    const before = this.document();
    const layers = before.layers.map((layer) => ids.has(layer.id) ? { ...layer, strokeStyle: { ...defaultStrokeStyle, ...layer.strokeStyle, ...patch } } : layer);
    if (JSON.stringify(layers) === JSON.stringify(before.layers)) return;
    this.commitStep(before); this.expandGeneratedForIds(ids); this.document.set({ ...this.document(), layers }); this.changed();
  }
  private scopedStyle(fill: string, stroke: string, strokeWidth: number, strokeStyle: StrokeStyle, lineEnds: LineEnds = this.lineEnds()): Partial<Layer> {
    const scope = this.styleScope();
    return { ...(scope !== "stroke" ? { fill } : {}), ...(scope !== "fill" ? { stroke, strokeWidth, strokeStyle: { ...strokeStyle }, lineEnds: structuredClone(lineEnds) } : {}) };
  }
  private applyStyleTo(ids: Set<string>, patch: Partial<Layer>): boolean {
    const before = this.document();
    const layers = before.layers.map((layer) => ids.has(layer.id) ? { ...layer, ...structuredClone(patch) } : layer);
    if (JSON.stringify(layers) === JSON.stringify(before.layers)) return false;
    this.commitStep(before);
    this.expandGeneratedForIds(ids);
    this.document.set({ ...this.document(), layers });
    this.changed();
    return true;
  }
  sampleStyle(point: Point): boolean {
    const source = pick(this.document().layers.filter(layer=>!layer.dimension || this.dimensionsVisible()).map((layer) => ({ ...layer, locked: false })), point);
    if (!source || source.guide || source.kind === "image") return false;
    const patch = this.scopedStyle(source.fill, source.stroke, source.strokeWidth, { ...defaultStrokeStyle, ...source.strokeStyle }, source.lineEnds ?? defaultLineEnds);
    if (patch.fill !== undefined) this.fill.set(patch.fill);
    if (patch.stroke !== undefined) {
      this.stroke.set(patch.stroke); this.size.set(patch.strokeWidth!); this.strokeStyle.set({ ...patch.strokeStyle! }); this.lineEnds.set(structuredClone(patch.lineEnds!));
    }
    const targets = new Set(this.selectedLayers().filter((layer) => layer.id !== source.id && !layer.guide && !this.isEffectivelyLocked(layer) && layer.kind !== "image").map((layer) => layer.id));
    this.applyStyleTo(targets, patch);
    return true;
  }
  applyStyleAt(point: Point): boolean {
    const target = pick(this.document().layers.filter(layer=>!layer.dimension || this.dimensionsVisible()).map((layer) => ({ ...layer, locked: false })), point);
    if (!target || target.locked || target.guide || target.kind === "image") return false;
    const root = target.groupPath?.[0];
    const members = this.document().layers.filter((layer) => root ? layer.groupPath?.[0] === root : layer.id === target.id);
    if (members.some((layer) => layer.locked)) return false;
    const ids = new Set(members.filter((layer) => !layer.guide && layer.kind !== "image").map((layer) => layer.id));
    const patch = this.scopedStyle(this.fill(), this.stroke(), this.size(), this.strokeStyle());
    const changed = this.applyStyleTo(ids, patch);
    this.selectedIds.set([...ids]); this.selectedId.set(target.id);
    this.activeNodes.set([]);
    return changed;
  }
  setPaint(target: "fill" | "stroke", color: string) {
    if (color !== "none" && color !== "transparent" && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return;
    this[target].set(color === "transparent" ? "none" : color);
    this.applyAppearance({ [target]: this[target]() });
  }
  swapPaint() {
    const fill = this.fill();
    this.fill.set(this.stroke());
    this.stroke.set(fill);
    this.applyAppearance({ fill: this.fill(), stroke: this.stroke() });
  }
  setStrokeWidth(width: number) {
    if (!Number.isFinite(width) || width < 0 || width > 200) return;
    this.size.set(width);
    this.applyAppearance({ strokeWidth: width });
  }
  beginGuideDrag(axis: "vertical" | "horizontal", position: number, id?: string): string | null {
    if (!Number.isFinite(position)) return null;
    this.cancelGuideDrag();
    const doc = this.document();
    const existing = id ? doc.layers.find((layer) => layer.id === id && layer.guide === axis) : undefined;
    if ((id && (this.guidesLocked() || !existing || existing.locked || !existing.visible)) || (!id && doc.layers.length >= 150)) return null;
    const guide = existing ?? { ...newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }, "none", "#00b8d9", 1), guide: axis, name: axis === "vertical" ? "Vertical guide" : "Horizontal guide", width: 1, height: 1 };
    this.guideGesture = { before: structuredClone(doc), id: guide.id, selectedId: this.selectedId(), selectedIds: [...this.selectedIds()] };
    if (!existing) this.document.update((value) => ({ ...value, layers: [...value.layers, guide] }));
    this.updateGuideDrag(position);
    return guide.id;
  }
  updateGuideDrag(position: number) {
    const gesture = this.guideGesture;
    if (!gesture || !Number.isFinite(position)) return;
    if (this.guidesLocked() && gesture.before.layers.some((layer) => layer.id === gesture.id)) { this.cancelGuideDrag(); return; }
    const guide = this.document().layers.find((layer) => layer.id === gesture.id)!;
    this.setLayer(guide.id, guide.guide === "vertical" ? { x: position } : { y: position });
    this.revision.update((value) => value + 1);
  }
  endGuideDrag(inside: boolean) {
    const gesture = this.guideGesture;
    if (!gesture) return;
    if (this.guidesLocked() && gesture.before.layers.some((layer) => layer.id === gesture.id)) { this.cancelGuideDrag(); return; }
    if (!inside) this.document.update((doc) => ({ ...doc, layers: doc.layers.filter((layer) => layer.id !== gesture.id) }));
    if (JSON.stringify(gesture.before) !== JSON.stringify(this.document())) {
      this.commitStep(gesture.before);
      this.changed();
    }
    if (!inside && this.selectedId() === gesture.id) {
      this.selectedId.set(null);
      this.selectedIds.update((ids) => ids.filter((id) => id !== gesture.id));
    }
    this.guideGesture = undefined;
  }
  cancelGuideDrag() {
    const gesture = this.guideGesture;
    if (!gesture) return;
    this.document.set(gesture.before);
    this.selectedId.set(gesture.selectedId);
    this.selectedIds.set(gesture.selectedIds);
    this.guideGesture = undefined;
    this.revision.update((value) => value + 1);
  }
  reorderLayer(sourceId: string, targetId: string, placement: "before" | "after" = "before") {
    const original = this.document().layers;
    const source = original.find((layer) => layer.id === sourceId), target = original.find((layer) => layer.id === targetId);
    if (!source || !target || sourceId === targetId) return;
    const root = source.groupPath?.[0], targetRoot = target.groupPath?.[0];
    const selected = new Set(this.selectedLayers().map((layer) => layer.id));
    const roots = new Set(original.filter((layer) => selected.has(layer.id)).map((layer) => layer.groupPath?.[0]).filter(Boolean));
    const moving = original.filter((layer) => (root && layer.groupPath?.[0] === root) || layer.id === sourceId || (selected.has(sourceId) && (selected.has(layer.id) || (layer.groupPath?.[0] && roots.has(layer.groupPath[0])))));
    const ids = new Set(moving.map((layer) => layer.id));
    if (ids.has(targetId) || moving.some((layer) => layer.locked)) return;
    const remaining = original.filter((layer) => !ids.has(layer.id));
    const targetIndices = remaining.map((layer, index) => (targetRoot ? layer.groupPath?.[0] === targetRoot : layer.id === targetId) ? index : -1).filter((index) => index >= 0);
    const index = placement === "before" ? targetIndices[0] : targetIndices.at(-1)! + 1;
    remaining.splice(index, 0, ...moving);
    if (remaining.every((layer, index) => layer.id === original[index].id)) return;
    this.commitStep(this.document());
    this.document.update((doc) => ({ ...doc, layers: remaining }));
    this.changed();
  }
  readonly lastAreaSelection = signal<AreaSelectionKind>("rectangle");
  readonly areaSelection = signal<SelectionArea | null>(null);
  /** Objects the area touches, or only the ones it encloses. */
  readonly areaSelectionMode = signal<"intersect" | "inside">("intersect");
  private areaGesture?: { ids: string[]; primary: string | null; nodes: string[]; shift: boolean; moved: boolean };
  private startAreaSelection(point: Point, kind: AreaSelectionKind, shift: boolean) {
    this.lastAreaSelection.set(kind);
    this.areaGesture = { ids: this.selectedLayers().map(layer => layer.id), primary: this.selectedId(), nodes: [...this.activeNodes()], shift, moved: false };
    this.areaSelection.set({ kind, start: point, end: point, points: [point] });
  }
  private moveAreaSelection(point: Point) {
    const previous = this.areaSelection(), gesture = this.areaGesture;
    if (!previous || !gesture) return;
    const points = [...previous.points];
    if (previous.kind === "lasso" && Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y) >= 2 / this.zoom()) points.push(point);
    if (points.length > 512) points.splice(1, points.length - 2, ...points.slice(1, -1).filter((_, index) => index % 2 === 0));
    const area = { ...previous, end: point, points };
    this.areaSelection.set(area);
    gesture.moved ||= Math.hypot(point.x - area.start.x, point.y - area.start.y) >= 3 / this.zoom();
    if (!gesture.moved) return;
    const layers = this.document().layers.filter(layer => layer.visible && !layer.guide && !this.isEffectivelyLocked(layer));
    const units = new Map<string, Layer[]>();
    for (const layer of layers) {
      const key = layer.groupPath?.[0] ? "group:" + layer.groupPath[0] : "layer:" + layer.id;
      units.set(key, [...(units.get(key) ?? []), layer]);
    }
    const selected = new Set(gesture.shift ? gesture.ids : []);
    for (const members of units.values()) {
      const covered = this.areaSelectionMode() === "inside"
        ? members.every(layer => layerInsideArea(layer, area))
        : members.some(layer => layerIntersectsArea(layer, area));
      if (!covered) continue;
      const remove = gesture.shift && members.every(layer => gesture.ids.includes(layer.id));
      for (const layer of members) { if (remove) selected.delete(layer.id); else selected.add(layer.id); }
    }
    const ids = this.document().layers.filter(layer => selected.has(layer.id)).map(layer => layer.id);
    this.selectedIds.set(ids); this.selectedId.set(ids.at(-1) ?? null); this.activeNodes.set([]);
  }
  private gesture?: {
    before: StudioDocument;
    start: Point;
    last: Point;
    id: string;
    points: Point[];
    original: Layer;
    mode: string;
    ids?: string[];
    deselectNodeOnClick?: string;
  };
  // Open documents. The active one lives in `document`, `history` and the selection signals;
  // inactive tabs keep their own snapshot so switching never mixes undo history or selection.
  private readonly inactiveTabs = signal<Record<string, WorkspaceTab>>({});
  readonly tabOrder = signal<string[]>([crypto.randomUUID()]);
  readonly activeTabId = signal<string>(this.tabOrder()[0]);
  /** Counts document edits only; `revision` also advances for redraw-only events such as cancel. */
  private readonly edits = signal(0);
  /** Edit count of the active document at its last save, open or creation; -1 means unsaved. */
  private readonly savedEdits = signal(0);
  readonly dirty = computed(() => this.edits() !== this.savedEdits());
  readonly tabs = computed(() => this.tabOrder().map((id) => {
    if (id === this.activeTabId()) return { id, name: this.document().name, dirty: this.dirty(), active: true };
    const tab = this.inactiveTabs()[id];
    return { id, name: tab?.document.name ?? "", dirty: !!tab?.dirty, active: false };
  }));
  constructor() {
    try {
      this.restoreWorkspace();
    } catch {
      this.status.set(
        "Previous draft could not be restored. Open a saved project.",
      );
    }
  }
  private restoreWorkspace() {
    const index = localStorage.getItem(WORKSPACE_KEY);
    if (!index) {
      // Migrate the single-document autosave written by earlier previews.
      const legacy = localStorage.getItem("xds-draft");
      if (legacy) {
        this.document.set(parseDocument(legacy));
        if (this.document().layers.length) this.savedEdits.set(-1);
        localStorage.removeItem("xds-draft");
        this.persistWorkspace();
      }
      return;
    }
    const saved = JSON.parse(index) as { version: number; active: string; tabs: { id: string; dirty: boolean }[] };
    if (saved.version !== 1 || !Array.isArray(saved.tabs)) throw new Error("Invalid workspace");
    const restored: { id: string; dirty: boolean; document: StudioDocument }[] = [];
    for (const tab of saved.tabs.slice(0, MAX_TABS)) {
      if (typeof tab?.id !== "string" || !/^[0-9a-f-]{36}$/.test(tab.id)) continue;
      const text = localStorage.getItem(WORKSPACE_KEY + ":" + tab.id);
      try { if (text) restored.push({ id: tab.id, dirty: tab.dirty === true, document: parseDocument(text) }); } catch { /* Skip an unreadable tab; the others still open. */ }
    }
    if (!restored.length) return;
    const active = restored.find((tab) => tab.id === saved.active) ?? restored[0];
    this.inactiveTabs.set(Object.fromEntries(restored.filter((tab) => tab !== active).map((tab) => [tab.id, { document: tab.document, history: new DocumentHistory(), dirty: tab.dirty, selectedId: null, selectedIds: [] }])));
    this.tabOrder.set(restored.map((tab) => tab.id));
    this.activeTabId.set(active.id);
    this.document.set(active.document);
    this.savedEdits.set(active.dirty ? -1 : this.edits());
  }
  private persistWorkspace() {
    try {
      const tabs = this.tabs().map(({ id, dirty }) => ({ id, dirty }));
      const text = JSON.stringify(this.document());
      if (text.length < 4_000_000) localStorage.setItem(WORKSPACE_KEY + ":" + this.activeTabId(), text);
      else {
        localStorage.removeItem(WORKSPACE_KEY + ":" + this.activeTabId());
        this.status.set(
          "Large project: save a project file to preserve your work.",
        );
      }
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, active: this.activeTabId(), tabs }));
    } catch {
      this.status.set("Browser storage is full. Save a project file.");
    }
  }
  /** Marks the active document as matching its last save or open. */
  markSaved() { this.savedEdits.set(this.edits()); this.persistWorkspace(); }
  private stashActive(): WorkspaceTab {
    this.finishPath();
    this.cancel();
    return { document: this.document(), history: this.history, dirty: this.dirty(), selectedId: this.selectedId(), selectedIds: this.selectedIds() };
  }
  private activate(id: string, tab: WorkspaceTab) {
    this.activeTabId.set(id);
    this.history = tab.history;
    this.document.set(tab.document);
    this.selectedId.set(tab.selectedId);
    this.selectedIds.set(tab.selectedIds);
    this.activeNodes.set([]);
    this.penId.set(null);
    this.renderer.prune(tab.document.layers);
    this.revision.update((x) => x + 1);
    this.savedEdits.set(tab.dirty ? -1 : this.edits());
    this.persistWorkspace();
  }
  /** Opens a blank document in a new tab and makes it active. */
  newDocument(): boolean {
    if (this.tabOrder().length >= MAX_TABS) { this.status.set("Close a document before opening another."); return false; }
    const previous = this.activeTabId(), id = crypto.randomUUID();
    const names = new Set(this.tabs().map((tab) => tab.name));
    this.inactiveTabs.update((tabs) => ({ ...tabs, [previous]: this.stashActive() }));
    let name = "Untitled exploration", n = 2;
    while (names.has(name)) name = `Untitled exploration ${n++}`;
    this.tabOrder.update((order) => [...order.slice(0, order.indexOf(previous) + 1), id, ...order.slice(order.indexOf(previous) + 1)]);
    this.activate(id, { document: { ...blankDocument(), name }, history: new DocumentHistory(), dirty: false, selectedId: null, selectedIds: [] });
    this.status.set("New document");
    return true;
  }
  switchDocument(id: string) {
    const target = this.inactiveTabs()[id];
    if (id === this.activeTabId() || !target) return;
    const previous = this.activeTabId(), stash = this.stashActive();
    this.inactiveTabs.update((tabs) => { const next = { ...tabs, [previous]: stash }; delete next[id]; return next; });
    this.activate(id, target);
  }
  /** Closes a tab without asking; callers confirm unsaved changes first. The last tab is replaced by a blank one. */
  closeDocument(id: string) {
    const order = this.tabOrder();
    if (!order.includes(id)) return;
    localStorage.removeItem(WORKSPACE_KEY + ":" + id);
    if (id !== this.activeTabId()) {
      this.inactiveTabs.update((tabs) => { const next = { ...tabs }; delete next[id]; return next; });
      this.tabOrder.set(order.filter((x) => x !== id));
      this.persistWorkspace();
      return;
    }
    this.finishPath();
    this.cancel();
    const remaining = order.filter((x) => x !== id);
    if (!remaining.length) {
      const fresh = crypto.randomUUID();
      this.tabOrder.set([fresh]);
      this.activate(fresh, { document: blankDocument(), history: new DocumentHistory(), dirty: false, selectedId: null, selectedIds: [] });
      return;
    }
    const next = remaining[Math.min(order.indexOf(id), remaining.length - 1)], target = this.inactiveTabs()[next];
    this.inactiveTabs.update((tabs) => { const copy = { ...tabs }; delete copy[next]; return copy; });
    this.tabOrder.set(remaining);
    this.activate(next, target);
  }
  isDocumentDirty(id: string) { return id === this.activeTabId() ? this.dirty() : !!this.inactiveTabs()[id]?.dirty; }
  /** Opens a project in the active tab when that tab is an untouched blank document, otherwise in a new tab. */
  openDocument(text: string) {
    const doc = parseDocument(text);
    if ((this.document().layers.length || this.dirty()) && !this.newDocument()) return;
    this.open(JSON.stringify(doc));
  }
  private changed() {
    this.document.set(syncProcedurals(this.document()));
    this.synchronizeBlends();
    this.revision.update((x) => x + 1);
    this.edits.update((x) => x + 1);
    this.renderer.prune(this.document().layers);
    this.persistWorkspace();
  }
  previewDocument(): StudioDocument {
    let base: StudioDocument;
    try { base = syncBlends(syncProcedurals(this.document())); } catch { base = this.document(); }
    const ghosts = this.duplicationGhosts();
    return ghosts.length ? { ...base, layers: [...ghosts, ...base.layers] } : base;
  }
  /**
   * While Alt turns a transform into a duplication, the untouched originals are drawn in
   * their place behind the objects being dragged, which are the copies to come.
   */
  private duplicationGhosts(): Layer[] {
    const g = this.gesture;
    if (!this.duplicatingDrag() || !g || !["move", "rotate", "scale"].includes(g.mode)) return [];
    const ids = new Set(g.ids?.length ? g.ids : [g.id]);
    return g.before.layers
      .filter((layer) => ids.has(layer.id) && layer.visible && !layer.guide)
      .map((layer) => ({ ...layer, id: layer.id + "__origin", locked: true }));
  }
  private synchronizeBlends() {
    const doc = this.document();
    if (!doc.blends?.length) return;
    let current = doc;
    const valid: ObjectBlend[] = [];
    for (const blend of doc.blends) {
      try { current = syncBlends({ ...current, blends: [blend] }); valid.push(blend); }
      catch { this.status.set("Blend expanded because its endpoints changed."); }
    }
    this.document.set({ ...current, blends: valid });
  }
  private expandGeneratedForIds(ids: Set<string>) {
    const doc = this.document();
    const invalid = doc.blends?.filter((blend) => blend.stepIds.flat().some((id) => ids.has(id)) && ![...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()].every((id) => ids.has(id))) ?? [];
    if (!invalid.length) return;
    const removed = new Set(invalid.map((blend) => blend.id));
    this.document.set({ ...doc, blends: doc.blends!.filter((blend) => !removed.has(blend.id)) });
    this.status.set("Blend expanded to edit an intermediate object.");
  }
  private setLayer(id: string, patch: Partial<Layer>) {
    if (Object.keys(patch).some((key) => !["locked", "visible", "name"].includes(key))) this.expandGeneratedForIds(new Set([id]));
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  }
  textMetrics(layer: Layer) {
    return layoutText(layer, this.renderer.measureText);
  }
  previewText(layer: Layer, text: string): Layer {
    return this.reflowText({ ...layer, text: text.slice(0, 2000) });
  }
  private reflowText(layer: Layer): Layer {
    if (layer.kind !== "text" || !layer.textLayout || layer.textLayout.sizing === "fixed") return layer;
    const layout = this.textMetrics(layer);
    return { ...layer, width: Math.max(1, Math.min(16384, layout.width)), height: Math.max(1, Math.min(16384, layout.height)) };
  }
  private applyTextUpdate(update: (layer: Layer) => Layer) {
    const ids = new Set(this.selectedLayers().filter((layer) => (layer.kind === "text" || !!layer.dimension) && !this.isEffectivelyLocked(layer)).map((layer) => layer.id));
    if (!ids.size) return;
    const before = this.document();
    const layers = before.layers.map((layer) => ids.has(layer.id) ? this.reflowText(update(layer)) : layer);
    if (JSON.stringify(layers) === JSON.stringify(before.layers)) return;
    this.commitStep(before);
    this.document.set({ ...before, layers });
    this.changed();
  }
  updateTextLayout(patch: Partial<TextLayoutOptions>) {
    if (patch.sizing !== undefined && !["fixed", "content", "width", "height"].includes(patch.sizing)) return;
    if (["wrap", "hyphenate", "fit"].some((key) => patch[key as keyof TextLayoutOptions] !== undefined && typeof patch[key as keyof TextLayoutOptions] !== "boolean")) return;
    this.applyTextUpdate((layer) => {
      const textLayout = { ...defaultTextLayout, ...layer.textLayout, ...patch };
      if (patch.fit === true) textLayout.sizing = "fixed";
      if (textLayout.sizing !== "fixed") textLayout.fit = false;
      if (["content", "width"].includes(textLayout.sizing)) textLayout.wrap = false;
      return { ...layer, ...(layer.dimension ? {dimension:{...layer.dimension,labelSize:layer.dimension.labelSize ?? {width:160,height:40}}} : {}), textLayout, typography: { ...defaultTypography, ...layer.typography } };
    });
  }
  updateTypography(patch: Partial<TextTypography>) {
    const ranges: Partial<Record<keyof TextTypography, [number, number]>> = {
      fontWeight: [100, 900], lineHeight: [0, 2000], letterSpacing: [-100, 500], wordSpacing: [-100, 1000],
      paragraphSpacing: [0, 2000], horizontalScale: [0.1, 10], verticalScale: [0.1, 10], baselineShift: [-1000, 1000],
    };
    for (const [key, range] of Object.entries(ranges)) {
      const value = patch[key as keyof TextTypography];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1])) return;
    }
    if (patch.fontWeight !== undefined && patch.fontWeight % 100 !== 0) return;
    if (patch.fontFamily !== undefined && !FONT_FAMILIES.includes(patch.fontFamily)) return;
    if (patch.fontStyle !== undefined && !["normal", "italic"].includes(patch.fontStyle)) return;
    if (patch.align !== undefined && !["left", "center", "right", "justify"].includes(patch.align)) return;
    if (patch.decoration !== undefined && !["none", "underline", "line-through"].includes(patch.decoration)) return;
    if (patch.language !== undefined && !["en", "es"].includes(patch.language)) return;
    this.applyTextUpdate((layer) => ({ ...layer, typography: { ...defaultTypography, ...layer.typography, ...patch }, textLayout: { ...defaultTextLayout, ...layer.textLayout } }));
  }
  updateTextFontSize(fontSize: number) {
    if (!Number.isFinite(fontSize) || fontSize < 1 || fontSize > 500) return;
    this.applyTextUpdate((layer) => ({ ...layer, fontSize }));
  }
  updateLayer(patch: Partial<Layer>) {
    let layer = this.selected();
    if (!layer || this.isEffectivelyLocked(layer) || layer.guide) return;
    this.commitStep(this.document());
    if(["x","y","width","height","rotation","skewX","flipX","flipY"].some(key=>key in patch))layer=this.detachOpening(layer);
    if (patch.width !== undefined || patch.height !== undefined)
      patch = {
        ...resizeLayer(
          layer,
          patch.width ?? layer.width,
          patch.height ?? layer.height,
        ),
        ...patch,
      };
    this.setLayer(layer.id, this.reflowText({ ...layer, ...patch }));
    this.changed();
  }
  toggle(id: string, key: "visible" | "locked") {
    this.commitStep(this.document());
    const layer = this.document().layers.find((l) => l.id === id)!;
    this.setLayer(id, { [key]: !layer[key] });
    this.changed();
  }
  rename(name: string) {
    this.commitStep(this.document());
    this.document.update((d) => ({ ...d, name: name.slice(0, 150) }));
    this.changed();
  }
  // Interactive page editing: corner handles resize the page, an area drag crops it.
  readonly pageMode = signal<"resize" | "crop" | null>(null);
  readonly pageCropArea = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  private pageGesture?: { before: StudioDocument; handle: string; start: Point };
  setPageMode(mode: "resize" | "crop" | null) {
    if (this.pageGesture) this.cancelPageGesture();
    this.pageCropArea.set(null);
    this.pageMode.set(mode);
    if (mode) this.status.set(mode === "resize" ? "Drag a page handle; Escape cancels" : "Drag the area to keep; Escape cancels");
  }
  /** Handles are the four corners and the four edges of the page. */
  readonly pageHandles = computed(() => {
    if (this.pageMode() !== "resize") return [] as { id: string; x: number; y: number }[];
    const { width, height } = this.document();
    return [
      { id: "nw", x: 0, y: 0 }, { id: "n", x: width / 2, y: 0 }, { id: "ne", x: width, y: 0 },
      { id: "e", x: width, y: height / 2 }, { id: "se", x: width, y: height },
      { id: "s", x: width / 2, y: height }, { id: "sw", x: 0, y: height }, { id: "w", x: 0, y: height / 2 },
    ];
  });
  private beginPageGesture(point: Point): boolean {
    const mode = this.pageMode();
    if (!mode) return false;
    if (mode === "crop") {
      this.pageGesture = { before: structuredClone(this.document()), handle: "crop", start: this.snap(point) };
      this.pageCropArea.set({ x: this.pageGesture.start.x, y: this.pageGesture.start.y, width: 0, height: 0 });
      return true;
    }
    const handle = this.pageHandles().find((entry) => Math.hypot(point.x - entry.x, point.y - entry.y) <= 10 / this.zoom());
    if (!handle) return false;
    this.pageGesture = { before: structuredClone(this.document()), handle: handle.id, start: this.snap(point) };
    return true;
  }
  private updatePageGesture(point: Point) {
    const gesture = this.pageGesture;
    if (!gesture) return;
    const target = this.snap(point), before = gesture.before;
    if (gesture.handle === "crop") {
      const x = Math.min(gesture.start.x, target.x), y = Math.min(gesture.start.y, target.y);
      this.pageCropArea.set({ x, y, width: Math.abs(target.x - gesture.start.x), height: Math.abs(target.y - gesture.start.y) });
      return;
    }
    const edges = { top: 0, right: 0, bottom: 0, left: 0 };
    if (gesture.handle.includes("n")) edges.top = -(target.y - 0);
    if (gesture.handle.includes("s")) edges.bottom = target.y - before.height;
    if (gesture.handle.includes("w")) edges.left = -(target.x - 0);
    if (gesture.handle.includes("e")) edges.right = target.x - before.width;
    const width = before.width + edges.left + edges.right, height = before.height + edges.top + edges.bottom;
    if (width < PAGE_MINIMUM || height < PAGE_MINIMUM || width > PAGE_MAXIMUM || height > PAGE_MAXIMUM) return;
    try { this.document.set(resizePage(before, edges)); this.revision.update((value) => value + 1); } catch { /* Keep the last valid page. */ }
  }
  private endPageGesture() {
    const gesture = this.pageGesture;
    if (!gesture) return;
    this.pageGesture = undefined;
    if (gesture.handle === "crop") {
      const area = this.pageCropArea();
      this.pageCropArea.set(null);
      if (!area || area.width < PAGE_MINIMUM || area.height < PAGE_MINIMUM) { this.status.set("The crop area is smaller than the minimum page."); return; }
      const edges = { top: -area.y, left: -area.x, bottom: area.y + area.height - gesture.before.height, right: area.x + area.width - gesture.before.width };
      let next: StudioDocument;
      try { next = resizePage(gesture.before, edges); parseDocument(JSON.stringify(next)); }
      catch (error) { this.status.set(error instanceof Error ? error.message : "The page cannot be resized."); return; }
      this.commitStep(gesture.before);
      this.document.set(next);
      this.changed();
      this.status.set("Document cropped");
      this.setPageMode(null);
      return;
    }
    if (JSON.stringify(gesture.before) === JSON.stringify(this.document())) return;
    const applied = this.document();
    this.document.set(gesture.before);
    this.commitStep(gesture.before);
    this.document.set(applied);
    this.changed();
    this.status.set("Document dimensions updated");
  }
  private cancelPageGesture() {
    const gesture = this.pageGesture;
    if (!gesture) return;
    this.pageGesture = undefined;
    this.pageCropArea.set(null);
    this.document.set(gesture.before);
    this.revision.update((value) => value + 1);
  }
  /** One page edit: size, background, margin guides and registration marks of the active document. */
  applyPageSetup(setup: { size?: PageSize; background?: string; margins?: MarginGuides; marks?: RegistrationMarks }): boolean {
    const before = this.document();
    const size = setup.size ?? { width: before.width, height: before.height };
    if (!pageSizeFits(size)) { this.status.set("The page must stay between 16 and 8192 pixels."); return false; }
    if (setup.marks && setup.marks !== "none" && !registrationFits(setup.marks, size)) { this.status.set("The registration marks do not fit inside this page."); return false; }
    let layers = before.layers.filter((layer) => !layer.name.startsWith(MARGIN_GUIDE_PREFIX) && layer.name !== REGISTRATION_LAYER_NAME);
    if (setup.margins) {
      layers = [...layers, ...marginGuidePositions(size, setup.margins).map((guide) => ({
        ...newLayer("path", crypto.randomUUID(), { x: guide.axis === "vertical" ? guide.position : 0, y: guide.axis === "horizontal" ? guide.position : 0 }, "none", "#00b8d9", 1),
        guide: guide.axis, name: guide.name,
      }))];
    }
    const marks = setup.marks && setup.marks !== "none" ? registrationLayer(setup.marks, size, crypto.randomUUID()) : null;
    if (marks) layers = [...layers, marks];
    if (layers.length > 150) { this.status.set("Close a document before opening another."); return false; }
    const next = { ...before, width: size.width, height: size.height, background: setup.background ?? before.background, layers };
    try { parseDocument(JSON.stringify(next)); } catch { this.status.set("The page settings cannot be applied."); return false; }
    this.commitStep(before);
    this.document.set(next);
    this.selectedIds.update((ids) => ids.filter((id) => next.layers.some((layer) => layer.id === id)));
    if (!next.layers.some((layer) => layer.id === this.selectedId())) this.selectedId.set(null);
    this.changed();
    this.status.set("Document dimensions updated");
    return true;
  }
  /** Adds space on each edge and moves the artwork with the page. */
  expandPage(edges: PageEdges): boolean { return this.resizePageBy(edges, 1); }
  /** Removes space on each edge; artwork keeps its position relative to what remains. */
  cropPage(edges: PageEdges): boolean { return this.resizePageBy(edges, -1); }
  private resizePageBy(edges: PageEdges, sign: number): boolean {
    const before = this.document();
    const applied = { top: edges.top * sign, right: edges.right * sign, bottom: edges.bottom * sign, left: edges.left * sign };
    if (!Object.values(applied).every((value) => Number.isFinite(value))) return false;
    let next: StudioDocument;
    try { next = resizePage(before, applied); parseDocument(JSON.stringify(next)); }
    catch (error) { this.status.set(error instanceof Error ? error.message : "The page cannot be resized."); return false; }
    this.commitStep(before);
    this.document.set(next);
    this.changed();
    this.status.set(sign > 0 ? "Document expanded" : "Document cropped");
    return true;
  }
  background(value: string) {
    this.commitStep(this.document());
    this.document.update((d) => ({ ...d, background: value }));
    this.changed();
  }
  moveOrder(delta: number) {
    const layers = this.document().layers, id = this.selectedId();
    const source = layers.find((layer) => layer.id === id);
    if (!source || !delta) return;
    const root = source.groupPath?.[0];
    const selected = new Set(this.selectedLayers().map((layer) => layer.id));
    const members = layers.map((layer, index) => selected.has(layer.id) || (root && layer.groupPath?.[0] === root) ? index : -1).filter((index) => index >= 0);
    const target = layers[delta < 0 ? members[0] - 1 : members.at(-1)! + 1];
    if (target) this.reorderLayer(source.id, target.id, delta < 0 ? "before" : "after");
  }
  remove() {
    const ids = new Set(
      this.selectedLayers()
        .filter((l) => !this.isEffectivelyLocked(l))
        .map((l) => l.id),
    );
    if (!ids.size) return;
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.filter((l) => !ids.has(l.id)),
    }));
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.changed();
  }
  /**
   * Copied artwork lives in the session, not in the clipboard of the system: a drawing is
   * pasted back as layers, which a text clipboard cannot carry faithfully.
   */
  private clipboard: Layer[] = [];
  readonly canPaste = computed(() => { this.revision(); return this.clipboard.length > 0; });
  copySelection(): boolean {
    const layers = this.selectedLayers().filter((layer) => !layer.guide);
    if (!layers.length) return false;
    this.clipboard = structuredClone(layers);
    this.status.set(`Copied ${layers.length} object${layers.length > 1 ? "s" : ""}.`);
    this.revision.update((x) => x + 1);
    return true;
  }
  cutSelection(): boolean {
    if (!this.copySelection()) return false;
    this.remove();
    this.status.set("Cut to the clipboard.");
    return true;
  }
  /**
   * Pastes the copied artwork. `where` decides the place in the stack: in front of or behind
   * the selection, or on top with a small offset, which is what a plain paste does.
   */
  paste(where: "offset" | "front" | "back" = "offset"): boolean {
    if (!this.clipboard.length) return false;
    const document = this.document();
    if (document.layers.length + this.clipboard.length > 150) { this.status.set("Preview limit: 150 layers"); return false; }
    const offset = where === "offset" ? 20 : 0;
    const copies = this.clipboard.map((layer) => ({
      ...structuredClone(layer),
      id: crypto.randomUUID(),
      x: layer.x + offset,
      y: layer.y + offset,
    }));
    const selected = new Set(this.selectedLayers().map((layer) => layer.id));
    const indexes = document.layers.map((layer, index) => (selected.has(layer.id) ? index : -1)).filter((index) => index >= 0);
    // Without a selection the artwork goes to the front, which is where a plain paste lands.
    const at = where === "front"
      ? (indexes.length ? Math.max(...indexes) + 1 : document.layers.length)
      : where === "back"
        ? (indexes.length ? Math.min(...indexes) : 0)
        : document.layers.length;
    this.commitStep(document);
    this.document.set({ ...document, layers: [...document.layers.slice(0, at), ...copies, ...document.layers.slice(at)] });
    this.selectedIds.set(copies.map((layer) => layer.id));
    this.selectedId.set(copies[0].id);
    this.activeNodes.set([]);
    this.status.set(where === "front" ? "Pasted in front." : where === "back" ? "Pasted behind." : "Pasted.");
    this.changed();
    return true;
  }
  /**
   * The last transformation of the selection, kept so it can be repeated: how far it moved,
   * how much it turned and grew, and whether it left a copy behind.
   */
  readonly lastTransform = signal<{ dx: number; dy: number; rotation: number; scale: number; duplicate: boolean; pivot: Point } | null>(null);
  /** True while a drag will duplicate on release, which the cursor shows. */
  readonly duplicatingDrag = signal(false);
  /** Keeps the cursor honest while Alt is pressed or released without moving the pointer. */
  setDuplicatingDrag(alt: boolean) {
    if (this.gesture && ["move", "rotate", "scale"].includes(this.gesture.mode)) this.duplicatingDrag.set(alt);
  }
  private recordTransform(step: { dx?: number; dy?: number; rotation?: number; scale?: number; duplicate?: boolean; pivot?: Point }) {
    // The pivot belongs to the transformation: a repeat turns and scales around the same point.
    const pivot = step.pivot ?? this.pivot();
    const value = { dx: step.dx ?? 0, dy: step.dy ?? 0, rotation: step.rotation ?? 0, scale: step.scale ?? 1, duplicate: !!step.duplicate, pivot: { ...pivot } };
    if (!value.dx && !value.dy && !value.rotation && value.scale === 1 && !value.duplicate) return;
    this.lastTransform.set(value);
  }
  /**
   * Repeats the last transformation on the current selection, the copy it left behind
   * included, as one history step.
   */
  transformAgain(): boolean {
    const last = this.lastTransform();
    const layers = this.selectedLayers().filter((layer) => !layer.guide && !this.isEffectivelyLocked(layer));
    if (!last || !layers.length) { this.status.set("There is no transformation to repeat."); return false; }
    const document = this.document();
    if (last.duplicate && document.layers.length + layers.length > 150) { this.status.set("Preview limit: 150 layers"); return false; }
    // The recorded pivot is the origin of the repeat, not the pivot of whatever is selected now.
    const centre = last.pivot;
    const step = { dx: last.dx, dy: last.dy, rotation: last.rotation, scale: last.scale };
    const ids = new Set(layers.map((layer) => layer.id));
    let next: StudioDocument;
    let selection: string[];
    if (last.duplicate) {
      const copies = layers.map((layer) => copyLayer(layer, step, centre, crypto.randomUUID()));
      next = { ...document, layers: [...document.layers, ...copies] };
      selection = copies.map((layer) => layer.id);
    } else {
      next = { ...document, layers: document.layers.map((layer) => ids.has(layer.id) ? copyLayer(layer, step, centre, layer.id) : layer) };
      selection = [...ids];
    }
    try { parseDocument(JSON.stringify(next)); } catch { this.status.set("The transformation cannot be repeated here."); return false; }
    this.commitStep(document);
    this.document.set(next);
    this.selectedIds.set(selection);
    this.selectedId.set(selection[0]);
    // The repeat keeps its origin, so the next one turns around the same point.
    this.carryPivot(centre);
    this.status.set(last.duplicate ? "Transformed again with a copy." : "Transformed again.");
    this.changed();
    return true;
  }
  /** Duplicates the selection as a series: a line of copies, a turn around the pivot or a grid. */
  duplicateSeries(settings: ArraySettings): boolean {
    const layers = this.selectedLayers().filter((layer) => !layer.guide && !this.isEffectivelyLocked(layer));
    if (!layers.length || !validArraySettings(settings)) return false;
    const box = selectionBounds(layers);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // The pivot of the series is read before the copies replace the selection.
    const placed = this.pivotMoved() ? this.pivot() : null;
    const steps = arraySteps(settings, this.pivot(), centre);
    if (!steps.length) return false;
    const document = this.document();
    if (document.layers.length + steps.length * layers.length > 150) { this.status.set("Preview limit: 150 layers"); return false; }
    const copies = steps.flatMap((step) => layers.map((layer) => copyLayer(layer, step, centre, crypto.randomUUID())));
    this.commitStep(document);
    this.document.set({ ...document, layers: [...document.layers, ...copies] });
    this.selectedIds.set(copies.map((layer) => layer.id));
    this.selectedId.set(copies[0].id);
    this.activeNodes.set([]);
    this.carryPivot(placed);
    this.status.set(`Duplicated into ${steps.length} ${steps.length > 1 ? "copies" : "copy"}.`);
    this.changed();
    return true;
  }
  duplicate() {
    const layers = this.selectedLayers();
    if (!layers.length || this.document().layers.length + layers.length > 150)
      return;
    // Repeating a duplicate makes another copy the same distance away.
    const placed = this.pivotMoved() ? this.pivot() : null;
    this.recordTransform({ dx: 20, dy: 20, duplicate: true });
    this.commitStep(this.document());
    const groups = new Map<string, string>();
    const copies = layers.map((layer) => ({
      ...structuredClone(layer),
      id: crypto.randomUUID(),
      name: layer.name + " copy",
      regroupPath: undefined,
      x: layer.x + 20,
      y: layer.y + 20,
      ...(layer.groupPath
        ? {
            groupPath: layer.groupPath.map((id) => {
              if (!groups.has(id)) groups.set(id, crypto.randomUUID());
              return groups.get(id)!;
            }),
          }
        : {}),
    }));
    const copyIds = new Map(layers.map((layer, index) => [layer.id, copies[index].id]));
    for(const copy of copies){const p=copy.procedural;if((p?.type==='door'||p?.type==='window')&&p.host){const wallId=copyIds.get(p.host.wallId);if(wallId)p.host={...p.host,wallId};else delete p.host;}}
    const blends = this.document().blends?.filter((blend) => [...blend.backIds, ...blend.frontIds, ...blend.stepIds.flat()].every((id) => copyIds.has(id))).map((blend) => ({ ...blend, id: crypto.randomUUID(), groupId: groups.get(blend.groupId)!, backIds: blend.backIds.map((id) => copyIds.get(id)!), frontIds: blend.frontIds.map((id) => copyIds.get(id)!), stepIds: blend.stepIds.map((step) => step.map((id) => copyIds.get(id)!)) }));
    for (const blend of blends ?? []) for (const step of blend.stepIds) for (const id of step) {
      const item = copies.find((layer) => layer.id === id)!;
      const depth = item.groupPath!.indexOf(blend.groupId);
      item.groupPath = [...item.groupPath!.slice(0, depth + 1), step[0]];
    }
    this.document.update((d) => ({ ...d, layers: [...d.layers, ...copies], ...(blends?.length ? { blends: [...(d.blends ?? []), ...blends] } : {}) }));
    this.selectedIds.set(copies.map((l) => l.id));
    this.selectedId.set(copies.at(-1)!.id);
    this.carryPivot(placed);
    this.changed();
  }
  /**
   * Every history step carries the pivot it was taken with, so undo and redo return the
   * pivot of that step together with the artwork it belongs to.
   */
  private commitStep(before: StudioDocument, pivot = this.pivotOverride()) {
    this.history.commit(before, pivot);
  }
  private restorePivot() {
    const restored = this.history.restored as { key: string; point: Point } | null;
    this.pivotOverride.set(restored ?? null);
  }
  undo() {
    this.penId.set(null);
    this.cancel();
    if (!this.history.canUndo) return;
    this.document.set(this.history.undo(this.document(), this.pivotOverride()));
    this.restorePivot();
    this.changed();
  }
  redo() {
    this.penId.set(null);
    this.cancel();
    if (!this.history.canRedo) return;
    this.document.set(this.history.redo(this.document(), this.pivotOverride()));
    this.restorePivot();
    this.changed();
  }
  /** Clears the active document to a blank one; undoable, and the result counts as unmodified. */
  reset() {
    this.finishPath();
    this.cancel();
    this.commitStep(this.document());
    this.document.set({ ...blankDocument(), name: this.document().name });
    this.activeNodes.set([]);
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.changed();
    this.markSaved();
    this.status.set("Document cleared");
  }
  open(text: string) {
    this.finishPath();
    const doc = parseDocument(text);
    this.commitStep(this.document());
    this.document.set(doc);
    this.activeNodes.set([]);
    this.selectedId.set(null);
    this.changed();
    this.markSaved();
    this.status.set("Project opened");
  }
  start(
    point: Point,
    modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {},
    override?: ToolId,
  ) {
    const tool = override ?? this.tool();
    if (this.beginPageGesture(point)) return;
    if (this.startPivotDrag(point)) return;
    if(["wall","door","window","pillar","stair"].includes(tool)){this.startProcedural(tool as Procedural["type"],point);return;}
    if (tool === "dimensionChain") { this.startChainDimension(point); return; }
    if (tool === "dimensionRadius" || tool === "dimensionDiameter") { this.startDimension(point, tool === "dimensionRadius" ? "radius" : "diameter"); return; }
    if (["dimensionSmart", "dimensionLinear", "dimensionAngular"].includes(tool)) { this.startDimension(point, tool === "dimensionAngular" ? "angular" : "linear"); return; }
    const dimensionLayer=this.selected();
    if(tool === "select" && dimensionLayer?.dimension && !this.isEffectivelyLocked(dimensionLayer) && this.selectedLayers().length===1) {
      const label=dimensionGeometry(dimensionLayer).labelPosition;
      if(Math.hypot(point.x-label.x,point.y-label.y)<10/this.zoom()){this.dimensionLabelGesture={before:structuredClone(this.document()),id:dimensionLayer.id};return;}
    }
    const areaTools: Partial<Record<ToolId, AreaSelectionKind>> = { selectRectangle: "rectangle", selectEllipse: "ellipse", selectLasso: "lasso" };
    if (areaTools[tool]) { this.startAreaSelection(point, areaTools[tool]!, !!modifiers.shift); return; }
    if (tool === "eyedropper") { this.sampleStyle(point); return; }
    if (tool === "paintBucket") { this.applyStyleAt(point); return; }
    if (["rectangle", "ellipse", "path", "pen", "line", "rounded", "polygon", "star", "arc", "spiral", "grid", "polar", "flare", "text"].includes(tool)) point = this.snap(point);
    if (tool === "hand" || (tool === "brush" && ["none", "transparent"].includes(this.fill()))) return;
    const before = structuredClone(this.document());
    if (tool !== "pen" && !override) this.penId.set(null);
    if (tool === "mirror") {
      this.reflect(modifiers.alt ? "vertical" : "horizontal");
      return;
    }
    if (tool === "scale") {
      const active = this.selectionLayer();
      if (active && !this.selectedLayers().some((layer) => this.isEffectivelyLocked(layer)))
        this.gesture = {
          before,
          start: point,
          last: point,
          id: active.id,
          points: [],
          original: structuredClone(active),
          mode: "scale",
          ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id),
        };
      return;
    }
    if (tool === "zoom") return;
    if (tool === "pen") {
      this.startPen(point, before);
      return;
    }
    if (tool === "scissors" || tool === "knife") {
      this.cutClick(point, before, tool);
      return;
    }
    if (
      [
        "direct",
        "addAnchor",
        "deleteAnchor",
        "convertAnchor",
        "smooth",
        "pathEraser",
      ].includes(tool)
    ) {
      this.startPathEdit(point, before, modifiers, tool);
      return;
    }
    if (tool === "spray" || tool.startsWith("symbol")) {
      this.startSymbol(point, before);
      return;
    }
    if (tool === "path") {
      const active = this.selected();
      if (active?.kind === "path" && !active.dimension && !active.procedural && !this.isEffectivelyLocked(active) && active.visible && !active.guide) {
        const curves = this.editableCurves(active),
          path = curves[0],
          p = localPoint(active, point);
        if (path?.nodes.length) {
          const start = path.nodes.findIndex(
            (n) =>
              Math.hypot(n.point.x - p.x, n.point.y - p.y) < 12 / this.zoom(),
          );
          if (start >= 0) {
            this.gesture = {
              before,
              start: point,
              last: point,
              id: active.id,
              points: [p],
              original: { ...structuredClone(active), curves },
              mode: "pencilEdit:" + start,
            };
            return;
          }
        }
      }
    }
    if (tool === "text") {
      const existing = pick(this.document().layers.filter(layer=>!layer.dimension || this.dimensionsVisible()), point);
      if (existing?.kind === "text") {
        this.selectedId.set(existing.id);
        return;
      }
    }
    const selectedPath = this.selected();
    if (
      tool === "select" &&
      this.selectedLayers().length === 1 &&
      selectedPath?.curves && !selectedPath.dimension && !selectedPath.procedural &&
      !this.isEffectivelyLocked(selectedPath) &&
      selectedPath.visible &&
      this.findCurveNode(selectedPath, point)
    ) {
      this.startPathEdit(point, before, modifiers, "direct");
      return;
    }
    if (tool === "select" || tool === "rotate") {
      const active = this.selectionLayer();
      if (active && !this.selectedLayers().some((layer) => this.isEffectivelyLocked(layer)) && active.visible && !active.guide) {
        const p = localPoint(active, point);
        if (
          tool === "rotate" ||
          Math.hypot(p.x - active.width / 2, p.y + 28 / this.zoom()) <
            10 / this.zoom()
        ) {
          this.gesture = {
            before,
            start: point,
            last: point,
            id: active.id,
            points: [],
            original: structuredClone(active),
            mode: "rotate",
            ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id),
          };
          return;
        }
        const corners = [
          ["tl", 0, 0],
          ["tr", active.width, 0],
          ["bl", 0, active.height],
          ["br", active.width, active.height],
          ["t", active.width / 2, 0],
          ["r", active.width, active.height / 2],
          ["b", active.width / 2, active.height],
          ["l", 0, active.height / 2],
        ] as const;
        const corner = corners.find(
          (c) => Math.hypot(p.x - c[1], p.y - c[2]) < 10 / this.zoom(),
        );
        if (corner) {
          this.gesture = {
            before,
            start: point,
            last: point,
            id: active.id,
            points: [],
            original: structuredClone(active),
            mode: "resize:" + corner[0],
            ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id),
          };
          return;
        }
      }
      const layer = pick(this.document().layers.filter(layer=>!layer.dimension || this.dimensionsVisible()), point);
      if (layer && this.isEffectivelyLocked(layer)) return;
      if (layer) {
        if (
          modifiers.shift ||
          !this.selectedLayers().some((l) => l.id === layer.id)
        )
          this.selectLayer(layer.id, !!modifiers.shift);
        const active = this.selectionLayer();
        if (active)
          this.gesture = {
            before,
            start: point,
            last: point,
            id: active.id,
            points: [],
            original: structuredClone(active),
            mode: "move",
            ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id),
          };
        if (active) this.movePivot = this.pivotMoved() ? this.pivot() : undefined;
      } else if (tool === "select") {
        this.startAreaSelection(point, this.lastAreaSelection(), !!modifiers.shift);
      } else if (!modifiers.shift) {
        this.selectedId.set(null); this.selectedIds.set([]);
      }
      return;
    }
    if (this.document().layers.length >= 150) {
      this.status.set("Preview limit: 150 layers");
      return;
    }
    if (tool === "eraser") {
      const active = this.selected();
      if (
        active &&
        !this.isEffectivelyLocked(active) &&
        !active.guide && !active.dimension && !active.procedural &&
        active.visible &&
        ["path", "rectangle", "ellipse"].includes(active.kind)
      ) {
        this.gesture = {
          before,
          start: point,
          last: point,
          id: active.id,
          points: [],
          original: active,
          mode: "vectorEraser",
        };
        this.eraseVector(point);
        return;
      }
    }
    if (tool === "brush" || tool === "eraser") {
      let layer = this.selected();
      if (layer?.locked) {
        this.status.set("Unlock the layer first");
        return;
      }
      if (tool === "eraser" && layer?.kind !== "image") {
        this.status.set("Select an image or paint layer to erase");
        return;
      }
      if (layer?.kind !== "image") {
        layer = newLayer("image", crypto.randomUUID(), { x: 0, y: 0 });
        layer.width = this.document().width;
        layer.height = this.document().height;
        layer.name = "Paint layer";
        this.document.update((d) => ({ ...d, layers: [...d.layers, layer!] }));
      }
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.min(4096, Math.ceil(layer.width));
      canvas.height = Math.min(4096, Math.ceil(layer.height));
      const ctx = canvas.getContext("2d")!;
      if (layer.source) {
        const image = this.renderer.image(layer.source, () => {});
        if (!image) {
          this.document.set(before);
          this.status.set("Image is loading. Try again.");
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      this.selectedId.set(layer.id);
      this.painting = { id: layer.id, canvas };
      this.gesture = {
        before,
        start: point,
        last: point,
        id: layer.id,
        points: [],
        original: structuredClone(layer),
        mode: tool,
      };
      this.paint(point);
      return;
    }
    const construct = [
      "line",
      "rounded",
      "polygon",
      "star",
      "arc",
      "spiral",
      "grid",
      "polar",
      "flare",
    ].includes(tool);
    const layer = newLayer(
      construct ? "path" : (tool as "rectangle" | "ellipse" | "path" | "text"),
      crypto.randomUUID(),
      point,
      this.fill(),
      this.stroke(),
      this.size(),
    );
    layer.strokeStyle = { ...this.strokeStyle() };
    if(layer.kind === "path") layer.lineEnds=structuredClone(this.lineEnds());
    if (construct) {
      layer.name = tool[0].toUpperCase() + tool.slice(1);
      layer.curves = construction(
        tool as ConstructionTool,
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        this.shapeOptions(),
      );
    }
    if (tool === "text") {
      layer.width = 280;
      layer.height = 60;
      layer.name = "Text";
    }
    this.document.update((d) => ({ ...d, layers: [...d.layers, layer] }));
    this.selectedId.set(layer.id);
    this.gesture = {
      before,
      start: point,
      last: point,
      id: layer.id,
      points: [point],
      original: structuredClone(layer),
      mode: tool,
    };
  }
  move(point: Point, modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) {
    if (this.pageGesture) { this.updatePageGesture(point); return; }
    if (this.cutPending()?.tool === "knife") this.cutPreview.set(point);
    if (this.pivotGesture) { this.setPivot(this.pivotPoint(point)); return; }
    if(this.proceduralGesture){const g=this.proceduralGesture;const end=modifiers.shift?snapDirection(g.start,point,this.snapAngle()):(g.type==='wall'?this.wallTarget(g.start,point,g.id):this.snap(point));try{const layer=this.proceduralLayer(g.type,g.start,end,g.id);const next=syncProcedurals({...g.before,layers:[...g.before.layers,layer]});parseDocument(JSON.stringify(next));this.document.set(next);this.selectedId.set(layer.id);this.selectedIds.set([layer.id]);}catch{/* Keep the last valid preview. */}return;}
    if(this.dimensionLabelGesture){const layer=this.document().layers.find(l=>l.id===this.dimensionLabelGesture!.id)!;this.setLayer(layer.id,{dimension:{...layer.dimension!,labelPosition:localPoint(layer,point)}});return;}
    const draft=this.dimensionDraft();if(draft){const count=draft.kind==="chain"?Infinity:(draft.kind==="angular"?3:2);const placing=draft.ready===true||draft.points.length>=count;this.dimensionDraft.set({...draft,cursor:placing?this.dimensionOffsetPoint(draft.points,point):this.dimensionPoint(point,true)});if(placing)this.dimensionSnapTarget.set(null);return;}
    if(!this.gesture&&["dimensionSmart","dimensionLinear","dimensionAngular","dimensionChain","dimensionRadius","dimensionDiameter"].includes(this.tool())){this.hoverDimension(point);return;}
    if(!this.gesture&&!this.proceduralGesture&&this.tool()==='wall'){this.hoverWall(modifiers.shift&&this.wallChain()?snapDirection(this.wallChain()!,point,this.snapAngle()):point);return;}
    if (this.areaGesture) { this.moveAreaSelection(point); return; }
    const g = this.gesture;
    if (!g) return;
    // Alt held during a transform leaves the original behind, which the cursor announces.
    if (["move", "rotate", "scale"].includes(g.mode)) this.duplicatingDrag.set(!!modifiers.alt);
    if (["rectangle", "ellipse", "line", "rounded", "polygon", "star", "arc", "spiral", "grid", "polar", "flare"].includes(g.mode) || g.mode.startsWith("resize:")) point = this.snap(point);
    if (g.mode === "rotate")
      this.transformSelection(g, this.aroundPivot(g.original, {
        ...g.original,
        rotation: rotationFromDrag(
          g.original,
          g.start,
          point,
          modifiers.shift,
          this.snapAngle(),
        ),
      }));
    else if (g.mode === "scale") {
      const factor = Math.max(
        0.05,
        Math.min(10, 1 + (point.x - g.start.x + point.y - g.start.y) / 200),
      );
      this.transformSelection(g, this.aroundPivot(g.original, {
        ...g.original,
        width: g.original.width * factor,
        height: g.original.height * factor,
        x: g.original.x + (g.original.width * (1 - factor)) / 2,
        y: g.original.y + (g.original.height * (1 - factor)) / 2,
      }));
    } else if (g.mode === "pen") {
      const curves = structuredClone(g.original.curves!),
        node = curves[0].nodes.at(-1)!,
        end = modifiers.shift
          ? snapDirection(worldPoint(g.original, node.point), point, this.snapAngle())
          : point,
        p = localPoint(g.original, end);
      node.outgoing = p;
      if (!modifiers.ctrl && !modifiers.alt)
        node.incoming = { x: node.point.x * 2 - p.x, y: node.point.y * 2 - p.y };
      node.smooth = !modifiers.ctrl && !modifiers.alt;
      this.setLayer(g.id, { curves });
    } else if (g.mode.startsWith("node:")) this.dragNode(point, modifiers);
    else if (
      [
        "line",
        "rounded",
        "polygon",
        "star",
        "arc",
        "spiral",
        "grid",
        "polar",
        "flare",
      ].includes(g.mode)
    ) {
      let end = point;
      if (modifiers.shift) {
        const size = Math.max(
          Math.abs(point.x - g.start.x),
          Math.abs(point.y - g.start.y),
        );
        end = {
          x: g.start.x + Math.sign(point.x - g.start.x || 1) * size,
          y: g.start.y + Math.sign(point.y - g.start.y || 1) * size,
        };
      }
      this.setLayer(
        g.id,
        fitCurves(
          { ...g.original, x: 0, y: 0, width: 1, height: 1 },
          construction(
            g.mode as ConstructionTool,
            g.start,
            end,
            this.shapeOptions(),
          ),
        ),
      );
    } else if (g.mode === "vectorEraser") this.eraseVector(point);
    else if (g.mode === "pathEraser") this.erasePath(point);
    else if (g.mode === "spray" || g.mode.startsWith("symbol"))
      this.paintSymbols(point, modifiers.alt);
    else if (g.mode === "move") {
      const end = modifiers.shift
        ? snapDirection(g.start, point, this.snapAngle())
        : point;
      const delta = modifiers.shift ? { x: end.x - g.start.x, y: end.y - g.start.y } : this.snapMovement(g.original, end.x - g.start.x, end.y - g.start.y);
      this.transformSelection(g, {
        ...g.original,
        x: g.original.x + delta.x,
        y: g.original.y + delta.y,
      });
      // A pivot placed by hand travels with the objects it belongs to.
      if (this.movePivot) this.setPivot({ x: this.movePivot.x + delta.x, y: this.movePivot.y + delta.y });
    } else if (g.mode.startsWith("resize:"))
      this.transformSelection(
        g,
        resizeFromCorner(
          g.original,
          point,
          g.mode.slice(7) as "tl" | "tr" | "bl" | "br" | "t" | "r" | "b" | "l",
          modifiers.shift ? this.snapAngle() : undefined,
        ),
      );
    else if (g.mode === "rectangle" || g.mode === "ellipse") {
      let end = point;
      if (modifiers.shift) {
        const side = Math.max(
          Math.abs(point.x - g.start.x),
          Math.abs(point.y - g.start.y),
        );
        end = {
          x: g.start.x + Math.sign(point.x - g.start.x || 1) * side,
          y: g.start.y + Math.sign(point.y - g.start.y || 1) * side,
        };
      }
      this.setLayer(g.id, bounds(g.start, end));
    } else if (g.mode.startsWith("pencilEdit:")) {
      if (g.points.length < 2000) {
        g.points.push(localPoint(g.original, point));
        const index = Number(g.mode.split(":")[1]),
          curves = structuredClone(g.original.curves!),
          path = curves[0],
          nodes = g.points.map(anchor);
        path.nodes =
          index === 0 && !path.closed
            ? [...nodes.reverse(), ...path.nodes.slice(1)]
            : [...path.nodes.slice(0, index), ...nodes];
        this.setLayer(g.id, fitCurves(g.original, curves));
      }
    } else if (g.mode === "path") {
      if (
        g.points.length < 20000 &&
        Math.hypot(point.x - g.last.x, point.y - g.last.y) > 1
      ) {
        g.points.push(point);
        this.setLayer(g.id, normalizePath(g.original, g.points));
      }
    } else if (g.mode === "brush" || g.mode === "eraser") this.paint(point);
    g.last = point;
  }
  private paint(point: Point) {
    const g = this.gesture,
      painting = this.painting;
    if (!g || !painting || (g.mode !== "eraser" && ["none", "transparent"].includes(this.fill()))) return;
    const ctx = painting.canvas.getContext("2d")!,
      a = localPoint(g.original, g.last),
      b = localPoint(g.original, point);
    ctx.save();
    ctx.scale(
      painting.canvas.width / g.original.width,
      painting.canvas.height / g.original.height,
    );
    const settings = this.brushFor(g.mode === "eraser" ? "eraser" : "brush");
    ctx.globalCompositeOperation = g.mode === "eraser" ? "destination-out" : settings.blend;
    ctx.fillStyle = g.mode === "eraser" ? "#000000" : this.fill();
    for (const stamp of brushStamps(a, b, this.size(), settings, Math.hypot(b.x - a.x, b.y - a.y))) {
      ctx.globalAlpha = stamp.alpha;
      ctx.filter = stamp.blur > 0.1 ? `blur(${stamp.blur.toFixed(2)}px)` : "none";
      ctx.beginPath();
      ctx.ellipse(stamp.center.x, stamp.center.y, stamp.radiusX, stamp.radiusY, stamp.angle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.restore();
    this.revision.update((v) => v + 1);
  }
  isEditingCurve() {
    return (
      this.gesture?.mode === "pen" ||
      !!this.gesture?.mode.startsWith("node:")
    );
  }
  /**
   * Closes the gesture. The modifiers of the release decide the duplication, since a person
   * may hold Alt without moving the pointer again before letting go.
   */
  end(modifiers?: { alt?: boolean }) {
    if (modifiers && this.gesture && ["move", "rotate", "scale"].includes(this.gesture.mode)) {
      this.duplicatingDrag.set(!!modifiers.alt);
    }
    if (this.pageGesture) { this.endPageGesture(); return; }
    if (this.pivotGesture) {
      const before = this.pivotGesture.before;
      this.pivotGesture = undefined;
      // The artwork is untouched, so the step exists only to bring this pivot back.
      this.commitStep(this.document(), before);
      this.revision.update((x) => x + 1);
      return;
    }
    if(this.proceduralGesture){const g=this.proceduralGesture;this.proceduralGesture=undefined;const drawn=this.document().layers.find(l=>l.id===g.id);if(drawn){this.commitStep(g.before);this.changed();if(g.type==='wall'&&drawn.procedural?.type==='wall')this.wallChain.set(worldPoint(drawn,drawn.procedural.end));}return;}
    if(this.dimensionLabelGesture){this.commitStep(this.dimensionLabelGesture.before);this.dimensionLabelGesture=undefined;this.changed();return;}
    if (this.areaGesture) {
      if (!this.areaGesture.moved && !this.areaGesture.shift) { this.selectedId.set(null); this.selectedIds.set([]); this.activeNodes.set([]); }
      this.areaGesture = undefined; this.areaSelection.set(null); return;
    }
    const g = this.gesture;
    if (!g) return;
    if (
      g.deselectNodeOnClick &&
      Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) < 0.01
    )
      this.activeNodes.update((keys) =>
        keys.filter((key) => key !== g.deselectNodeOnClick),
      );
    const layer = this.document().layers.find((l) => l.id === g.id);
    if (layer?.curves && (g.mode === "pen" || g.mode.startsWith("node:")))
      this.setLayer(g.id, fitCurves(layer, layer.curves));
    if (this.painting)
      this.setLayer(g.id, {
        source: this.painting.canvas.toDataURL("image/png"),
      });
    const pivotAtStart = this.movePivot ? { key: this.selectionKey(), point: this.movePivot } : this.pivotOverride();
    if (["move", "rotate", "scale"].includes(g.mode)) this.finishTransformDrag(g, pivotAtStart);
    else this.commitStep(g.before, pivotAtStart);
    this.gesture = undefined;
    this.movePivot = undefined;
    this.painting = undefined;
    this.duplicatingDrag.set(false);
    this.changed();
  }
  /**
   * Closes a move, a rotation or a scaling: it remembers what the drag did so it can be
   * repeated and, when Alt asked for it, restores the originals and keeps the result as
   * copies of them.
   */
  private finishTransformDrag(g: { before: StudioDocument; id: string; ids?: string[]; mode: string }, pivotAtStart: { key: string; point: Point } | null) {
    const ids = new Set(g.ids?.length ? g.ids : [g.id]);
    const before = g.before.layers.filter((layer) => ids.has(layer.id));
    const after = this.document().layers.filter((layer) => ids.has(layer.id));
    const centreOf = (layers: Layer[]) => {
      const box = selectionBounds(layers.filter((layer) => !layer.guide));
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const source = before.find((layer) => layer.id === g.id) ?? before[0];
    const result = after.find((layer) => layer.id === g.id) ?? after[0];
    const duplicate = this.duplicatingDrag();
    if (source && result) {
      this.recordTransform({
        dx: (result.x + result.width / 2) - (source.x + source.width / 2),
        dy: (result.y + result.height / 2) - (source.y + source.height / 2),
        rotation: result.rotation - source.rotation,
        scale: source.width ? result.width / source.width : 1,
        duplicate,
        // The pivot of the drag is the one the selection had before it, not the one the
        // transformed result has now: a repeat turns around the very same point.
        pivot: pivotAtStart && pivotAtStart.key === this.selectionKey() ? pivotAtStart.point : centreOf(before),
      });
    }
    if (!duplicate || !after.length) { this.commitStep(g.before, pivotAtStart); return; }
    const placed = this.pivotMoved() ? this.pivot() : null;
    const copies = after.map((layer) => ({ ...structuredClone(layer), id: crypto.randomUUID(), regroupPath: undefined }));
    const next = { ...g.before, layers: [...g.before.layers, ...copies] };
    try { parseDocument(JSON.stringify(next)); } catch { this.commitStep(g.before, pivotAtStart); return; }
    this.commitStep(g.before, pivotAtStart);
    this.document.set(next);
    this.selectedIds.set(copies.map((layer) => layer.id));
    this.selectedId.set(copies[0].id);
    this.carryPivot(placed);
    this.status.set(`Duplicated ${copies.length} object${copies.length > 1 ? "s" : ""} with the transformation.`);
  }
  cancel() {
    if (this.pageGesture) { this.cancelPageGesture(); this.pageMode.set(null); this.status.set("Page editing cancelled"); }
    this.clearCut();
    if (this.pivotGesture) { this.pivotOverride.set(this.pivotGesture.before); this.pivotGesture = undefined; }
    if(this.proceduralGesture){this.document.set(this.proceduralGesture.before);this.selectedId.set(this.proceduralGesture.selectedId);this.selectedIds.set(this.proceduralGesture.selectedIds);this.proceduralGesture=undefined;}
    this.finishWallRun();
    this.dimensionDraft.set(null);this.dimensionSnapTarget.set(null);
    if(this.dimensionLabelGesture)this.document.set(this.dimensionLabelGesture.before);this.dimensionLabelGesture=undefined;
    this.cancelGuideDrag();
    if (this.areaGesture) {
      this.selectedIds.set(this.areaGesture.ids); this.selectedId.set(this.areaGesture.primary); this.activeNodes.set(this.areaGesture.nodes);
      this.areaGesture = undefined; this.areaSelection.set(null);
    }
    if (this.gesture) this.document.set(this.gesture.before);
    if (this.movePivot) { this.setPivot(this.movePivot); this.movePivot = undefined; }
    this.gesture = undefined;
    this.painting = undefined;
    this.revision.update((x) => x + 1);
  }

  reflect(axis: "horizontal" | "vertical") {
    const layers = this.selectedLayers().filter((l) => !this.isEffectivelyLocked(l) && !l.guide);
    if (!layers.length) return;
    const pivot = this.pivot(),
      ids = new Set(layers.map((l) => l.id));
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) =>
        ids.has(l.id)
          ? {
              ...this.detachUnselectedHost(l,ids),
              rotation: -l.rotation,
              ...(l.skewX !== undefined ? { skewX: -l.skewX } : {}),
              ...(axis === "horizontal"
                ? {
                    x: 2 * pivot.x - l.x - l.width,
                    flipX: !l.flipX,
                  }
                : {
                    y: 2 * pivot.y - l.y - l.height,
                    flipY: !l.flipY,
                  }),
            }
          : l,
      ),
    }));
    this.changed();
  }
  transformBy(rotation = 0, scale = 1) {
    this.recordTransform({ rotation, scale });
    if (this.selectedLayers().some((layer) => this.isEffectivelyLocked(layer))) return;
    const source = this.selectionLayer();
    if (
      !source ||
      !Number.isFinite(rotation) ||
      !Number.isFinite(scale) ||
      scale <= 0 ||
      scale > 10
    )
      return;
    const before = structuredClone(this.document()),
      g = {
        before,
        start: { x: 0, y: 0 },
        last: { x: 0, y: 0 },
        id: source.id,
        points: [],
        original: source,
        mode: "transform",
        ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id),
      };
    this.commitStep(before);
    this.transformSelection(g, this.aroundPivot(source, {
      ...source,
      width: source.width * scale,
      height: source.height * scale,
      x: source.x + (source.width * (1 - scale)) / 2,
      y: source.y + (source.height * (1 - scale)) / 2,
      rotation: source.rotation + rotation,
    }));
    this.changed();
  }
  selectLayer(id: string, add = false) {
    const layer = this.document().layers.find((l) => l.id === id);
    if (!layer || this.isEffectivelyLocked(layer) || !layer.visible) return;
    const root = layer.groupPath?.[0],
      members = this.document()
        .layers.filter(
          (l) =>
            (root ? l.groupPath?.[0] === root : l.id === id) &&
            l.visible &&
            !this.isEffectivelyLocked(l),
        )
        .map((l) => l.id);
    let ids = members;
    if (add) {
      const existing = this.selectedLayers().map((l) => l.id);
      ids = members.every((id) => existing.includes(id))
        ? existing.filter((id) => !members.includes(id))
        : [...new Set([...existing, ...members])];
    }
    if (ids.length !== 1 || ids[0] !== this.selectedId()) this.activeNodes.set([]);
    this.selectedIds.set(ids);
    this.selectedId.set(ids.at(-1) ?? null);
    if (ids.length === 1 && !layer.guide) {
      this.fill.set(layer.fill);
      this.stroke.set(layer.stroke);
      this.size.set(layer.strokeWidth);
      this.strokeStyle.set({ ...defaultStrokeStyle, ...layer.strokeStyle });
      this.lineEnds.set(structuredClone(layer.lineEnds ?? defaultLineEnds));
    }
  }
  selectAll() {
    this.activeNodes.set([]);
    const ids = this.document()
      .layers.filter((l) => l.visible && !this.isEffectivelyLocked(l) && !l.guide)
      .map((l) => l.id);
    this.selectedIds.set(ids);
    this.selectedId.set(ids.at(-1) ?? null);
  }
  private groupingMembers(selection: Layer[], ungroup: boolean): Layer[] {
    const roots = new Set(selection.flatMap((layer) => layer.groupPath?.[0] ? [layer.groupPath[0]] : []));
    const ids = new Set(selection.filter((layer) => !layer.guide && (!ungroup || layer.groupPath?.length)).map((layer) => layer.id));
    return this.document().layers.filter((layer) => !layer.guide && (ids.has(layer.id) || !!layer.groupPath?.[0] && roots.has(layer.groupPath[0])));
  }
  private regroupKey(layer: Layer): string | undefined {
    const prior = layer.regroupPath, current = layer.groupPath ?? [];
    if (!prior || prior.length !== current.length + 1) return undefined;
    const removed = prior.findIndex((_, index) => JSON.stringify(prior.filter((_, position) => position !== index)) === JSON.stringify(current));
    return removed < 0 ? undefined : JSON.stringify(prior.slice(0, removed + 1));
  }
  private regroupMembers(selection: Layer[]): Layer[] {
    const keys = new Set(selection.map((layer) => this.regroupKey(layer)).filter(Boolean));
    if (!keys.size) return [];
    const members = this.document().layers.filter((layer) => {
      const key = this.regroupKey(layer);
      return key && keys.has(key);
    });
    // A moved or locked remembered member must not be silently omitted.
    const remembered = this.document().layers.filter((layer) => layer.regroupPath && [...keys].some((key) => {
      const prefix = JSON.parse(key!); return prefix.every((id: string, index: number) => layer.regroupPath![index] === id);
    }));
    if (members.length < 2 || remembered.length !== members.length || members.some((layer) => layer.guide || this.isEffectivelyLocked(layer))) return [];
    return members;
  }
  regroup() {
    const layers = this.regroupMembers(this.selectedLayers());
    if (!layers.length) return;
    const ids = new Set(layers.map((layer) => layer.id));
    this.commitStep(this.document());
    this.document.update((doc) => ({ ...doc, layers: doc.layers.map((layer) => {
      if (!ids.has(layer.id)) return layer;
      const { regroupPath, ...rest } = layer;
      return { ...rest, groupPath: regroupPath };
    }) }));
    this.selectedIds.set([...ids]); this.selectedId.set(layers.at(-1)!.id);
    this.changed();
  }
  group(ungroup = false, prefix?: string[]) {
    const depth = prefix?.length ? prefix.length - 1 : 0;
    const layers = prefix?.length ? this.document().layers.filter((layer) => this.inGroup(layer, prefix) && !layer.guide) : this.groupingMembers(this.selectedLayers(), ungroup);
    if (!layers.length || layers.some((layer) => this.isEffectivelyLocked(layer)) || (!ungroup && layers.length < 2)) return;
    if (!ungroup && layers.some((layer) => (layer.groupPath?.length ?? 0) >= 16)) return;
    this.commitStep(this.document());
    const ids = new Set(layers.map((layer) => layer.id)), group = crypto.randomUUID();
    this.document.update((doc) => ({
      ...doc,
      blends: ungroup ? doc.blends?.filter((blend) => !layers.some((layer) => layer.groupPath?.[depth] === blend.groupId)) : doc.blends,
      layers: doc.layers.map((layer) => ids.has(layer.id) ? {
        ...layer,
        regroupPath: ungroup ? [...layer.groupPath!] : undefined,
        groupPath: ungroup ? layer.groupPath!.filter((_, index) => index !== depth) : [...(layer.groupPath ?? []).slice(0, depth), group, ...(layer.groupPath ?? []).slice(depth)],
      } : layer),
    }));
    this.changed();
  }
  arrange(mode: Parameters<typeof alignLayers>[1], artboard = false) {
    const layers = this.selectedLayers().filter((l) => !this.isEffectivelyLocked(l) && !l.guide);
    if (!layers.length) return;
    const changed = alignLayers(
        layers,
        mode,
        artboard
          ? {
              x: 0,
              y: 0,
              width: this.document().width,
              height: this.document().height,
            }
          : undefined,
      ),
      map = new Map(changed.map((l) => [l.id, this.detachOpening(l)]));
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => map.get(l.id) ?? l),
    }));
    this.changed();
  }
  boolean(operation: Parameters<typeof booleanLayers>[1]) {
    if(this.selectedLayers().some(layer=>layer.dimension))return;
    if(this.booleanWalls(operation))return;
    // Procedural objects contribute their generated outline; the result is a plain path, not a parametric object.
    const layers = this.selectedLayers().filter((l) => !this.isEffectivelyLocked(l) && !l.guide)
      .map((l) => l.procedural ? { ...l, procedural: undefined, name: l.name } : l);
    if (layers.length < 2) return;
    try {
      const result = booleanLayers(layers, operation, crypto.randomUUID()),
        ids = new Set(layers.map((l) => l.id)),
        index = this.document().layers.findIndex((l) => l.id === layers[0].id);
      this.commitStep(this.document());
      const remaining = this.document().layers.filter((l) => !ids.has(l.id));
      remaining.splice(index, 0, result);
      this.document.update((d) => ({ ...d, layers: remaining }));
      this.selectedId.set(result.id);
      this.selectedIds.set([result.id]);
      this.changed();
    } catch (error) {
      this.status.set(
        error instanceof Error ? error.message : "Boolean operation failed",
      );
    }
  }
  private transformSelection(
    g: NonNullable<EditorService["gesture"]>,
    target: Layer,
  ) {
    const ids = new Set(g.ids ?? [g.id]);
    if (this.document().layers.some((layer) => ids.has(layer.id) && this.isEffectivelyLocked(layer))) return;
    if (!g.ids || g.ids.length === 1) {
      const resized = resizeLayer(this.detachOpening(g.original), target.width, target.height);
      this.setLayer(g.ids?.[0] ?? g.id, this.reflowText({
        ...target,
        points: resized.points,
        ...(resized.curves ? { curves: resized.curves } : {}),
        ...(resized.dimension ? { dimension: resized.dimension } : {}),
        ...(resized.procedural ? { procedural: resized.procedural } : {}),
      }));
      return;
    }
    this.expandGeneratedForIds(new Set(g.ids));
    const updates = new Map(
      transformLayers(
        g.before.layers.filter(
          (layer) => g.ids!.includes(layer.id) && !this.isEffectivelyLocked(layer) && !layer.guide,
        ),
        g.original,
        target,
        target.rotation - g.original.rotation,
      ).map((layer) => [layer.id, this.reflowText(this.detachUnselectedHost(layer,ids))]),
    );
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => updates.get(l.id) ?? l),
    }));
  }

  setTool(tool: ToolId) {
    const brushTypes: Partial<Record<ToolId, BrushType>> = { brush: "round", brushFlat: "flat", brushCalligraphy: "calligraphy", brushMarker: "marker", brushAirbrush: "airbrush", brushPencil: "pencil" };
    const brushType = brushTypes[tool];
    if (brushType) { this.setBrushType(brushType); tool = "brush"; }
    if (tool !== this.tool()) { this.finishPath(); this.dimensionDraft.set(null); this.dimensionSnapTarget.set(null); this.finishWallRun(); this.clearCut(); }
    this.activeNodes.set([]);
    this.tool.set(tool);
  }
  finishPath() {
    this.end();
    this.penId.set(null);
  }
  /** An open path whose first or last anchor is under the pointer, so drawing continues from it. */
  penContinuation(point: Point): { layer: Layer; atStart: boolean } | null {
    const radius = 10 / this.zoom();
    for (const layer of [...this.document().layers].reverse()) {
      if (layer.guide || layer.dimension || layer.procedural || !layer.visible || this.isEffectivelyLocked(layer)) continue;
      const path = layer.curves?.[0];
      if (!path || path.closed || path.nodes.length < 1 || layer.curves!.length !== 1) continue;
      const ends = [{ node: path.nodes[0], atStart: true }, { node: path.nodes.at(-1)!, atStart: false }];
      for (const end of ends) {
        const world = worldPoint(layer, end.node.point);
        if (Math.hypot(point.x - world.x, point.y - world.y) <= radius) return { layer, atStart: end.atStart };
      }
    }
    return null;
  }
  private startPen(point: Point, before: StudioDocument) {
    let layer = this.document().layers.find(
      (l) => l.id === this.penId() && !this.isEffectivelyLocked(l) && l.visible && !l.guide,
    );
    if (!layer) {
      // Clicking an end of an unlocked open path carries on with it instead of starting another object.
      const continuation = this.penContinuation(point);
      if (continuation) {
        const curves = structuredClone(continuation.layer.curves!);
        if (continuation.atStart) {
          curves[0].nodes.reverse();
          for (const node of curves[0].nodes) { const incoming = node.incoming; node.incoming = node.outgoing; node.outgoing = incoming; }
          this.setLayer(continuation.layer.id, { curves });
        }
        this.penId.set(continuation.layer.id);
        layer = this.document().layers.find((l) => l.id === continuation.layer.id);
      }
    }
    if (!layer) {
      if (this.document().layers.length >= 150) return;
      layer = newLayer(
        "path",
        crypto.randomUUID(),
        { x: 0, y: 0 },
        this.fill(),
        this.stroke(),
        this.size(),
      );
      layer.strokeStyle = { ...this.strokeStyle() };
    if(layer.kind === "path") layer.lineEnds=structuredClone(this.lineEnds());
      layer.name = "Bézier path";
      layer.curves = [{ nodes: [], closed: false }];
      this.document.update((d) => ({ ...d, layers: [...d.layers, layer!] }));
      this.penId.set(layer.id);
    }
    const curves = structuredClone(layer.curves!),
      path = curves[0],
      p = localPoint(layer, point);
    this.selectedId.set(layer.id);
    if (
      path.nodes.length > 2 &&
      Math.hypot(p.x - path.nodes[0].point.x, p.y - path.nodes[0].point.y) <
        10 / this.zoom()
    ) {
      path.closed = true;
      this.setLayer(layer.id, { curves });
      this.commitStep(before);
      this.penId.set(null);
      this.changed();
      return;
    }
    if (path.nodes.length >= 2000) return;
    path.nodes.push(anchor(p));
    this.setLayer(layer.id, { curves });
    const original = { ...structuredClone(layer), curves };
    this.gesture = {
      before,
      start: point,
      last: point,
      id: layer.id,
      points: [],
      original,
      mode: "pen",
    };
  }
  private editableCurves(layer: Layer): CurvePath[] {
    if (layer.curves) return structuredClone(layer.curves);
    if (layer.kind === "path") return [polyline(layer.points)];
    if (layer.kind === "ellipse")
      return [
        ellipsePath(
          layer.width / 2,
          layer.height / 2,
          layer.width / 2,
          layer.height / 2,
        ),
      ];
    return [
      polyline(
        [
          { x: 0, y: 0 },
          { x: layer.width, y: 0 },
          { x: layer.width, y: layer.height },
          { x: 0, y: layer.height },
        ],
        true,
      ),
    ];
  }
  private findCurveNode(layer: Layer, point: Point) {
    let hit:
      | { path: number; index: number; part: "point" | "incoming" | "outgoing" }
      | undefined;
    let distance = 9 / this.zoom();
    layer.curves?.forEach((path, pathIndex) => {
      path.nodes.forEach((node, index) => {
        for (const part of ["point", "incoming", "outgoing"] as const) {
          if (part !== "point" && !this.showHandles()) continue;
          const world = worldPoint(layer, node[part]);
          const candidate = Math.hypot(world.x - point.x, world.y - point.y);
          if (candidate < distance) {
            distance = candidate;
            hit = { path: pathIndex, index, part };
          }
        }
      });
    });
    return hit;
  }
  /**
   * The cutting tools work with two clicks, not a drag: the scissors open a path at two of
   * its own points, the knife divides the closed shapes its line crosses. The first click
   * is remembered and drawn until the second one lands or Escape cancels it.
   */
  readonly cutPending = signal<{ tool: "scissors" | "knife"; point: Point } | null>(null);
  readonly cutPreview = signal<Point | null>(null);
  private scissorMark?: { id: string; path: number; segment: number; t: number };
  private cutClick(point: Point, before: StudioDocument, tool: "scissors" | "knife") {
    if (tool === "scissors") this.scissorClick(point, before);
    else this.knifeClick(point, before);
  }
  /** The path under the pointer, in a shape this editor can cut. */
  private cuttableLayer(point: Point): Layer | null {
    const candidates = [this.selected(), pick(this.document().layers, point)];
    for (const candidate of candidates) {
      if (!candidate || this.isEffectivelyLocked(candidate) || !candidate.visible || candidate.guide) continue;
      if (candidate.dimension || candidate.procedural || ["image", "text"].includes(candidate.kind)) continue;
      const curves = this.editableCurves(candidate);
      if (!curves.length) continue;
      const near = nearestSegment(curves, localPoint(candidate, point));
      if (near && near.distance <= 12 / this.zoom()) return candidate;
    }
    return null;
  }
  private scissorClick(point: Point, before: StudioDocument) {
    const layer = this.cuttableLayer(point);
    if (!layer) { this.status.set("Click on a path to cut it."); return; }
    const curves = this.editableCurves(layer);
    const near = nearestSegment(curves, localPoint(layer, point))!;
    const mark = this.scissorMark;
    if (!mark || mark.id !== layer.id || mark.path !== near.path) {
      this.scissorMark = { id: layer.id, path: near.path, segment: near.segment, t: near.t };
      this.cutPending.set({ tool: "scissors", point });
      this.status.set("Choose the second cut point on the same path.");
      this.revision.update((x) => x + 1);
      return;
    }
    const pieces = scissorCut(curves[near.path], { segment: mark.segment, t: mark.t }, { segment: near.segment, t: near.t });
    this.clearCut();
    if (!pieces || pieces.length < 2) { this.status.set("Both cuts fall on the same point."); return; }
    const rest = curves.filter((_, index) => index !== near.path);
    this.replaceWithPieces(before, layer, pieces, rest);
    this.status.set(`Cut into ${pieces.length} open paths.`);
  }
  private knifeClick(point: Point, before: StudioDocument) {
    const pending = this.cutPending();
    if (!pending || pending.tool !== "knife") {
      this.cutPending.set({ tool: "knife", point });
      this.cutPreview.set(point);
      this.status.set("Click again to cut along the line.");
      this.revision.update((x) => x + 1);
      return;
    }
    const from = pending.point;
    this.clearCut();
    const targets = (this.selectedLayers().length ? this.selectedLayers() : this.document().layers).filter(
      (layer) => !this.isEffectivelyLocked(layer) && layer.visible && !layer.guide && !layer.dimension
        && !layer.procedural && !["image", "text"].includes(layer.kind));
    for (const layer of targets) {
      const curves = this.editableCurves(layer);
      const index = curves.findIndex((path) => path.closed
        && !!knifeCut(this.worldCurve(layer, path), from, point));
      if (index < 0) continue;
      const pieces = knifeCut(this.worldCurve(layer, curves[index]), from, point)!;
      const rest = curves.filter((_, other) => other !== index).map((path) => this.worldCurve(layer, path));
      this.replaceWithPieces(before, layer, pieces, rest, true);
      this.status.set("Cut into two closed shapes.");
      return;
    }
    this.status.set("The knife needs a line that crosses a closed shape twice.");
  }
  /** Local geometry of a contour in document coordinates, which is where a cut is measured. */
  private worldCurve(layer: Layer, path: CurvePath): CurvePath {
    return {
      closed: path.closed,
      nodes: path.nodes.map((node) => ({
        point: worldPoint(layer, node.point),
        incoming: worldPoint(layer, node.incoming),
        outgoing: worldPoint(layer, node.outgoing),
        smooth: node.smooth,
      })),
    };
  }
  /**
   * Replaces a layer with one layer per piece, keeping its appearance. Pieces arrive in the
   * layer coordinates unless `world` says they are already in document coordinates.
   */
  private replaceWithPieces(before: StudioDocument, layer: Layer, pieces: CurvePath[], rest: CurvePath[], world = false) {
    // A piece becomes its own layer with the appearance of the original and no transform of
    // its own, since its geometry is already where the cut left it.
    const build = (curves: CurvePath[]): Layer => {
      const fresh = fitCurves({ ...newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }), rotation: 0 },
        world ? curves : curves.map((path) => this.worldCurve(layer, path)));
      return { ...layer, ...fresh, id: fresh.id, kind: "path", rotation: 0, flipX: false, flipY: false, skewX: 0, points: [] };
    };
    const placed = pieces.map((piece) => build([piece]));
    const kept = rest.length ? [build(rest)] : [];
    this.commitStep(before);
    this.document.update((document) => ({
      ...document,
      layers: document.layers.flatMap((item) => (item.id === layer.id ? [...kept, ...placed] : [item])),
    }));
    this.selectedIds.set(placed.map((piece) => piece.id));
    this.selectedId.set(placed[0].id);
    this.activeNodes.set([]);
    this.changed();
  }
  /** Forgets a cut in progress, which Escape and a tool change both do. */
  clearCut() {
    this.scissorMark = undefined;
    this.cutPending.set(null);
    this.cutPreview.set(null);
  }
  private startPathEdit(
    point: Point,
    before: StudioDocument,
    modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    tool = this.tool(),
  ) {
    let layer = this.selected();
    let hit: ReturnType<EditorService["findCurveNode"]>;
    if (layer && !this.isEffectivelyLocked(layer) && layer.visible && !layer.guide) {
      if (
        !layer.curves &&
        ["path", "rectangle", "ellipse"].includes(layer.kind)
      )
        layer = { ...layer, kind: "path", curves: this.editableCurves(layer) };
      hit = this.findCurveNode(layer, point);
    }
    if (!hit) {
      layer = pick(this.document().layers.filter(layer=>!layer.dimension || this.dimensionsVisible()), point) ?? null;
      if (layer) {
        if (
          !layer.curves &&
          ["path", "rectangle", "ellipse"].includes(layer.kind)
        )
          layer = {
            ...layer,
            kind: "path",
            curves: this.editableCurves(layer),
          };
        hit = this.findCurveNode(layer, point);
      }
    }
    if (
      !layer ||
      this.isEffectivelyLocked(layer) ||
      !layer.visible || layer.dimension || layer.procedural ||
      ["image", "text"].includes(layer.kind)
    ) {
      this.selectedId.set(null);
      return;
    }
    if (this.selectedId() !== layer.id) this.activeNodes.set([]);
    this.selectedIds.set([layer.id]);
    this.selectedId.set(layer.id);
    const curves = this.editableCurves(layer),
      p = localPoint(layer, point);
    if (tool === "smooth") {
      this.commitStep(before);
      this.setLayer(
        layer.id,
        fitCurves(
          { ...layer, kind: "path" },
          curves.map((c) => smoothPath(c)),
        ),
      );
      this.changed();
      return;
    }
    if (tool === "pathEraser") {
      this.gesture = {
        before,
        start: point,
        last: point,
        id: layer.id,
        points: [],
        original: layer,
        mode: tool,
      };
      this.erasePath(point);
      return;
    }
    if (tool === "addAnchor") {
      const near = nearestSegment(curves, p);
      if (!near || near.distance > 12 / this.zoom()) return;
      curves[near.path] = splitSegment(curves[near.path], near.segment, near.t);
      this.commitStep(before);
      this.setLayer(layer.id, { kind: "path", curves });
      this.changed();
      return;
    }
    if (!hit) {
      this.setLayer(layer.id, { kind: "path", curves });
      return;
    }
    this.setLayer(layer.id, { kind: "path", curves });
    const key = hit.path + ":" + hit.index;
    if (tool === "deleteAnchor") {
      curves[hit.path].nodes.splice(hit.index, 1);
      this.commitStep(before);
      this.setLayer(layer.id, { curves: curves.filter((c) => c.nodes.length) });
      this.activeNodes.set([]);
      this.changed();
      return;
    }
    if (tool === "convertAnchor") {
      const node = curves[hit.path].nodes[hit.index];
      if (node.smooth) {
        curves[hit.path].nodes[hit.index] = anchor(node.point);
      } else {
        const smoothed = smoothPath(curves[hit.path]);
        curves[hit.path].nodes[hit.index] = smoothed.nodes[hit.index];
      }
      this.commitStep(before);
      this.setLayer(layer.id, { curves });
      this.changed();
      return;
    }
    const deselectNodeOnClick =
      modifiers.shift && hit.part === "point" && this.activeNodes().includes(key)
        ? key
        : undefined;
    if (modifiers.shift && hit.part === "point") {
      if (!this.activeNodes().includes(key))
        this.activeNodes.update((keys) => [...keys, key]);
    } else if (!this.activeNodes().includes(key)) this.activeNodes.set([key]);
    this.gesture = {
      before,
      start: point,
      last: point,
      id: layer.id,
      points: [],
      original: structuredClone({ ...layer, curves }),
      mode: "node:" + hit.path + ":" + hit.index + ":" + hit.part,
      deselectNodeOnClick,
    };
  }
  private dragNode(
    point: Point,
    modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean },
  ) {
    const g = this.gesture!;
    const [, pi, ni, part] = g.mode.split(":"),
      curves = structuredClone(g.original.curves!),
      node = curves[+pi].nodes[+ni],
      origin = part === "point" ? g.start : worldPoint(g.original, node.point),
      end = modifiers.shift
        ? snapDirection(origin, point, this.snapAngle())
        : point,
      p = localPoint(g.original, end),
      independent = modifiers.ctrl || modifiers.alt;
    if (part === "point") {
      const origin = localPoint(g.original, g.start),
        dx = p.x - origin.x,
        dy = p.y - origin.y;
      curves.forEach((path, i) =>
        path.nodes.forEach((n, j) => {
          if (this.activeNodes().includes(i + ":" + j))
            path.nodes[j] = moveAnchor(n, {
              x: n.point.x + dx,
              y: n.point.y + dy,
            });
        }),
      );
    } else {
      node[part as "incoming" | "outgoing"] = p;
      if (node.smooth && !independent) {
        const other = part === "incoming" ? "outgoing" : "incoming",
          center = worldPoint(g.original, node.point),
          opposite = worldPoint(g.original, node[other]),
          length = Math.hypot(opposite.x - center.x, opposite.y - center.y),
          dx = end.x - center.x,
          dy = end.y - center.y,
          mag = Math.hypot(dx, dy);
        if (mag > 0)
          node[other] = localPoint(g.original, {
            x: center.x - (dx / mag) * length,
            y: center.y - (dy / mag) * length,
          });
      }
      if (independent) node.smooth = false;
    }
    this.setLayer(g.id, { curves });
  }
  pathAction(
    action:
      | "close"
      | "smooth"
      | "simplify"
      | "average"
      | "join"
      | "cleanup"
      | "extend",
  ) {
    const layer = this.selected();
    if (!layer || this.isEffectivelyLocked(layer) || layer.guide || layer.dimension || layer.procedural || ["image", "text"].includes(layer.kind))
      return;
    let curves = this.editableCurves(layer);
    if (action === "extend") {
      this.setLayer(layer.id, { kind: "path", curves });
      this.penId.set(layer.id);
      this.tool.set("pen");
      return;
    }
    this.commitStep(this.document());
    if (action === "close")
      curves = curves.map((c) => ({ ...c, closed: !c.closed }));
    if (action === "smooth") curves = curves.map((c) => smoothPath(c));
    if (action === "simplify")
      curves = curves.map((c) =>
        polyline(simplifyPoints(flatten(c), 2), c.closed),
      );
    if (action === "cleanup") curves = curves.filter((c) => c.nodes.length > 1);
    if (action === "average") {
      const nodes = curves.flatMap((c, i) =>
        c.nodes.filter((_, j) => this.activeNodes().includes(i + ":" + j)),
      );
      if (nodes.length > 1) {
        const p = {
          x: nodes.reduce((v, n) => v + n.point.x, 0) / nodes.length,
          y: nodes.reduce((v, n) => v + n.point.y, 0) / nodes.length,
        };
        curves = curves.map((c, i) => ({
          ...c,
          nodes: c.nodes.map((n, j) =>
            this.activeNodes().includes(i + ":" + j) ? moveAnchor(n, p) : n,
          ),
        }));
      }
    }
    if (action === "join" && curves.length > 1) {
      curves = [{ nodes: curves.flatMap((c) => c.nodes), closed: false }];
    }
    this.setLayer(
      layer.id,
      fitCurves({ ...layer, kind: "path", points: [] }, curves),
    );
    this.activeNodes.set([]);
    this.changed();
  }
  /** Walls combine as walls: the result is straight runs of the operands, still parametric. */
  private booleanWalls(operation: WallOperation): boolean {
    const layers = this.selectedLayers().filter((layer) => !this.isEffectivelyLocked(layer) && !layer.guide);
    const axes = layers.map((layer) => wallAxis(layer));
    if (layers.length < 2 || axes.some((axis) => !axis)) return false;
    const results = wallBoolean(axes.filter((axis) => !!axis), operation);
    if (!results.length) { this.status.set("The operation leaves no wall."); return true; }
    const before = this.document();
    const ids = new Set(layers.map((layer) => layer.id));
    const index = before.layers.findIndex((layer) => ids.has(layer.id));
    const built = results
      .map((result) => this.buildWallLayer(result.source, result.start, result.end, result.source.procedural as { thickness: number; align?: "center" | "left" | "right" }))
      .filter((layer): layer is Layer => !!layer);
    if (!built.length) { this.status.set("The operation leaves no wall."); return true; }
    const remaining = before.layers.filter((layer) => !ids.has(layer.id));
    remaining.splice(index, 0, ...built);
    let next: StudioDocument;
    try { next = syncProcedurals({ ...before, layers: remaining }); parseDocument(JSON.stringify(next)); }
    catch { this.status.set("The operation leaves no wall."); return true; }
    this.commitStep(before);
    this.document.set(next);
    this.selectedIds.set(built.map((layer) => layer.id));
    this.selectedId.set(built.at(-1)!.id);
    this.changed();
    return true;
  }
  private buildWallLayer(source: Layer, start: Point, end: Point, procedure: { thickness: number; align?: "center" | "left" | "right" }): Layer | null {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return null;
    const layer: Layer = {
      ...source,
      id: crypto.randomUUID(),
      x: start.x, y: start.y, width: 1, height: 1,
      rotation: 0, skewX: 0, flipX: false, flipY: false,
      points: [],
      procedural: { type: "wall", start: { x: 0, y: 0 }, end: { x: end.x - start.x, y: end.y - start.y }, thickness: procedure.thickness, ...(procedure.align ? { align: procedure.align } : {}) },
    };
    return generateProcedural(layer);
  }
  /** Shifts a transform that works about the selection centre so the pivot stays put instead. */
  private aroundPivot(original: Layer, target: Layer): Layer {
    const pivot = this.pivot();
    const centre = { x: original.x + original.width / 2, y: original.y + original.height / 2 };
    const dx = pivot.x - centre.x, dy = pivot.y - centre.y;
    if (!dx && !dy) return target;
    const scaleX = original.width ? target.width / original.width : 1;
    const scaleY = original.height ? target.height / original.height : 1;
    const angle = ((target.rotation ?? 0) - (original.rotation ?? 0)) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const mapped = { x: cos * dx * scaleX - sin * dy * scaleY, y: sin * dx * scaleX + cos * dy * scaleY };
    return { ...target, x: target.x + dx - mapped.x, y: target.y + dy - mapped.y };
  }
  transformationCenter(): Point {
    const layer=this.selected(),keys=new Set(this.activeNodes());
    const points=layer?.curves?.flatMap((p,i)=>p.nodes.filter((_,j)=>keys.has(i+':'+j)).map(n=>worldPoint(layer,n.point)))??[];
    if(points.length)return {x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length};
    const box=selectionBounds(this.selectedLayers());return {x:box.x+box.width/2,y:box.y+box.height/2};
  }
  private numericTransform(map:(point:Point)=>Point,rotation=0):boolean {
    const layers=this.selectedLayers();if(!layers.length||layers.some(l=>this.isEffectivelyLocked(l)||l.guide))return false;
    const primary=this.selected(),keys=new Set(this.activeNodes()),ids=new Set(layers.map(l=>l.id));
    const before=this.document();let next:StudioDocument;
    if(primary?.curves&&keys.size&&layers.length===1){
      const curves=structuredClone(primary.curves);let changed=false;
      curves.forEach((p,i)=>p.nodes.forEach((node,j)=>{if(!keys.has(i+':'+j))return;changed=true;for(const part of ['point','incoming','outgoing'] as const)node[part]=localPoint(primary,map(worldPoint(primary,node[part])));}));
      if(!changed)return false;const layer=fitCurves(primary,curves);next={...before,layers:before.layers.map(l=>l.id===primary.id?layer:l)};
    }else{
      next={...before,layers:before.layers.map(l=>{if(!ids.has(l.id))return l;const center=map({x:l.x+l.width/2,y:l.y+l.height/2});return {...l,x:center.x-l.width/2,y:center.y-l.height/2,rotation:l.rotation+rotation};})};
    }
    next={...next,layers:next.layers.map(layer=>ids.has(layer.id)?this.detachUnselectedHost(layer,ids):layer)};
    try{next=syncProcedurals(next);parseDocument(JSON.stringify(next));}catch{return false;}
    this.commitStep(before);this.expandGeneratedForIds(ids);this.document.set({...next,blends:this.document().blends});this.changed();return true;
  }
  displaceSelection(dx:number,dy:number):boolean {
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>1e6||Math.abs(dy)>1e6||(!dx&&!dy))return false;
    this.recordTransform({ dx, dy });
    return this.numericTransform(p=>({x:p.x+dx,y:p.y+dy}));
  }
  rotateSelection(angle:number,center:Point=this.pivot()):boolean {
    if(!Number.isFinite(angle)||!Number.isFinite(center.x)||!Number.isFinite(center.y)||Math.abs(angle)>36000||angle===0)return false;
    this.recordTransform({ rotation: angle });
    const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
    return this.numericTransform(p=>({x:center.x+(p.x-center.x)*c-(p.y-center.y)*s,y:center.y+(p.x-center.x)*s+(p.y-center.y)*c}),angle);
  }

  nudge(dx: number, dy: number) {
    const layer = this.selected();
    if (!layer || this.isEffectivelyLocked(layer) || layer.guide) return;
    this.commitStep(this.document());
    if (this.tool() === "direct" && layer.curves && this.activeNodes().length) {
      const curves = structuredClone(layer.curves);
      curves.forEach((c, i) =>
        c.nodes.forEach((n, j) => {
          if (this.activeNodes().includes(i + ":" + j))
            c.nodes[j] = moveAnchor(n, {
              x: n.point.x + dx,
              y: n.point.y + dy,
            });
        }),
      );
      this.setLayer(layer.id, fitCurves(layer, curves));
    } else {
      const ids = new Set(
        this.selectedLayers()
          .filter((l) => !this.isEffectivelyLocked(l) && !l.guide)
          .map((l) => l.id),
      );
      this.document.update((d) => ({
        ...d,
        layers: d.layers.map((l) =>
          ids.has(l.id) ? { ...this.detachUnselectedHost(l,ids), x: l.x + dx, y: l.y + dy } : l,
        ),
      }));
      this.shiftPivot(dx, dy);
    }
    this.changed();
  }
  private erasePath(point: Point) {
    const g = this.gesture!,
      layer = this.document().layers.find((l) => l.id === g.id)!;
    const curves = eraseStroke(
      this.editableCurves(layer),
      localPoint(layer, point),
      this.size() / 2,
    );
    this.setLayer(layer.id, { kind: "path", curves });
  }
  private eraseVector(point: Point) {
    if(this.document().layers.find(l=>l.id===this.gesture?.id)?.dimension || this.document().layers.find(l=>l.id===this.gesture?.id)?.procedural)return;
    const g = this.gesture!,
      layer = this.document().layers.find((l) => l.id === g.id)!;
    const paths = this.editableCurves(layer),
      p = localPoint(layer, point),
      radius = this.size() / 2;
    const curves = [
      ...eraseFilled(
        paths.filter((c) => c.closed),
        p,
        radius,
      ),
      ...eraseStroke(
        paths.filter((c) => !c.closed),
        p,
        radius,
      ),
    ];
    if (curves.reduce((n, c) => n + c.nodes.length, 0) <= 20000)
      this.setLayer(layer.id, { kind: "path", curves });
  }

  defineSymbol() {
    const layer = this.selected();
    if (!layer || this.isEffectivelyLocked(layer) || layer.guide || layer.dimension || layer.procedural) return;
    const symbols = this.document().symbols ?? [];
    if (symbols.length >= 100) return;
    this.commitStep(this.document());
    const id = crypto.randomUUID(),
      template = structuredClone(layer);
    delete template.symbolId;
    delete template.groupPath;
    delete template.traceSourceId;
    this.document.update((d) => ({
      ...d,
      symbols: [...symbols, { id, name: layer.name, layer: template }],
      layers: d.layers.map((l) =>
        l.id === layer.id ? { ...l, symbolId: id } : l,
      ),
    }));
    this.activeSymbol.set(id);
    this.changed();
  }
  placeSymbol(point: Point = { x: 80, y: 80 }) {
    const symbol = this.document().symbols?.find(
      (s) => s.id === this.activeSymbol(),
    );
    if (!symbol || this.document().layers.length >= 150) return;
    this.commitStep(this.document());
    this.addInstance(point);
    this.changed();
  }
  private addInstance(point: Point) {
    const symbol = this.document().symbols?.find(
      (s) => s.id === this.activeSymbol(),
    );
    if (!symbol || this.document().layers.length >= 150) return;
    const layer = {
      ...structuredClone(symbol.layer),
      id: crypto.randomUUID(),
      symbolId: symbol.id,
      x: point.x - symbol.layer.width / 2,
      y: point.y - symbol.layer.height / 2,
      locked: false,
      visible: true,
    };
    this.document.update((d) => ({ ...d, layers: [...d.layers, layer] }));
    this.selectedId.set(layer.id);
  }
  symbolAction(
    action:
      | "redefine"
      | "expand"
      | "replace"
      | "nineSlice"
      | "rename"
      | "duplicate",
    name = "",
  ) {
    const layer = this.selected(),
      id = this.activeSymbol();
    if (!layer || this.isEffectivelyLocked(layer) || layer.guide || layer.dimension || layer.procedural) return;
    const symbol = this.document().symbols?.find((s) => s.id === id);
    if (!symbol && action !== "expand") return;
    this.commitStep(this.document());
    if (action === "expand") {
      const copy = { ...layer };
      delete copy.symbolId;
      this.document.update((d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === copy.id ? copy : l)),
      }));
    }
    if (action === "replace" && symbol) {
      this.setLayer(layer.id, {
        ...resizeLayer(symbol.layer, layer.width, layer.height),
        id: layer.id,
        x: layer.x,
        y: layer.y,
        rotation: layer.rotation,
        symbolId: symbol.id,
        locked: false,
        visible: true,
      });
    }
    if (action === "nineSlice") {
      this.setLayer(
        layer.id,
        nineSlice(
          { ...layer, kind: "path", curves: this.editableCurves(layer) },
          layer.width * 1.25,
          layer.height * 1.25,
        ),
      );
    }
    if (action === "rename" && symbol)
      this.document.update((d) => ({
        ...d,
        symbols: d.symbols?.map((s) =>
          s.id === id ? { ...s, name: name.slice(0, 150) } : s,
        ),
      }));
    if (
      action === "duplicate" &&
      symbol &&
      (this.document().symbols?.length ?? 0) < 100
    ) {
      const copy = {
        ...structuredClone(symbol),
        id: crypto.randomUUID(),
        name: symbol.name + " copy",
      };
      this.document.update((d) => ({ ...d, symbols: [...d.symbols!, copy] }));
      this.activeSymbol.set(copy.id);
    }
    if (action === "redefine" && symbol) {
      const template = structuredClone(layer);
      delete template.symbolId;
      delete template.groupPath;
      delete template.traceSourceId;
      this.document.update((d) => ({
        ...d,
        symbols: d.symbols?.map((s) =>
          s.id === id ? { ...s, layer: template } : s,
        ),
        layers: d.layers.map((l) =>
          l.symbolId === id
            ? {
                ...resizeLayer(template, l.width, l.height),
                id: l.id,
                x: l.x,
                y: l.y,
                rotation: l.rotation,
                opacity: l.opacity,
                symbolId: id,
                groupPath: l.groupPath,
                flipX: l.flipX,
                flipY: l.flipY,
                skewX: l.skewX,
                locked: l.locked,
                visible: l.visible,
              }
            : l,
        ),
      }));
    }
    this.changed();
  }
  exportSymbols() {
    this.download(
      new Blob(
        [
          JSON.stringify({
            ...blankDocument(),
            symbols: this.document().symbols ?? [],
          }),
        ],
        { type: "application/json" },
      ),
      "symbols.xds",
    );
  }
  importSymbols(text: string) {
    const imported = parseDocument(text).symbols ?? [],
      current = this.document().symbols ?? [];
    if (current.length + imported.length > 100)
      throw new Error("Symbol library limit exceeded");
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      symbols: [
        ...current,
        ...imported.map((s) => ({ ...s, id: crypto.randomUUID() })),
      ],
    }));
    this.changed();
  }
  private startSymbol(point: Point, before: StudioDocument) {
    if (!this.activeSymbol()) {
      this.status.set("Choose a symbol in the Drawing panel first");
      return;
    }
    const template = this.document().symbols?.find(
      (s) => s.id === this.activeSymbol(),
    )?.layer;
    if (!template) return;
    this.gesture = {
      before,
      start: point,
      last: point,
      id: "",
      points: [],
      original: template,
      mode: this.tool(),
    };
    this.paintSymbols(point, false);
  }
  private paintSymbols(point: Point, reverse = false) {
    const g = this.gesture!;
    if (g.mode === "spray") {
      if (
        g.points.length &&
        Math.hypot(point.x - g.last.x, point.y - g.last.y) < 10
      )
        return;
      if (reverse) {
        const radius = this.symbolRadius();
        this.document.update((d) => ({
          ...d,
          layers: d.layers.filter(
            (l) =>
              l.locked ||
              l.symbolId !== this.activeSymbol() ||
              Math.hypot(
                l.x + l.width / 2 - point.x,
                l.y + l.height / 2 - point.y,
              ) > radius,
          ),
        }));
      } else this.addInstance(point);
      g.points.push(point);
    } else
      this.document.update((d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.symbolId === this.activeSymbol() &&
          !this.isEffectivelyLocked(l) &&
          l.visible &&
          Math.hypot(
            l.x + l.width / 2 - point.x,
            l.y + l.height / 2 - point.y,
          ) <= this.symbolRadius()
            ? symbolEffect(
                l,
                g.mode,
                point,
                { x: point.x - g.last.x, y: point.y - g.last.y },
                this.symbolIntensity(),
                reverse,
                this.fill(),
              )
            : l,
        ),
      }));
  }
  templateImage() {
    const layer = this.selected();
    if (layer?.kind === "image") {
      this.updateLayer({ opacity: 0.35, locked: true });
    }
  }
  async traceImage(options: TraceOptions) {
    const selected = this.selected();
    const source = selected?.traceSourceId
      ? this.document().layers.find((l) => l.id === selected.traceSourceId)
      : selected;
    if (!source || source.kind !== "image") return;
    const bitmap = await createImageBitmap(
        await (await fetch(source.source)).blob(),
      ),
      canvas = window.document.createElement("canvas"),
      scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const regions = tracePixels(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      options,
    );
    const current = this.document();
    if (!current.layers.some((l) => l === source))
      throw new Error("Source changed while tracing; try again");
    const retained = current.layers.filter(
      (l) => l.traceSourceId !== source.id,
    );
    if (retained.length + regions.length > 150)
      throw new Error("Trace exceeds the layer limit; reduce color levels");
    const traced = regions.map((region) => ({
      ...newLayer(
        "path",
        crypto.randomUUID(),
        { x: source.x, y: source.y },
        region.color,
        region.color,
        0,
      ),
      name: "Trace " + region.color,
      width: source.width,
      height: source.height,
      rotation: source.rotation,
      traceSourceId: source.id,
      curves: mapCurves(region.curves, (p) => ({
        x: (p.x * source.width) / canvas.width,
        y: (p.y * source.height) / canvas.height,
      })),
    }));
    this.commitStep(current);
    this.document.set({
      ...current,
      layers: [
        ...retained.map((l) =>
          l.id === source.id ? { ...l, visible: false } : l,
        ),
        ...traced,
      ],
    });
    this.selectedId.set(traced[0]?.id ?? source.id);
    this.changed();
  }
  traceAction(action: "release" | "expand") {
    const selected = this.selected(),
      id = selected?.traceSourceId ?? selected?.id;
    if (!id) return;
    this.commitStep(this.document());
    if (action === "release")
      this.document.update((d) => ({
        ...d,
        layers: d.layers
          .filter((l) => l.traceSourceId !== id)
          .map((l) => (l.id === id ? { ...l, visible: true } : l)),
      }));
    else
      this.document.update((d) => ({
        ...d,
        layers: d.layers.map((l) => {
          if (l.traceSourceId !== id) return l;
          const copy = { ...l };
          delete copy.traceSourceId;
          return copy;
        }),
      }));
    this.changed();
  }
  async importImage(file: File) {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 20_000_000
    )
      throw new Error("Choose a PNG, JPEG or WebP image under 20 MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const layer = newLayer("image", crypto.randomUUID(), { x: 40, y: 40 });
    layer.name = file.name.slice(0, 150);
    layer.width = canvas.width;
    layer.height = canvas.height;
    layer.source = canvas.toDataURL("image/png");
    if (this.document().layers.length >= 150)
      throw new Error("Preview limit: 150 layers");
    this.commitStep(this.document());
    this.document.update((d) => ({ ...d, layers: [...d.layers, layer] }));
    this.selectedId.set(layer.id);
    this.tool.set("select");
    this.changed();
  }
  /**
   * Imports a drawing or an image. The file is data: vector readers parse it in the domain,
   * every produced layer goes through the native validator, and an import that cannot be
   * validated leaves the document untouched.
   */
  async importFile(file: File) {
    const name = file.name.toLowerCase();
    if (file.type.startsWith("image/") && file.type !== "image/svg+xml") return this.importImage(file);
    if (name.endsWith(".svg") || file.type === "image/svg+xml") {
      if (file.size > 20_000_000) throw new Error("Choose a drawing under 20 MB.");
      return this.placeImport(importSvg(await file.text(), { name: file.name.slice(0, 80) }));
    }
    if (name.endsWith(".dxf")) {
      if (file.size > 20_000_000) throw new Error("Choose a drawing under 20 MB.");
      return this.placeImport(importDxf(await file.text(), { name: file.name.slice(0, 80) }));
    }
    if (name.endsWith(".dwg")) throw new Error("DWG cannot be read; export the drawing as DXF and import that.");
    if (name.endsWith(".ai") || name.endsWith(".pdf")) throw new Error("PDF and Illustrator files are not supported yet; export the artwork as SVG.");
    return this.importImage(file);
  }
  /** Places an imported drawing as one history step, reporting what the reader skipped. */
  private placeImport(result: ImportResult) {
    if (!result.layers.length) throw new Error("The drawing has no content this editor can place.");
    const document = this.document();
    if (document.layers.length + result.layers.length > 150) throw new Error("Preview limit: 150 layers");
    const next = { ...document, layers: [...document.layers, ...result.layers] };
    parseDocument(JSON.stringify(next));
    this.commitStep(document);
    this.document.set(next);
    this.selectedIds.set(result.layers.map((layer) => layer.id));
    this.selectedId.set(result.layers[0].id);
    this.tool.set("select");
    this.status.set(result.skipped.length
      ? `Imported ${result.layers.length} objects; not supported: ${result.skipped.join(", ")}.`
      : `Imported ${result.layers.length} objects.`);
    this.changed();
  }
  download(content: Blob, name: string) {
    const url = URL.createObjectURL(content),
      link = window.document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  save() {
    this.download(
      new Blob([JSON.stringify(this.document())], { type: "application/json" }),
      this.document().name + ".xds",
    );
    this.markSaved();
    this.status.set("Project file saved");
  }
  exportSvg() {
    this.download(
      new Blob([svgExport(this.document(), this.renderer.measureText)], { type: "image/svg+xml" }),
      this.document().name + ".svg",
    );
    this.status.set("SVG exported; raster layers remain embedded images");
  }
  async exportPng(document = this.document()) {
    const canvas = await this.renderer.export(document);
    canvas.toBlob((blob) => {
      if (blob) this.download(blob, document.name + ".png");
    }, "image/png");
  }
  /** The document of any open tab, the active one included. */
  documentOf(tabId: string): StudioDocument | null {
    if (tabId === this.activeTabId()) return this.document();
    return this.inactiveTabs()[tabId]?.document ?? null;
  }
  /**
   * Raster layers are re-encoded as JPEG here, where the canvas lives, so the PDF writer
   * receives bytes it can store and the domain stays free of the browser.
   */
  private async pdfImages(document: StudioDocument): Promise<Record<string, PdfImage>> {
    const images: Record<string, PdfImage> = {};
    for (const layer of document.layers) {
      if (layer.kind !== "image" || !layer.source || !layer.visible) continue;
      try {
        // The source is decoded by an image element, which needs no network API and is
        // therefore unaffected by the content security policy of the page.
        const element = new Image();
        element.src = layer.source;
        await element.decode();
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, element.naturalWidth || Math.round(layer.width));
        canvas.height = Math.max(1, element.naturalHeight || Math.round(layer.height));
        const context = canvas.getContext("2d")!;
        // A JPEG carries no transparency, so the image is composed over white first.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(element, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL("image/jpeg", 0.92).split(",")[1] ?? "";
        if (encoded) images[layer.id] = { data: atob(encoded), width: canvas.width, height: canvas.height };
      } catch { /* A layer whose source cannot be read is reported by the writer. */ }
    }
    return images;
  }
  /** Writes the chosen documents as one PDF file, one page each. */
  async exportPdf(tabIds: string[] = [this.activeTabId()]) {
    const documents = tabIds.map((id) => this.documentOf(id)).filter((document): document is StudioDocument => !!document);
    if (!documents.length) throw new Error("Choose at least one document to export.");
    const sources: PdfPageSource[] = [];
    for (const document of documents) sources.push({ document, images: await this.pdfImages(document) });
    const result = pdfDocument(sources);
    const bytes = new Uint8Array(result.data.length);
    for (let index = 0; index < result.data.length; index++) bytes[index] = result.data.charCodeAt(index) & 0xff;
    const name = documents.length === 1 ? documents[0].name : this.document().name + " and " + (documents.length - 1) + " more";
    this.download(new Blob([bytes], { type: "application/pdf" }), name + ".pdf");
    this.status.set(result.skipped.length
      ? `PDF exported; not represented: ${result.skipped.join(", ")}.`
      : `PDF exported with ${documents.length} page${documents.length > 1 ? "s" : ""}.`);
  }
  /** Exports the chosen documents in the chosen format; PDF collects them into one file. */
  async exportAs(format: "png" | "svg" | "pdf", tabIds: string[] = [this.activeTabId()]) {
    if (format === "pdf") return this.exportPdf(tabIds);
    for (const id of tabIds) {
      const document = this.documentOf(id);
      if (!document) continue;
      if (format === "svg") {
        this.download(new Blob([svgExport(document, this.renderer.measureText)], { type: "image/svg+xml" }), document.name + ".svg");
      } else await this.exportPng(document);
    }
    this.status.set(`Exported ${tabIds.length} document${tabIds.length > 1 ? "s" : ""} as ${format.toUpperCase()}.`);
  }
  /** Prints the chosen documents, one page each, through the printing dialog of the browser. */
  printDocuments(tabIds: string[] = [this.activeTabId()], open = (target: string) => window.open("", target)) {
    const documents = tabIds.map((id) => this.documentOf(id)).filter((document): document is StudioDocument => !!document);
    if (!documents.length) throw new Error("Choose at least one document to print.");
    const view = open("_blank");
    if (!view) { this.status.set("Allow pop-up windows to print."); return false; }
    const pages = documents.map((document) => `<section style="width:${document.width}px;height:${document.height}px">`
      + svgExport(document, this.renderer.measureText) + "</section>").join("");
    view.document.write(`<!DOCTYPE html><html><head><title>${documents[0].name}</title>`
      + "<style>@page{margin:0}body{margin:0}section{break-after:page;overflow:hidden}svg{width:100%;height:100%}</style>"
      + `</head><body onload="print()">${pages}</body></html>`);
    view.document.close();
    this.status.set(`Sent ${documents.length} document${documents.length > 1 ? "s" : ""} to the printing dialog.`);
    return true;
  }
}
