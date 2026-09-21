import { Procedural, defaultProcedural, generateProcedural, syncProcedurals, validProcedural } from "../../../../packages/domain/src/procedural";
import { openingHost, wallSnapPoint, WallSnap } from "./procedural-placement";
import { BrushSettings, BrushType, BRUSH_TYPES, brushStamps, defaultBrush, validBrushSettings } from "../../../../packages/domain/src/brush";
import { wallAxis, wallBoolean, WallOperation } from "../../../../packages/domain/src/wall-boolean";
import { MarginGuides, MARGIN_GUIDE_PREFIX, marginGuidePositions, readPageSetup, PageEdges, PageSize, PAGE_MAXIMUM, PAGE_MINIMUM, pageSizeFits, RegistrationMarks, REGISTRATION_LAYER_NAME, registrationFits, registrationLayer, resizePage } from "../../../../packages/domain/src/page-setup";
import { Dimension, DimensionFormat, defaultDimensionFormat, dimensionGeometry } from "../../../../packages/domain/src/dimensions";
import { LineEnds, defaultLineEnds, validLineEnds } from "../../../../packages/domain/src/line-endings";
import { snapDimensionPoint, snapDimensionOffset, DimensionSnap } from "./dimension-snapping";
import { AreaSelectionKind, SelectionArea, layerInsideArea, layerIntersectsArea, pointInPolygon, selectionAreaPolygon } from "../../../../packages/domain/src/selection-area";
import { blendCompatible, blendProgress, interpolateBlendLayer, syncBlends, ObjectBlend, BlendEasing } from "../../../../packages/domain/src/object-blend";
import { defaultTypography, defaultTextLayout, FONT_FAMILIES, layoutText, TextLayoutOptions, TextTypography } from "../../../../packages/domain/src/text-layout";
import { snapPoint, SnapConfig, rulerSnapSteps } from "../../../../packages/domain/src/measurements";
import { transformLayers } from "../../../../packages/domain/src/affine";
import {
  alignLayers,
  booleanLayers,
  selectionBounds,
} from "../../../../packages/domain/src/arrange";
import { convexHull, eraseArea } from "../../../../packages/domain/src/erase";
import {
  nineSlice,
  symbolEffect,
} from "../../../../packages/domain/src/symbols";
import {
  tracePixels,
  TraceOptions,
} from "../../../../packages/domain/src/tracing";
import {
  Anchor,
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

/** The marks a path tool shows beside the cursor, as Illustrator's cursors do. */
export type PathCursor = "newPath" | "continue" | "close" | "add" | "delete" | "convert" | "join" | "freehand" | null;
/** A selected path a freehand stroke edits: extended from an endpoint, or redrawn from a point. */
type FreehandTarget =
  | { layer: Layer; path: number; kind: "extend"; atStart: boolean }
  | { layer: Layer; path: number; kind: "redraw"; from: PathParameter };
import { ImportResult, importSvg } from "../../../../packages/domain/src/svg-import";
import { importDxf } from "../../../../packages/domain/src/dxf-import";
import { pdfArtwork, pdfFirstPage, pdfObjects } from "../../../../packages/domain/src/pdf-import";
import { epsArtwork, epsPostScript } from "../../../../packages/domain/src/eps-import";
import { knifeCut, scissorCut } from "../../../../packages/domain/src/cut";
import { outlineStroke } from "../../../../packages/domain/src/outline-stroke";
import { PathParameter, averagePoints, closeByJoin, closeFreehand, concatPieces, cutAtAnchors, deleteAnchor as deleteAnchorKeepingShape, dragSegment, joinPaths, nearestOnPath, placeAnchor, rangesNear, redrawPath, removeParts, removeRanges, reshapeWeights, stretch } from "../../../../packages/domain/src/path-edit";
import { DEFAULT_SIMPLIFY, FreehandOptions, FreehandToolOptions, PAINTBRUSH_DEFAULTS, PENCIL_DEFAULTS, SMOOTH_DEFAULTS, SimplifyOptions, fitFreehand, simplifyPath } from "../../../../packages/domain/src/path-fit";
import { BrushStroke, DEFAULT_BRUSH_STROKE, nibOutline } from "../../../../packages/domain/src/brush-stroke";
import { textOutlineGroups } from "../../../../packages/domain/src/text-outline";
import { FontOutlines } from "./font-outlines";
import { PdfImage, PdfPageSource, pdfDocument } from "../../../../packages/domain/src/pdf";
import { ArraySettings, arraySteps, copyLayer, validArraySettings } from "../../../../packages/domain/src/array-copy";
import {
  blankDocument,
  defaultStrokeStyle,
  StrokeStyle,
  validDashPattern,
  bounds,
  DocumentHistory,
  MAX_LAYERS,
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
/** Properties a whole selection shares, so editing one of them edits every selected object. */
const SHARED_APPEARANCE = ["fill", "stroke", "strokeWidth", "strokeStyle", "lineEnds", "opacity", "blend", "adjustments"];
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
    if (this.document().layers.length + steps * back.length > MAX_LAYERS) return false;
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
    if (before.layers.length - oldGenerated.size + steps * blend.backIds.length > MAX_LAYERS) return false;
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
    if(this.document().layers.length>=MAX_LAYERS)return false;
    let layer:Layer,next:StudioDocument;try{layer=this.proceduralLayer(type,start,end);next=syncProcedurals({...this.document(),layers:[...this.document().layers,layer]});parseDocument(JSON.stringify(next));}catch{return false;}
    this.commitStep(this.document());this.document.set(next);this.selectedId.set(layer.id);this.selectedIds.set([layer.id]);this.changed();return true;
  }
  private startProcedural(type:Procedural['type'],point:Point) {
    if(type==='door'||type==='window'){this.createProcedural(type,this.snap(point));return;}
    if(this.document().layers.length>=MAX_LAYERS)return;
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
    if(points.length<3||this.document().layers.length+points.length-1>MAX_LAYERS)return false;
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
    if(this.document().layers.length>=MAX_LAYERS)return false;
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
  /** The Pen adds and deletes anchors over a selected path unless this is turned off. */
  readonly autoAddDelete = signal(true);
  /** What the pointer would do if pressed now, shown as a mark beside the cursor. */
  readonly pathCursor = signal<PathCursor>(null);
  /** The anchor under the pointer, highlighted when the preference asks for it. */
  readonly hoverAnchor = signal<{ id: string; key: string } | null>(null);
  /**
   * The anchors drawn as selected: those chosen with the direct tools, and, while the Pen
   * draws, the last anchor it placed, which Illustrator shows as the one selected.
   */
  selectedAnchorKeys(): string[] {
    const drawing = this.drawingLayer();
    if (drawing && drawing.id === this.selectedId()) {
      const last = drawing.curves![0].nodes.length - 1;
      return last >= 0 ? [`0:${last}`] : [];
    }
    return this.activeNodes();
  }
  /** The selection tool Ctrl brings back while another tool is active. */
  readonly lastSelectionTool = signal<"select" | "direct">("select");
  readonly activeSymbol = signal<string | null>(null);
  readonly symbolRadius = signal(70);
  readonly symbolIntensity = signal(0.25);
  readonly showHandles = signal(true);
  /** Outline view: the artwork is drawn as contours, which is how a drawing is checked. */
  readonly outlineView = signal(false);
  toggleOutlineView() {
    this.outlineView.update((outline) => !outline);
    this.status.set(this.outlineView() ? "Outline view" : "Preview view");
    this.revision.update((x) => x + 1);
  }
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
    if ((id && (this.guidesLocked() || !existing || existing.locked || !existing.visible)) || (!id && doc.layers.length >= MAX_LAYERS)) return null;
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
  private areaGesture?: { ids: string[]; primary: string | null; nodes: string[]; shift: boolean; moved: boolean; anchors?: boolean };
  private startAreaSelection(point: Point, kind: AreaSelectionKind, shift: boolean, anchors = false) {
    this.lastAreaSelection.set(kind);
    this.areaGesture = { ids: this.selectedLayers().map(layer => layer.id), primary: this.selectedId(), nodes: [...this.activeNodes()], shift, moved: false, anchors };
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
    if (gesture.anchors) { this.selectAnchorsInArea(area, gesture.shift, gesture); return; }
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
    const ghosts = [...this.duplicationGhosts(), ...this.simplifyGhosts()];
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
  /**
   * Edits the properties of the selection. Appearance belongs to every selected object, a
   * whole group included, while place and size belong to the one the form is showing.
   */
  updateLayer(patch: Partial<Layer>) {
    let layer = this.selected();
    if (!layer || this.isEffectivelyLocked(layer) || layer.guide) return;
    const keys = Object.keys(patch);
    const shared = Object.fromEntries(Object.entries(patch).filter(([key]) => SHARED_APPEARANCE.includes(key))) as Partial<Layer>;
    let own = Object.fromEntries(Object.entries(patch).filter(([key]) => !SHARED_APPEARANCE.includes(key))) as Partial<Layer>;
    if (!keys.length) return;
    this.commitStep(this.document());
    if (Object.keys(own).length) {
      if(["x","y","width","height","rotation","skewX","flipX","flipY"].some(key=>key in own))layer=this.detachOpening(layer);
      if (own.width !== undefined || own.height !== undefined)
        own = {
          ...resizeLayer(
            layer,
            own.width ?? layer.width,
            own.height ?? layer.height,
          ),
          ...own,
        };
      this.setLayer(layer.id, this.reflowText({ ...layer, ...own }));
    }
    if (Object.keys(shared).length) {
      const ids = new Set(this.selectedLayers().filter((item) => !this.isEffectivelyLocked(item) && !item.guide).map((item) => item.id));
      this.expandGeneratedForIds(ids);
      this.document.update((document) => ({
        ...document,
        layers: document.layers.map((item) => ids.has(item.id) ? this.reflowText({ ...item, ...structuredClone(shared) }) : item),
      }));
    }
    this.changed();
  }
  /**
   * Applies a brush to the selected paths, changes it, or takes it off, as the Brushes
   * panel does: a path without its brush keeps its plain stroke.
   */
  setBrushStroke(change: Partial<BrushStroke> | null) {
    const targets = this.selectedLayers().filter((l) => l.kind === "path" && !l.dimension && !l.procedural && !l.guide && !this.isEffectivelyLocked(l));
    if (!targets.length) { this.status.set("Select the paths to brush."); return false; }
    const next = (layer: Layer): BrushStroke | undefined => {
      if (change === null) return undefined;
      const base = layer.brushStroke ?? this.activeBrushStroke();
      const merged = { ...base, ...change, kind: "calligraphic" as const };
      return {
        kind: "calligraphic",
        angle: Math.min(180, Math.max(-180, merged.angle)),
        roundness: Math.min(100, Math.max(0, merged.roundness)),
        diameter: Math.min(1296, Math.max(0.1, merged.diameter)),
      };
    };
    const ids = new Set(targets.map((l) => l.id));
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => {
        if (!ids.has(l.id)) return l;
        const brushStroke = next(l);
        const { brushStroke: _removed, ...rest } = l;
        return brushStroke ? { ...rest, brushStroke } : rest;
      }),
    }));
    this.changed();
    return true;
  }
  /**
   * Object > Lock and Object > Hide, as Illustrator CS3 has them. Selection acts on the
   * selected objects; All Artwork Above on the objects stacked above the selection that
   * overlap it; Other Layers on everything outside the top-level groups of the selection,
   * each object being a layer of its own here. Locked or hidden objects leave the
   * selection. Guides keep their own lock and are never touched.
   */
  lockOrHide(key: "locked" | "hidden", scope: "selection" | "above" | "others"): number {
    const selected = this.selectedLayers().filter((l) => !l.guide);
    if (!selected.length) { this.status.set(key === "locked" ? "Select the objects to lock." : "Select the objects to hide."); return 0; }
    const layers = this.document().layers;
    const ids = new Set(selected.map((l) => l.id));
    let targets: Layer[];
    if (scope === "selection") targets = selected;
    else if (scope === "above") {
      const bounds = selectionBounds(selected);
      const lowest = Math.min(...selected.map((l) => layers.indexOf(l)));
      targets = layers.filter((l, index) => {
        if (index <= lowest || ids.has(l.id) || l.guide) return false;
        const b = selectionBounds([l]);
        return b.x < bounds.x + bounds.width && b.x + b.width > bounds.x && b.y < bounds.y + bounds.height && b.y + b.height > bounds.y;
      });
    } else {
      const groups = new Set(selected.map((l) => l.groupPath?.[0] ?? "layer:" + l.id));
      targets = layers.filter((l) => !l.guide && !groups.has(l.groupPath?.[0] ?? "layer:" + l.id));
    }
    targets = targets.filter((l) => (key === "locked" ? !l.locked : l.visible));
    if (!targets.length) { this.status.set("There is nothing more to change."); return 0; }
    const changed = new Set(targets.map((l) => l.id));
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => (changed.has(l.id) ? (key === "locked" ? { ...l, locked: true } : { ...l, visible: false }) : l)),
    }));
    // What was locked or hidden cannot stay selected.
    const kept = this.selectedIds().filter((id) => !changed.has(id));
    this.selectedIds.set(kept);
    this.selectedId.set(kept.at(-1) ?? null);
    this.activeNodes.set([]);
    this.status.set(`${key === "locked" ? "Locked" : "Hid"} ${changed.size} object${changed.size > 1 ? "s" : ""}.`);
    this.changed();
    return changed.size;
  }
  /**
   * Object > Unlock All and Object > Show All: every locked, or hidden, object comes back,
   * and those are what is selected afterwards.
   */
  unlockOrShowAll(key: "locked" | "hidden"): number {
    const targets = this.document().layers.filter((l) => !l.guide && (key === "locked" ? l.locked : !l.visible));
    if (!targets.length) { this.status.set(key === "locked" ? "There are no locked objects." : "There are no hidden objects."); return 0; }
    const changed = new Set(targets.map((l) => l.id));
    this.commitStep(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => (changed.has(l.id) ? (key === "locked" ? { ...l, locked: false } : { ...l, visible: true }) : l)),
    }));
    // The objects that come back are selected, unless they are still hidden or locked.
    const selectable = this.document().layers.filter((l) => changed.has(l.id) && l.visible && !l.locked).map((l) => l.id);
    this.selectedIds.set(selectable);
    this.selectedId.set(selectable.at(-1) ?? null);
    this.activeNodes.set([]);
    this.status.set(`${key === "locked" ? "Unlocked" : "Showed"} ${changed.size} object${changed.size > 1 ? "s" : ""}.`);
    this.changed();
    return changed.size;
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
    if (layers.length > MAX_LAYERS) { this.status.set("The document cannot hold more layers."); return false; }
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
  /** The margin guides and registration marks the active page carries now. */
  pageSetup(): { margins: MarginGuides; marks: RegistrationMarks } {
    return readPageSetup(this.document());
  }
  /**
   * Changes one part of the page setup from the document properties, keeping the rest:
   * its size, its margin guides and its registration marks.
   */
  updatePageSetup(change: { width?: number; height?: number; margins?: MarginGuides; marks?: RegistrationMarks }): boolean {
    const current = this.pageSetup();
    const document = this.document();
    return this.applyPageSetup({
      size: { width: Math.round(change.width ?? document.width), height: Math.round(change.height ?? document.height) },
      margins: change.margins ?? current.margins,
      marks: change.marks ?? current.marks,
    });
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
    if (this.removeSelectedParts()) return;
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
    if (document.layers.length + this.clipboard.length > MAX_LAYERS) { this.status.set("The document cannot hold more layers."); return false; }
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
    if (last.duplicate && document.layers.length + layers.length > MAX_LAYERS) { this.status.set("The document cannot hold more layers."); return false; }
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
  /**
   * Turns the stroke of every selected object into the shape it paints, so a line becomes
   * artwork. A shape that also carries a fill keeps it, as the object under its new band.
   */
  outlineStrokeSelection(): boolean {
    const selected = this.selectedLayers().filter((layer) => !layer.guide && !this.isEffectivelyLocked(layer));
    const layers = selected.filter((layer) => !layer.dimension && !["image", "text"].includes(layer.kind));
    if (!selected.length) { this.status.set("Select the objects whose stroke you want to outline."); return false; }
    const document = this.document();
    const produced = new Map<string, Layer[]>();
    const skipped: string[] = [];
    for (const layer of selected) {
      if (!layers.includes(layer)) { skipped.push(layer.kind === "text" ? "text" : layer.kind === "image" ? "images" : "dimensions"); continue; }
      const source = layer.curves ? layer : { ...layer, kind: "path" as const, curves: this.editableCurves(layer) };
      const band = outlineStroke(source);
      if (!band) { skipped.push("objects without a stroke"); continue; }
      const shape = fitCurves({ ...newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }), rotation: 0 }, band);
      const outlined: Layer = {
        ...layer, ...shape, id: shape.id, kind: "path", rotation: 0, flipX: false, flipY: false, skewX: 0,
        name: layer.name + " outline", fill: layer.stroke, stroke: "none", strokeWidth: 0, strokeStyle: undefined,
        lineEnds: undefined, points: [], procedural: undefined,
      };
      const kept: Layer[] = layer.fill === "none" || !source.curves?.some((path) => path.closed)
        ? []
        : [{ ...layer, stroke: "none", strokeWidth: 0 }];
      produced.set(layer.id, [...kept, outlined]);
    }
    if (!produced.size) {
      this.status.set(`Nothing was outlined; the selection holds only ${[...new Set(skipped)].join(", ") || "objects without a stroke"}.`);
      return false;
    }
    const next = { ...document, layers: document.layers.flatMap((layer) => produced.get(layer.id) ?? [layer]) };
    try { parseDocument(JSON.stringify(next)); } catch { this.status.set("The outline cannot be created here."); return false; }
    this.commitStep(document);
    this.document.set(next);
    const created = [...produced.values()].flat().map((layer) => layer.id);
    this.selectedIds.set(created);
    this.selectedId.set(created[0]);
    this.activeNodes.set([]);
    this.status.set(skipped.length
      ? `Outlined the stroke of ${produced.size} of ${selected.length} objects; left alone: ${[...new Set(skipped)].join(", ")}.`
      : `Outlined the stroke of ${produced.size} object${produced.size > 1 ? "s" : ""}.`);
    this.changed();
    return true;
  }
  private readonly fonts = new FontOutlines();
  /**
   * Turns every selected text into the shapes of its letters, keeping the fill, the stroke
   * and the place it had. The text itself is gone afterwards, as it is in any editor that
   * offers this: the shapes are artwork, not type.
   */
  async outlineTextSelection(): Promise<boolean> {
    const texts = this.selectedLayers().filter((layer) => layer.kind === "text" && !this.isEffectivelyLocked(layer) && !layer.guide);
    if (!texts.length) { this.status.set("Select the text you want to turn into shapes."); return false; }
    const produced = new Map<string, Layer[]>();
    let approximate = false;
    for (const layer of texts) {
      const layout = this.textMetrics(layer);
      const typography = layout.typography;
      const { font, exact } = await this.fonts.face(typography.fontFamily, typography.fontWeight, typography.fontStyle);
      approximate = approximate || !exact;
      const outlined = textOutlineGroups(layout, (text, size, x, y) => this.fonts.paths(font, text, size, x, y));
      // The shapes of one text belong together, its words belong together inside that,
      // and a letter keeps every contour it is made of, holes included.
      const parents = (layer.groupPath ?? []).slice(0, 13);
      const textGroup = crypto.randomUUID();
      const shapes: Layer[] = [];
      const place = (curves: CurvePath[], name: string, groupPath: string[]) => {
        const world = curves.map((path) => ({
          closed: path.closed,
          nodes: path.nodes.map((node) => ({
            point: worldPoint(layer, node.point),
            incoming: worldPoint(layer, node.incoming),
            outgoing: worldPoint(layer, node.outgoing),
            smooth: node.smooth,
          })),
        }));
        const shape = fitCurves({ ...newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }), rotation: 0 }, world);
        shapes.push({
          ...layer, ...shape, id: shape.id, kind: "path", rotation: 0, flipX: false, flipY: false, skewX: 0,
          // The shape of a letter is painted as the text was painted, not as a new path.
          fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth, opacity: layer.opacity,
          name: name.slice(0, 40) || "Shape", text: "", typography: undefined, textLayout: undefined, points: [],
          groupPath,
        });
      };
      for (const word of outlined.words) {
        const wordGroup = crypto.randomUUID();
        for (const glyph of word.glyphs) place(glyph.curves, glyph.text, [...parents, textGroup, wordGroup]);
      }
      // The bar of an underline or a strikethrough belongs to the text, not to a word.
      for (const bar of outlined.decoration) place([bar], "Line", [...parents, textGroup]);
      if (shapes.length) produced.set(layer.id, shapes);
    }
    if (!produced.size) { this.status.set("The selected text has no shapes to create."); return false; }
    const document = this.document();
    const next = { ...document, layers: document.layers.flatMap((layer) => produced.get(layer.id) ?? [layer]) };
    if (next.layers.length > MAX_LAYERS) { this.status.set("The document cannot hold more layers."); return false; }
    try { parseDocument(JSON.stringify(next)); } catch { this.status.set("The outlines cannot be created here."); return false; }
    this.commitStep(document);
    this.document.set(next);
    const created = [...produced.values()].flat().map((layer) => layer.id);
    this.selectedIds.set(created);
    this.selectedId.set(created[0]);
    this.activeNodes.set([]);
    const letters = created.length;
    this.status.set(approximate
      ? `Created outlines for ${produced.size} text${produced.size > 1 ? "s" : ""} in ${letters} shapes; a carried face stood in for the chosen family.`
      : `Created outlines for ${produced.size} text${produced.size > 1 ? "s" : ""} in ${letters} shapes.`);
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
    if (document.layers.length + steps.length * layers.length > MAX_LAYERS) { this.status.set("The document cannot hold more layers."); return false; }
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
    if (!layers.length || this.document().layers.length + layers.length > MAX_LAYERS)
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
    if (["rectangle", "ellipse", "path", "paintbrush", "pen", "line", "rounded", "polygon", "star", "arc", "spiral", "grid", "polar", "flare", "text"].includes(tool)) point = this.snap(point);
    if (tool === "hand" || (tool === "brush" && ["none", "transparent"].includes(this.fill()))) return;
    const before = structuredClone(this.document());
    if (tool !== "pen" && !override) this.penId.set(null);
    // Ctrl-click away from every object leaves the path being drawn open, and deselects.
    if (override && this.penId() && !this.pointHitsArtwork(point)) {
      this.finishPath();
      this.selectedId.set(null);
      this.selectedIds.set([]);
      this.activeNodes.set([]);
      return;
    }
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
      this.startPen(point, before, modifiers);
      return;
    }
    if (tool === "convertAnchor") {
      if (!this.startConvert(point, before)) this.status.set("Press on an anchor or a handle to convert it.");
      return;
    }
    if (tool === "reshape") { this.startReshape(point, before, modifiers); return; }
    // Alt turns the Direct Selection tool into the Group Selection tool while it is held.
    if (tool === "groupSelect" || (tool === "direct" && modifiers.alt)) { this.groupSelectClick(point, before, modifiers); return; }
    if (tool === "addAnchor" || tool === "deleteAnchor") {
      // Alt turns each of the two tools into the other one, as it does in Illustrator.
      this.anchorToolClick(point, before, (tool === "addAnchor") !== !!modifiers.alt ? "add" : "delete");
      return;
    }
    if (tool === "scissors" && modifiers.alt) {
      // Alt turns the Scissors into the Add Anchor tool while it is held.
      this.anchorToolClick(point, before, "add");
      return;
    }
    if (tool === "scissors" || tool === "knife") {
      this.cutClick(point, before, tool);
      return;
    }
    if (tool === "smooth") {
      this.startSmoothDrag(point, before);
      return;
    }
    if (
      [
        "direct",
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
    if (tool === "path" || tool === "paintbrush") {
      this.startFreehand(point, before, modifiers, tool);
      return;
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
    if (this.document().layers.length >= MAX_LAYERS) {
      this.status.set("The document cannot hold more layers.");
      return;
    }
    if (tool === "eraser") {
      // An image or paint layer is erased as pixels; everything else as vector artwork.
      const selected = this.selectedLayers();
      if (!(selected.length === 1 && selected[0].kind === "image")) {
        this.startVectorEraser(point, before, modifiers);
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
  move(point: Point, modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean; space?: boolean } = {}) {
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
    if (!g) { this.hoverPath(point, modifiers); return; }
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
    } else if (g.mode === "pen") this.dragPenAnchor(point, modifiers);
    else if (g.mode === "penHandle") this.dragPenHandle(point, modifiers);
    else if (g.mode === "penClose") this.dragPenClose(point, modifiers);
    else if (g.mode.startsWith("convert:")) this.dragConvert(point, modifiers);
    else if (g.mode === "anchors") this.dragAnchorsAcross(point, modifiers);
    else if (g.mode === "reshape") this.dragReshape(modifiers.shift ? snapDirection(g.start, point, this.snapAngle()) : point);
    else if (g.mode.startsWith("segment:")) this.dragSegmentGesture(modifiers.shift ? snapDirection(g.start, point, this.snapAngle()) : point);
    else if (g.mode.startsWith("node:")) this.dragNode(point, modifiers);
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
    } else if (g.mode === "vectorEraser") this.dragVectorEraser(point, modifiers);
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
          { proportional: !!modifiers.shift },
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
    } else if (g.mode === "freehand" || g.mode === "freehandEdit") this.dragFreehand(point, modifiers);
    else if (g.mode === "smoothDrag") this.dragSmooth(point);
    else if (g.mode === "brush" || g.mode === "eraser") this.paint(point);
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
    const mode = this.gesture?.mode ?? "";
    return ["pen", "penHandle", "penClose"].includes(mode) || mode.startsWith("node:") || mode.startsWith("convert:") || mode.startsWith("segment:");
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
    if ((g.mode === "freehand" || g.mode === "freehandEdit") && !this.finishFreehand(g)) {
      this.gesture = undefined;
      this.revision.update((x) => x + 1);
      return;
    }
    const clicked = Math.hypot(g.last.x - g.start.x, g.last.y - g.start.y) <= 0.5 / this.zoom();
    if (clicked && g.mode === "penHandle") {
      // A click on the last anchor takes its outgoing handle in, so the next segment starts straight.
      const curves = structuredClone(g.original.curves!), node = curves[0].nodes.at(-1)!;
      node.outgoing = { ...node.point };
      node.smooth = false;
      this.setLayer(g.id, { curves });
    }
    if (clicked && g.mode.startsWith("convert:") && g.mode.endsWith(":point")) {
      // A click with Convert Anchor makes a corner without handles.
      const [, pi, ni] = g.mode.split(":");
      const curves = structuredClone(g.original.curves!);
      curves[+pi].nodes[+ni] = anchor(curves[+pi].nodes[+ni].point);
      this.setLayer(g.id, { curves });
    }
    const layer = this.document().layers.find((l) => l.id === g.id);
    if (layer?.curves && (["pen", "penHandle", "penClose", "reshape"].includes(g.mode) || g.mode.startsWith("node:") || g.mode.startsWith("convert:") || g.mode.startsWith("segment:")))
      this.setLayer(g.id, fitCurves(layer, layer.curves));
    if (g.mode === "penClose") { this.penId.set(null); this.activeNodes.set([]); }
    if (g.mode === "pathEraser") this.finishPathEraser(g);
    if (g.mode === "vectorEraser") this.finishVectorEraser();
    if (g.mode === "anchors") {
      for (const id of this.anchorOriginals?.keys() ?? []) {
        const moved = this.document().layers.find((l) => l.id === id);
        if (moved?.curves) this.setLayer(id, fitCurves(moved, moved.curves));
      }
      this.anchorOriginals = undefined;
    }
    this.penDrag = undefined;
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
    if (tool === "select" || tool === "direct") this.lastSelectionTool.set(tool);
    this.pathCursor.set(null);
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
  /** The path the Pen is drawing, while it is still one this editor may change. */
  private drawingLayer(): Layer | undefined {
    const layer = this.document().layers.find((l) => l.id === this.penId());
    if (!layer || this.isEffectivelyLocked(layer) || !layer.visible || layer.guide || !layer.curves?.length) return undefined;
    return layer;
  }
  /** The open path, other than the one being drawn, with an endpoint under the pointer. */
  private penJoinTarget(point: Point, drawingId: string): { layer: Layer; atStart: boolean } | null {
    const radius = 9 / this.zoom();
    for (const layer of [...this.document().layers].reverse()) {
      if (layer.id === drawingId || layer.guide || layer.dimension || layer.procedural || !layer.visible || this.isEffectivelyLocked(layer)) continue;
      const path = layer.curves?.[0];
      if (!path || path.closed || path.nodes.length < 1 || layer.curves!.length !== 1) continue;
      for (const end of [{ node: path.nodes[0], atStart: true }, { node: path.nodes.at(-1)!, atStart: false }]) {
        const world = worldPoint(layer, end.node.point);
        if (Math.hypot(point.x - world.x, point.y - world.y) <= radius) return { layer, atStart: end.atStart };
      }
    }
    return null;
  }
  /**
   * What the Pen does over a selected path when it is not drawing: over an anchor it
   * deletes it, over a segment it adds one, which Illustrator calls automatic
   * add and delete. Shift, or turning the preference off, keeps the Pen a Pen.
   */
  private penAutoTarget(point: Point):
    | { kind: "delete"; layer: Layer; path: number; index: number }
    | { kind: "add"; layer: Layer; path: number; segment: number; t: number }
    | null {
    for (const layer of [...this.selectedLayers()].reverse()) {
      if (!layer.curves?.length || layer.kind !== "path" || layer.dimension || layer.procedural || layer.guide || !layer.visible || this.isEffectivelyLocked(layer)) continue;
      const radius = 9 / this.zoom();
      for (let pi = 0; pi < layer.curves.length; pi++) {
        const path = layer.curves[pi];
        const index = path.nodes.findIndex((node) => {
          const world = worldPoint(layer, node.point);
          return Math.hypot(world.x - point.x, world.y - point.y) <= radius;
        });
        // The end of an open path is where the Pen carries on, not an anchor to delete.
        const isEnd = !path.closed && (index === 0 || index === path.nodes.length - 1);
        if (index >= 0 && !(isEnd && layer.curves.length === 1)) return { kind: "delete", layer, path: pi, index };
        if (index >= 0) return null;
      }
      const local = localPoint(layer, point);
      for (let pi = 0; pi < layer.curves.length; pi++) {
        const near = nearestOnPath(layer.curves[pi], local);
        if (near && near.distance <= 5 / this.zoom() && near.t > 0.001 && near.t < 0.999)
          return { kind: "add", layer, path: pi, segment: near.segment, t: near.t };
      }
    }
    return null;
  }
  /** Adds an anchor on a segment without changing the shape, and selects it. */
  private addAnchorAt(layer: Layer, path: number, segment: number, t: number, before: StudioDocument) {
    const curves = structuredClone(layer.curves!);
    curves[path] = splitSegment(curves[path], segment, t);
    this.commitStep(before);
    this.setLayer(layer.id, { kind: "path", curves });
    this.selectedId.set(layer.id);
    this.selectedIds.set([layer.id]);
    this.activeNodes.set([`${path}:${segment + 1}`]);
    this.changed();
  }
  /** Removes an anchor while the segments around it keep the shape they had. */
  private deleteAnchorAt(layer: Layer, path: number, index: number, before: StudioDocument) {
    let curves = structuredClone(layer.curves!);
    curves[path] = deleteAnchorKeepingShape(curves[path], index);
    curves = curves.filter((c) => c.nodes.length > 1);
    this.commitStep(before);
    if (!curves.length) {
      this.document.update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== layer.id) }));
      this.selectedId.set(null);
      this.selectedIds.set([]);
    } else this.setLayer(layer.id, fitCurves({ ...layer, kind: "path" }, curves));
    this.activeNodes.set([]);
    this.changed();
  }
  private penDrag?: { shift: Point; handle: Point | null; lastPointer: Point; split: boolean; incoming: Point | null };
  /**
   * The Pen, as Illustrator draws with it. A click sets a corner anchor and a drag a smooth
   * one whose handles move together; Shift keeps the new anchor, or the handle, on the
   * angle increment. Clicking the first anchor closes the path, clicking the last one
   * takes its outgoing handle in or, dragged, pulls a new one out, and clicking the end
   * of another open path joins it. Over a selected path the Pen adds or deletes anchors,
   * and with Alt it converts them.
   */
  private startPen(point: Point, before: StudioDocument, modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) {
    let layer = this.drawingLayer();
    if (!layer) {
      this.penId.set(null);
      // Alt makes the Pen the Convert Anchor tool, before any automatic add or delete.
      if (modifiers.alt && this.startConvert(point, before)) return;
      if (!modifiers.shift && this.autoAddDelete()) {
        const target = this.penAutoTarget(point);
        if (target?.kind === "delete") { this.deleteAnchorAt(target.layer, target.path, target.index, before); return; }
        if (target?.kind === "add") { this.addAnchorAt(target.layer, target.path, target.segment, target.t, before); return; }
      }
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
        const continued = this.document().layers.find((l) => l.id === continuation.layer.id)!;
        this.selectedId.set(continued.id);
        this.selectedIds.set([continued.id]);
        this.beginPenHandle(continued, before, point);
        return;
      }
      if (this.document().layers.length >= MAX_LAYERS) { this.status.set("The document cannot hold more layers."); return; }
      const fresh = newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }, this.fill(), this.stroke(), this.size());
      fresh.strokeStyle = { ...this.strokeStyle() };
      fresh.lineEnds = structuredClone(this.lineEnds());
      fresh.name = "Bézier path";
      fresh.curves = [{ nodes: [], closed: false }];
      this.document.update((d) => ({ ...d, layers: [...d.layers, fresh] }));
      this.penId.set(fresh.id);
      layer = fresh;
    }
    const drawn = layer;
    const curves = structuredClone(drawn.curves!), path = curves[0];
    this.selectedId.set(drawn.id);
    this.selectedIds.set([drawn.id]);
    const radius = 9 / this.zoom();
    const under = (node: Anchor) => {
      const world = worldPoint(drawn, node.point);
      return Math.hypot(world.x - point.x, world.y - point.y) <= radius;
    };
    if (path.nodes.length >= 2 && under(path.nodes[0])) {
      path.closed = true;
      this.setLayer(drawn.id, { curves });
      this.gesture = { before, start: point, last: point, id: drawn.id, points: [], original: { ...structuredClone(drawn), curves }, mode: "penClose" };
      return;
    }
    if (path.nodes.length && under(path.nodes.at(-1)!)) { this.beginPenHandle(drawn, before, point); return; }
    const join = this.penJoinTarget(point, drawn.id);
    if (join) { this.joinWhileDrawing(drawn, join, before); return; }
    if (modifiers.alt && this.startConvert(point, before)) return;
    if (path.nodes.length >= 2000) return;
    const at = modifiers.shift && path.nodes.length
      ? snapDirection(worldPoint(drawn, path.nodes.at(-1)!.point), point, this.snapAngle())
      : point;
    path.nodes.push(anchor(localPoint(drawn, at)));
    this.setLayer(drawn.id, { curves });
    this.activeNodes.set([]);
    this.penDrag = { shift: { x: 0, y: 0 }, handle: null, lastPointer: at, split: false, incoming: null };
    this.gesture = { before, start: at, last: at, id: drawn.id, points: [], original: { ...structuredClone(drawn), curves }, mode: "pen" };
  }
  /** A press on the last anchor: a click takes its outgoing handle in, a drag pulls a new one. */
  private beginPenHandle(layer: Layer, before: StudioDocument, point: Point) {
    const curves = structuredClone(layer.curves!);
    this.activeNodes.set([]);
    this.gesture = { before, start: point, last: point, id: layer.id, points: [], original: { ...structuredClone(layer), curves }, mode: "penHandle" };
  }
  /** Joins the path being drawn to the end of another open path and stops drawing. */
  private joinWhileDrawing(layer: Layer, target: { layer: Layer; atStart: boolean }, before: StudioDocument) {
    const other = target.layer;
    const otherPath: CurvePath = mapCurves([other.curves![0]], (p) => localPoint(layer, worldPoint(other, p)))[0];
    const joined = joinPaths(layer.curves![0], false, otherPath, target.atStart, "corner", true);
    const next = fitCurves(layer, [joined]);
    this.commitStep(before);
    this.document.update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== other.id).map((l) => (l.id === layer.id ? next : l)) }));
    this.penId.set(null);
    this.selectedId.set(layer.id);
    this.selectedIds.set([layer.id]);
    this.activeNodes.set([]);
    this.status.set("Joined the two paths.");
    this.changed();
  }
  /** Moves the anchor being placed, or its handles, while the button is down. */
  private dragPenAnchor(point: Point, modifiers: { shift?: boolean; alt?: boolean; space?: boolean }) {
    const g = this.gesture!, drag = this.penDrag!;
    if (modifiers.space) {
      // Space held moves the anchor itself; its handles travel with it.
      drag.shift = { x: drag.shift.x + point.x - drag.lastPointer.x, y: drag.shift.y + point.y - drag.lastPointer.y };
    }
    drag.lastPointer = point;
    const curves = structuredClone(g.original.curves!), node = curves[0].nodes.at(-1)!;
    const base = worldPoint(g.original, node.point);
    const at = { x: base.x + drag.shift.x, y: base.y + drag.shift.y };
    if (modifiers.alt && !drag.split) {
      // Alt splits the handles: the incoming one stays where it was, the outgoing one goes on.
      drag.split = true;
      drag.incoming = drag.handle ? { x: -drag.handle.x, y: -drag.handle.y } : { x: 0, y: 0 };
    }
    if (!modifiers.space) {
      const target = modifiers.shift ? snapDirection(at, point, this.snapAngle()) : point;
      const offset = { x: target.x - at.x, y: target.y - at.y };
      drag.handle = Math.hypot(offset.x, offset.y) > 0.5 / this.zoom() ? offset : null;
    }
    node.point = localPoint(g.original, at);
    if (drag.handle) {
      node.outgoing = localPoint(g.original, { x: at.x + drag.handle.x, y: at.y + drag.handle.y });
      const incoming = drag.split ? drag.incoming! : { x: -drag.handle.x, y: -drag.handle.y };
      node.incoming = localPoint(g.original, { x: at.x + incoming.x, y: at.y + incoming.y });
      node.smooth = !drag.split;
    } else {
      node.outgoing = { ...node.point };
      node.incoming = drag.split && drag.incoming ? localPoint(g.original, { x: at.x + drag.incoming.x, y: at.y + drag.incoming.y }) : { ...node.point };
      node.smooth = false;
    }
    this.setLayer(g.id, { curves });
  }
  /** Pulls a new outgoing handle out of the last anchor; the incoming one stays. */
  private dragPenHandle(point: Point, modifiers: { shift?: boolean }) {
    const g = this.gesture!;
    const curves = structuredClone(g.original.curves!), node = curves[0].nodes.at(-1)!;
    const at = worldPoint(g.original, node.point);
    const target = modifiers.shift ? snapDirection(at, point, this.snapAngle()) : point;
    node.outgoing = localPoint(g.original, target);
    node.smooth = false;
    this.setLayer(g.id, { curves });
  }
  /**
   * Dragging on the first anchor while closing shapes the closing curve: both handles of
   * the first anchor turn with the pointer, or, with Alt, only the one the closing
   * segment arrives on.
   */
  private dragPenClose(point: Point, modifiers: { shift?: boolean; alt?: boolean }) {
    const g = this.gesture!;
    const curves = structuredClone(g.original.curves!), node = curves[0].nodes[0];
    const at = worldPoint(g.original, node.point);
    const target = modifiers.shift ? snapDirection(at, point, this.snapAngle()) : point;
    if (Math.hypot(target.x - at.x, target.y - at.y) <= 0.5 / this.zoom()) return;
    node.incoming = localPoint(g.original, { x: 2 * at.x - target.x, y: 2 * at.y - target.y });
    if (!modifiers.alt) node.outgoing = localPoint(g.original, target);
    node.smooth = !modifiers.alt;
    this.setLayer(g.id, { curves });
  }
  /**
   * The Convert Anchor tool, which the Pen also becomes while Alt is held. Pressed on an
   * anchor, a drag pulls out two handles that move together and a click takes both in;
   * pressed on a handle, the handle moves on its own and the anchor becomes a corner.
   */
  private startConvert(point: Point, before: StudioDocument): boolean {
    const candidates = [this.drawingLayer(), ...this.selectedLayers(), pick(this.document().layers, point)];
    for (const candidate of candidates) {
      if (!candidate || this.isEffectivelyLocked(candidate) || !candidate.visible || candidate.guide || candidate.dimension || candidate.procedural) continue;
      if (!["path", "rectangle", "ellipse"].includes(candidate.kind)) continue;
      const layer: Layer = candidate.curves ? candidate : { ...candidate, kind: "path", curves: this.editableCurves(candidate) };
      const hit = this.findCurveNode(layer, point);
      if (!hit) continue;
      this.setLayer(layer.id, { kind: "path", curves: structuredClone(layer.curves!) });
      this.selectedId.set(layer.id);
      this.selectedIds.set([layer.id]);
      this.activeNodes.set([`${hit.path}:${hit.index}`]);
      this.gesture = { before, start: point, last: point, id: layer.id, points: [], original: structuredClone(layer), mode: `convert:${hit.path}:${hit.index}:${hit.part}` };
      return true;
    }
    return false;
  }
  private dragConvert(point: Point, modifiers: { shift?: boolean }) {
    const g = this.gesture!;
    const [, pi, ni, part] = g.mode.split(":");
    const curves = structuredClone(g.original.curves!), node = curves[+pi].nodes[+ni];
    const at = worldPoint(g.original, node.point);
    const target = modifiers.shift ? snapDirection(at, point, this.snapAngle()) : point;
    if (part === "point") {
      if (Math.hypot(target.x - at.x, target.y - at.y) <= 0.5 / this.zoom()) return;
      node.outgoing = localPoint(g.original, target);
      node.incoming = localPoint(g.original, { x: 2 * at.x - target.x, y: 2 * at.y - target.y });
      node.smooth = true;
    } else {
      node[part as "incoming" | "outgoing"] = localPoint(g.original, target);
      node.smooth = false;
    }
    this.setLayer(g.id, { curves });
  }
  /** Whether a press here lands on an object or on an anchor or handle of a selected path. */
  private pointHitsArtwork(point: Point): boolean {
    if (pick(this.document().layers.filter((layer) => !layer.dimension || this.dimensionsVisible()), point)) return true;
    return this.selectedLayers().some((layer) => !!layer.curves && !!this.findCurveNode(layer, point));
  }
  /** The Add and Delete Anchor tools: a click on a segment adds, a click on an anchor deletes. */
  private anchorToolClick(point: Point, before: StudioDocument, kind: "add" | "delete") {
    const candidates = [...this.selectedLayers(), pick(this.document().layers, point)];
    for (const candidate of candidates) {
      if (!candidate || this.isEffectivelyLocked(candidate) || !candidate.visible || candidate.guide || candidate.dimension || candidate.procedural) continue;
      if (!["path", "rectangle", "ellipse"].includes(candidate.kind)) continue;
      const layer: Layer = candidate.curves ? candidate : { ...candidate, kind: "path", curves: this.editableCurves(candidate) };
      if (kind === "delete") {
        const hit = this.findCurveNode(layer, point);
        if (hit?.part === "point") { this.setLayer(layer.id, { kind: "path", curves: layer.curves }); this.deleteAnchorAt(layer, hit.path, hit.index, before); return; }
        continue;
      }
      const local = localPoint(layer, point);
      for (let pi = 0; pi < layer.curves!.length; pi++) {
        const near = nearestOnPath(layer.curves![pi], local);
        if (near && near.distance <= 6 / this.zoom() && near.t > 0.001 && near.t < 0.999) {
          this.setLayer(layer.id, { kind: "path", curves: layer.curves });
          this.addAnchorAt(layer, pi, near.segment, near.t, before);
          return;
        }
      }
    }
    this.status.set(kind === "add" ? "Click on a segment to add an anchor." : "Click on an anchor to delete it.");
  }
  /**
   * Works out the mark beside the cursor and the anchor under it while no button is down,
   * so each path tool announces what a press would do before it happens.
   */
  hoverPath(point: Point, modifiers: { shift?: boolean; alt?: boolean } = {}) {
    const tool = this.tool();
    let state: PathCursor = null;
    let hover: { id: string; key: string } | null = null;
    const anchorUnder = (layer: Layer | undefined) => {
      if (!layer?.curves) return null;
      const hit = this.findCurveNode(layer, point);
      return hit?.part === "point" ? { id: layer.id, key: `${hit.path}:${hit.index}` } : null;
    };
    for (const layer of this.selectedLayers()) { hover = anchorUnder(layer); if (hover) break; }
    if (tool === "pen") {
      const drawing = this.drawingLayer();
      if (drawing) {
        const nodes = drawing.curves![0].nodes;
        const radius = 9 / this.zoom();
        const under = (node: Anchor | undefined) => !!node && Math.hypot(worldPoint(drawing, node.point).x - point.x, worldPoint(drawing, node.point).y - point.y) <= radius;
        if (nodes.length >= 2 && under(nodes[0])) state = "close";
        else if (under(nodes.at(-1))) state = "convert";
        else if (this.penJoinTarget(point, drawing.id)) state = "join";
        else if (modifiers.alt && hover) state = "convert";
      } else {
        const auto = !modifiers.shift && this.autoAddDelete() ? this.penAutoTarget(point) : null;
        if (auto) state = auto.kind;
        else if (modifiers.alt && hover) state = "convert";
        else if (this.penContinuation(point)) state = "continue";
        else state = "newPath";
      }
    } else if (tool === "addAnchor") state = modifiers.alt ? "delete" : "add";
    else if (tool === "deleteAnchor") state = modifiers.alt ? "add" : "delete";
    else if (tool === "convertAnchor") state = "convert";
    else if (tool === "path" || tool === "paintbrush") state = this.freehandHoverState(point, tool, modifiers);
    this.pathCursor.set(state);
    const current = this.hoverAnchor();
    if (current?.id !== hover?.id || current?.key !== hover?.key) {
      this.hoverAnchor.set(hover);
      this.revision.update((x) => x + 1);
    }
  }
  /**
   * The mark beside the Pencil or the Paintbrush: the small cross of a new path, which
   * disappears when a press would redraw or extend a selected path instead.
   */
  private freehandHoverState(point: Point, tool: "path" | "paintbrush", modifiers: { alt?: boolean }): PathCursor {
    if (tool === "path" && modifiers.alt) return null;
    return this.freehandEditTarget(point, tool) ? null : "freehand";
  }
  /** The options of the Pencil, the Paintbrush and the Smooth tool, as their dialogs set them. */
  readonly pencilOptions = signal<FreehandToolOptions>({ ...PENCIL_DEFAULTS });
  readonly paintbrushOptions = signal<FreehandToolOptions>({ ...PAINTBRUSH_DEFAULTS });
  readonly smoothOptions = signal<FreehandOptions>({ ...SMOOTH_DEFAULTS });
  private freehand?: {
    tool: "path" | "paintbrush";
    points: Point[];
    target: FreehandTarget | null;
    close: boolean;
    connect: boolean;
  };
  private freehandOptionsFor(tool: "path" | "paintbrush") {
    return tool === "path" ? this.pencilOptions() : this.paintbrushOptions();
  }
  /**
   * The selected path a freehand stroke starting here would edit: an endpoint of an open
   * path is extended, and any other point near a path is where a redraw starts. The
   * Paintbrush edits only brushed paths, as its strokes are the ones it owns.
   */
  private freehandEditTarget(point: Point, tool: "path" | "paintbrush"): FreehandTarget | null {
    const options = this.freehandOptionsFor(tool);
    if (!options.editSelected) return null;
    const radius = options.within / this.zoom();
    for (const layer of [...this.selectedLayers()].reverse()) {
      if (layer.kind !== "path" || layer.dimension || layer.procedural || layer.guide || !layer.visible || this.isEffectivelyLocked(layer)) continue;
      if (tool === "paintbrush" && !layer.brushStroke) continue;
      const curves = this.editableCurves(layer);
      const local = localPoint(layer, point);
      for (let pi = 0; pi < curves.length; pi++) {
        const path = curves[pi];
        if (!path.closed && path.nodes.length > 1) {
          for (const [index, atStart] of [[0, true], [path.nodes.length - 1, false]] as const) {
            const node = path.nodes[index];
            if (Math.hypot(node.point.x - local.x, node.point.y - local.y) <= radius) return { layer, path: pi, kind: "extend", atStart };
          }
        }
        const near = nearestOnPath(path, local);
        if (near && near.distance <= radius) return { layer, path: pi, kind: "redraw", from: { segment: near.segment, t: near.t } };
      }
    }
    return null;
  }
  /**
   * Starts a Pencil or Paintbrush stroke. The stroke follows the pointer and is fitted with
   * the fidelity and smoothness when the button is released. Alt pressed after the drag has
   * begun closes the path; on the Pencil, Alt held before pressing is the Smooth tool.
   */
  private startFreehand(point: Point, before: StudioDocument, modifiers: { alt?: boolean }, tool: "path" | "paintbrush") {
    if (tool === "path" && modifiers.alt) { this.startSmoothDrag(point, before); return; }
    const target = this.freehandEditTarget(point, tool);
    this.freehand = { tool, points: [point], target, close: false, connect: false };
    if (target) {
      const layer = { ...target.layer, kind: "path" as const, curves: this.editableCurves(target.layer) };
      this.gesture = { before, start: point, last: point, id: layer.id, points: [point], original: structuredClone(layer), mode: "freehandEdit" };
      return;
    }
    if (this.document().layers.length >= MAX_LAYERS) { this.freehand = undefined; this.status.set("The document cannot hold more layers."); return; }
    const options = this.freehandOptionsFor(tool);
    const layer = newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }, options.fill ? this.fill() : "none", this.stroke(), this.size());
    layer.strokeStyle = { ...this.strokeStyle() };
    layer.lineEnds = structuredClone(this.lineEnds());
    layer.name = tool === "path" ? "Pencil path" : "Brush stroke";
    if (tool === "paintbrush") layer.brushStroke = structuredClone(this.activeBrushStroke());
    layer.x = point.x; layer.y = point.y; layer.width = 1; layer.height = 1;
    layer.curves = [polyline([{ x: 0, y: 0 }])];
    this.document.update((d) => ({ ...d, layers: [...d.layers, layer] }));
    this.selectedId.set(layer.id);
    this.selectedIds.set([layer.id]);
    this.gesture = { before, start: point, last: point, id: layer.id, points: [point], original: structuredClone(layer), mode: "freehand" };
  }
  /** Follows the pointer with the raw stroke; the curves are fitted on release. */
  private dragFreehand(point: Point, modifiers: { alt?: boolean; ctrl?: boolean }) {
    const g = this.gesture!, stroke = this.freehand!;
    stroke.close = !!modifiers.alt;
    stroke.connect = !!modifiers.ctrl;
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5 / this.zoom() || stroke.points.length >= 20000) return;
    stroke.points.push(point);
    if (g.mode === "freehand") {
      this.setLayer(g.id, fitCurves({ ...g.original, x: 0, y: 0, width: 1, height: 1, rotation: 0 }, [polyline(stroke.points)]));
      return;
    }
    const preview = this.freehandResult(polyline(stroke.points.map((p) => localPoint(g.original, p))), false);
    if (preview) this.setLayer(g.id, fitCurves(g.original, preview));
  }
  /**
   * What a freehand edit makes of the target path with a given stroke, in the target's
   * coordinates: an extension from an endpoint, or a redraw from where the stroke started
   * to where it ended on the path, if it did.
   */
  private freehandResult(stroke: CurvePath, final: boolean, state = this.freehand!): CurvePath[] | null {
    const g = this.gesture!, target = state.target!;
    const curves = structuredClone(g.original.curves!);
    const path = curves[target.path];
    if (stroke.nodes.length < 2) return null;
    const radius = this.freehandOptionsFor(state.tool).within / this.zoom();
    if (target.kind === "extend") {
      const extended = joinPaths(path, target.atStart, stroke, true, "corner");
      curves[target.path] = final && state.close ? closeByJoin(extended) : extended;
      return curves;
    }
    const end = stroke.nodes[stroke.nodes.length - 1].point;
    const near = nearestOnPath(path, end);
    const to = near && near.distance <= radius ? { segment: near.segment, t: near.t } : null;
    curves[target.path] = redrawPath(path, target.from, to, stroke);
    return curves;
  }
  /** Fits the stroke and commits it: a new path, or the edit of the selected one. */
  private finishFreehand(g: NonNullable<EditorService["gesture"]>) {
    const state = this.freehand!;
    this.freehand = undefined;
    const options = this.freehandOptionsFor(state.tool);
    const pixel = 1 / this.zoom();
    if (g.mode === "freehand") {
      if (state.points.length < 2) {
        this.document.set(g.before);
        return false;
      }
      let path = fitFreehand(state.points, options, pixel);
      if (state.close) path = closeFreehand(path, Math.max(options.fidelity, 3) * pixel * 2);
      const layer: Layer = fitCurves({ ...g.original, x: 0, y: 0, width: 1, height: 1, rotation: 0 }, [path]);
      this.setLayer(g.id, layer);
      if (!options.keepSelected) { this.selectedId.set(null); this.selectedIds.set([]); }
      return true;
    }
    const target = state.target!;
    const stroke = fitFreehand(state.points.map((p) => localPoint(g.original, p)), options, pixel);
    const curves = this.freehandResult(stroke, true, state);
    if (!curves) { this.setLayer(g.id, g.original); return false; }
    let layer = fitCurves(g.original, curves);
    let removed: string | null = null;
    if (target.kind === "extend" && state.connect) {
      // Ctrl joins the stroke to the end of another selected open path it finishes on.
      const end = state.points[state.points.length - 1];
      const other = this.selectedLayers().find((l) => l.id !== g.id && l.curves?.length === 1 && !l.curves[0].closed && !this.isEffectivelyLocked(l));
      if (other) {
        const path = other.curves![0];
        const ends = [{ node: path.nodes[0], atStart: true }, { node: path.nodes.at(-1)!, atStart: false }];
        const hit = ends.find((e) => { const w = worldPoint(other, e.node.point); return Math.hypot(w.x - end.x, w.y - end.y) <= options.within / this.zoom(); });
        if (hit) {
          const otherLocal = mapCurves([path], (p) => localPoint(layer, worldPoint(other, p)))[0];
          const own = layer.curves![target.path];
          const joined = joinPaths(own, false, otherLocal, hit.atStart, "corner");
          const next = structuredClone(layer.curves!);
          next[target.path] = joined;
          layer = fitCurves(layer, next);
          removed = other.id;
        }
      }
    }
    this.document.update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== removed).map((l) => (l.id === g.id ? layer : l)) }));
    this.selectedIds.set([g.id]);
    this.selectedId.set(g.id);
    return true;
  }
  /**
   * The Smooth tool: dragging along a selected path smooths the stretch the drag passes
   * over, with the fidelity and smoothness of its options, and leaves the rest alone.
   */
  private startSmoothDrag(point: Point, before: StudioDocument) {
    const layer = this.selectedLayers().find((l) => l.kind === "path" && !l.dimension && !l.procedural && !l.guide && l.visible && !this.isEffectivelyLocked(l))
      ?? pick(this.document().layers, point);
    if (!layer || layer.kind !== "path" || this.isEffectivelyLocked(layer) || layer.dimension || layer.procedural) { this.status.set("Select a path to smooth."); return; }
    const withCurves = { ...layer, curves: this.editableCurves(layer) };
    this.selectedId.set(layer.id);
    this.selectedIds.set([layer.id]);
    this.gesture = { before, start: point, last: point, id: layer.id, points: [point], original: structuredClone(withCurves), mode: "smoothDrag" };
  }
  private dragSmooth(point: Point) {
    const g = this.gesture!;
    const last = g.points[g.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.5 / this.zoom()) return;
    g.points.push(point);
    this.setLayer(g.id, fitCurves(g.original, this.smoothedCurves(g.original, g.points)));
  }
  /** The curves of a layer with every stretch the drag passed over smoothed again. */
  private smoothedCurves(layer: Layer, drag: Point[]): CurvePath[] {
    const local = drag.map((p) => localPoint(layer, p));
    const radius = 10 / this.zoom();
    const options = this.smoothOptions();
    return layer.curves!.map((path) => {
      const ranges = rangesNear(path, local, radius);
      if (!ranges.length) return path;
      // Each stretch is sampled, evened out and fitted again between its two ends.
      const count = path.closed ? path.nodes.length : path.nodes.length - 1;
      const merged = ranges.sort((a, b) => a[0] - b[0]);
      const span: [number, number] = [merged[0][0], merged[merged.length - 1][1]];
      if (span[1] - span[0] < 0.02) return path;
      const samples = flatten(stretch(path, span[0], span[1], count), 12);
      const smoothness = Math.min(100, options.smoothness + 35);
      const fitted = fitFreehand(samples, { fidelity: options.fidelity, smoothness }, 1 / this.zoom());
      const pieces = path.closed
        ? [stretch(path, span[1], span[0] + count, count), fitted]
        : [stretch(path, 0, span[0], count), fitted, stretch(path, span[1], count, count)];
      return concatPieces(pieces, path.closed);
    });
  }
  /** The brush the Paintbrush applies to new strokes. */
  readonly activeBrushStroke = signal<BrushStroke>({ ...DEFAULT_BRUSH_STROKE });
  /** Anchors chosen on selected objects other than the primary one, as "path:index" keys by layer. */
  readonly otherAnchors = signal<Record<string, string[]>>({});
  /** Segments chosen on the primary object, as "path:segment" keys. */
  readonly activeSegments = signal<string[]>([]);
  /** Anchor and handle display, as Illustrator's Selection and Anchor Display preferences set it. */
  readonly showHandlesMultiple = signal(true);
  readonly anchorDisplay = signal<"small" | "mixed" | "large">("mixed");
  readonly handleStyle = signal<"small" | "large" | "cross">("small");
  readonly highlightAnchors = signal(true);
  /** The anchors chosen on a layer, whether it is the primary object or another selected one. */
  anchorKeysOf(id: string): string[] {
    if (id === this.selectedId()) return this.selectedAnchorKeys();
    return this.selectedIds().includes(id) ? this.otherAnchors()[id] ?? [] : [];
  }
  /**
   * The handles shown, which are also the only ones a press can take: those of the chosen
   * anchors and of the segments that meet them, and those of chosen segments. With several
   * anchors chosen on one path the preference decides; without it only chosen segments
   * show theirs, as in Illustrator.
   */
  visibleHandles(layer: Layer): Set<string> {
    const visible = new Set<string>();
    if (!this.showHandles() || !layer.curves) return visible;
    const anchors = this.anchorKeysOf(layer.id);
    const perPath = new Map<number, number>();
    for (const key of anchors) { const pi = +key.split(":")[0]; perPath.set(pi, (perPath.get(pi) ?? 0) + 1); }
    for (const key of anchors) {
      const [pi, ni] = key.split(":").map(Number);
      const path = layer.curves[pi];
      if (!path?.nodes[ni] || (!this.showHandlesMultiple() && (perPath.get(pi) ?? 0) > 1)) continue;
      const n = path.nodes.length;
      visible.add(`${pi}:${ni}:incoming`).add(`${pi}:${ni}:outgoing`);
      if (path.closed || ni > 0) visible.add(`${pi}:${(ni - 1 + n) % n}:outgoing`);
      if (path.closed || ni < n - 1) visible.add(`${pi}:${(ni + 1) % n}:incoming`);
    }
    if (layer.id === this.selectedId()) {
      for (const key of this.activeSegments()) {
        const [pi, si] = key.split(":").map(Number);
        const path = layer.curves[pi];
        if (!path || si >= path.nodes.length) continue;
        visible.add(`${pi}:${si}:outgoing`).add(`${pi}:${(si + 1) % path.nodes.length}:incoming`);
      }
    }
    // A handle that lies on its anchor is not drawn and cannot be taken.
    for (const key of [...visible]) {
      const [pi, ni, part] = key.split(":");
      const node = layer.curves[+pi]?.nodes[+ni];
      const handle = node?.[part as "incoming" | "outgoing"];
      if (!node || !handle || Math.hypot(handle.x - node.point.x, handle.y - node.point.y) < 1e-6) visible.delete(key);
    }
    return visible;
  }
  /** The segment of a path within a couple of screen pixels of the pointer. */
  private segmentAt(layer: Layer, point: Point): { path: number; segment: number; t: number } | null {
    if (!layer.curves) return null;
    const local = localPoint(layer, point);
    let best: { path: number; segment: number; t: number; distance: number } | null = null;
    layer.curves.forEach((path, pi) => {
      const near = nearestOnPath(path, local);
      if (near && (!best || near.distance < best.distance)) best = { path: pi, segment: near.segment, t: near.t, distance: near.distance };
    });
    const found = best as { path: number; segment: number; t: number; distance: number } | null;
    return found && found.distance <= 3 / this.zoom() ? { path: found.path, segment: found.segment, t: found.t } : null;
  }
  /** Drags a chosen segment: a curve is reshaped through the grabbed point, a line moves whole. */
  private dragSegmentGesture(point: Point) {
    const g = this.gesture!;
    const [, pi, si, t] = g.mode.split(":");
    const curves = structuredClone(g.original.curves!), path = curves[+pi];
    const a = path.nodes[+si], bIndex = (+si + 1) % path.nodes.length, b = path.nodes[bIndex];
    const from = localPoint(g.original, g.start), to = localPoint(g.original, point);
    const moved = dragSegment(a, b, +t, { x: to.x - from.x, y: to.y - from.y });
    path.nodes[+si] = moved.a;
    path.nodes[bIndex] = moved.b;
    this.setLayer(g.id, { curves });
  }
  /**
   * Removes the chosen anchors and segments, as Delete does with the Direct Selection
   * tool: an anchor goes with the segments on both of its sides, and what remains of the
   * path stays in place as open paths. Returns false when nothing was chosen.
   */
  removeSelectedParts(): boolean {
    const layers = this.selectedLayers().filter((layer) => layer.curves && !this.isEffectivelyLocked(layer) && !layer.guide);
    const targets = layers.filter((layer) => this.anchorKeysOf(layer.id).length || (layer.id === this.selectedId() && this.activeSegments().length));
    if (!targets.length || this.drawingLayer()) return false;
    const before = this.document();
    const updates = new Map<string, Layer | null>();
    for (const layer of targets) {
      const anchors = this.anchorKeysOf(layer.id), segments = layer.id === this.selectedId() ? this.activeSegments() : [];
      const pieces = layer.curves!.flatMap((path, pi) => removeParts(
        path,
        anchors.filter((key) => +key.split(":")[0] === pi).map((key) => +key.split(":")[1]),
        segments.filter((key) => +key.split(":")[0] === pi).map((key) => +key.split(":")[1]),
      ));
      updates.set(layer.id, pieces.length ? fitCurves(layer, pieces) : null);
    }
    this.commitStep(before);
    this.document.update((d) => ({ ...d, layers: d.layers.flatMap((l) => (updates.has(l.id) ? (updates.get(l.id) ? [updates.get(l.id)!] : []) : [l])) }));
    const kept = this.selectedIds().filter((id) => updates.get(id) !== null && this.document().layers.some((l) => l.id === id));
    this.selectedIds.set(kept);
    this.selectedId.set(kept.at(-1) ?? null);
    this.activeNodes.set([]);
    this.activeSegments.set([]);
    this.otherAnchors.set({});
    this.changed();
    return true;
  }
  /** Chooses the anchors inside a marquee drawn with the Direct Selection tool, across objects. */
  private selectAnchorsInArea(area: SelectionArea, shift: boolean, previous: { ids: string[]; primary: string | null; nodes: string[] }) {
    const polygon = selectionAreaPolygon(area);
    const inside = (p: Point) => pointInPolygon(p, polygon);
    const found = new Map<string, string[]>();
    for (const layer of this.document().layers) {
      if (!layer.visible || layer.guide || layer.dimension || layer.procedural || this.isEffectivelyLocked(layer) || !["path", "rectangle", "ellipse"].includes(layer.kind)) continue;
      const curves = this.editableCurves(layer);
      const keys: string[] = [];
      curves.forEach((path, pi) => path.nodes.forEach((node, ni) => { if (inside(worldPoint(layer, node.point))) keys.push(`${pi}:${ni}`); }));
      if (keys.length) found.set(layer.id, keys);
    }
    if (shift && previous.primary) {
      const union = new Set([...(found.get(previous.primary) ?? []), ...previous.nodes]);
      found.set(previous.primary, [...union]);
    }
    const ids = [...new Set([...(shift ? previous.ids : []), ...found.keys()])].filter((id) => this.document().layers.some((l) => l.id === id));
    // Rectangles and ellipses become paths, so their anchors can be edited.
    for (const id of found.keys()) {
      const layer = this.document().layers.find((l) => l.id === id)!;
      if (!layer.curves) this.setLayer(id, { kind: "path", curves: this.editableCurves(layer) });
    }
    const primary = ids.at(-1) ?? null;
    this.selectedIds.set(ids);
    this.selectedId.set(primary);
    this.activeNodes.set(primary ? found.get(primary) ?? [] : []);
    const others: Record<string, string[]> = {};
    for (const [id, keys] of found) if (id !== primary) others[id] = keys;
    this.otherAnchors.set(others);
    this.activeSegments.set([]);
  }
  /** The focal anchors of the Reshape tool on the selected path, as "path:index" keys. */
  readonly reshapeFocal = signal<string[]>([]);
  /**
   * The Reshape tool. A press on an anchor of the selected path makes it a focal point, and
   * a press on a segment adds an anchor there and makes that the focal point; Shift adds
   * more. Dragging then pulls the focal points all the way and the rest of the path along
   * with them, less the farther along the path an anchor lies, so the ends stay put and
   * the overall shape is stretched rather than bent.
   */
  private startReshape(point: Point, before: StudioDocument, modifiers: { shift?: boolean }) {
    let layer = this.selected();
    if (!layer || !["path", "rectangle", "ellipse"].includes(layer.kind) || this.isEffectivelyLocked(layer) || layer.dimension || layer.procedural) {
      const picked = pick(this.document().layers, point);
      if (!picked || !["path", "rectangle", "ellipse"].includes(picked.kind) || this.isEffectivelyLocked(picked)) { this.status.set("Select the path to reshape."); return; }
      this.selectedIds.set([picked.id]);
      this.selectedId.set(picked.id);
      this.reshapeFocal.set([]);
      layer = picked;
    }
    let target: Layer = layer.curves ? layer : { ...layer, kind: "path", curves: this.editableCurves(layer) };
    let key: string | null = null;
    const radius = 9 / this.zoom();
    target.curves!.forEach((path, pi) => path.nodes.forEach((node, ni) => {
      const world = worldPoint(target, node.point);
      if (!key && Math.hypot(world.x - point.x, world.y - point.y) <= radius) key = `${pi}:${ni}`;
    }));
    if (!key) {
      const segment = this.segmentAt(target, point);
      if (!segment) { if (!modifiers.shift) this.reshapeFocal.set([]); return; }
      // A press on a segment adds the focal anchor there, without changing the shape.
      const curves = structuredClone(target.curves!);
      curves[segment.path] = splitSegment(curves[segment.path], segment.segment, segment.t);
      target = { ...target, curves };
      this.setLayer(target.id, { kind: "path", curves });
      key = `${segment.path}:${segment.segment + 1}`;
      // Focal keys after the new anchor on the same path move one place along.
      this.reshapeFocal.update((keys) => keys.map((k) => {
        const [pi, ni] = k.split(":").map(Number);
        return pi === segment.path && ni > segment.segment ? `${pi}:${ni + 1}` : k;
      }));
    } else this.setLayer(target.id, { kind: "path", curves: target.curves });
    const chosen = key as string;
    this.reshapeFocal.update((keys) => modifiers.shift ? (keys.includes(chosen) ? keys : [...keys, chosen]) : keys.includes(chosen) ? keys : [chosen]);
    this.gesture = { before, start: point, last: point, id: target.id, points: [], original: structuredClone({ ...target, kind: "path" }), mode: "reshape" };
  }
  private dragReshape(point: Point) {
    const g = this.gesture!;
    const from = localPoint(g.original, g.start), to = localPoint(g.original, point);
    const delta = { x: to.x - from.x, y: to.y - from.y };
    const focal = this.reshapeFocal();
    const curves = g.original.curves!.map((path, pi) => {
      const focus = focal.filter((k) => +k.split(":")[0] === pi).map((k) => +k.split(":")[1]);
      if (!focus.length) return path;
      const weights = reshapeWeights(path, focus);
      return {
        ...path,
        nodes: path.nodes.map((node, ni) => weights[ni] > 0 ? placeAnchor(node, { x: node.point.x + delta.x * weights[ni], y: node.point.y + delta.y * weights[ni] }) : node),
      };
    });
    this.setLayer(g.id, { curves });
  }
  /**
   * The Group Selection tool. The first press takes the object under the pointer by
   * itself, even inside a group; each further press on it takes the next group out, up
   * to the outermost one. Shift adds to what is selected.
   */
  private groupSelectClick(point: Point, before: StudioDocument, modifiers: { shift?: boolean }) {
    const layer = pick(this.document().layers.filter((l) => !l.dimension || this.dimensionsVisible()), point);
    if (!layer || this.isEffectivelyLocked(layer)) {
      if (!modifiers.shift) { this.selectedIds.set([]); this.selectedId.set(null); }
      this.groupLevel = null;
      return;
    }
    const groups = layer.groupPath ?? [];
    const again = this.groupLevel?.id === layer.id && this.selectedIds().includes(layer.id);
    const level = again ? Math.min(groups.length, this.groupLevel!.level + 1) : 0;
    this.groupLevel = { id: layer.id, level };
    const members = level === 0
      ? [layer.id]
      : this.document().layers.filter((l) => {
          const prefix = groups.slice(0, groups.length - level + 1);
          return (l.groupPath ?? []).slice(0, prefix.length).join("/") === prefix.join("/");
        }).map((l) => l.id);
    const ids = modifiers.shift ? [...new Set([...this.selectedIds(), ...members])] : members;
    this.selectedIds.set(ids);
    this.selectedId.set(layer.id);
    this.activeNodes.set([]);
    this.otherAnchors.set({});
    const active = this.selectionLayer();
    if (active) this.gesture = { before, start: point, last: point, id: active.id, points: [], original: structuredClone(active), mode: "move", ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id) };
  }
  private groupLevel: { id: string; level: number } | null = null;
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
    const visible = this.visibleHandles(layer);
    layer.curves?.forEach((path, pathIndex) => {
      path.nodes.forEach((node, index) => {
        for (const part of ["point", "incoming", "outgoing"] as const) {
          if (part !== "point" && !visible.has(`${pathIndex}:${index}:${part}`)) continue;
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
  /**
   * The Direct Selection tool, and the Path Eraser, as Illustrator uses them. A press on an
   * anchor or a visible handle takes it; a press within a couple of pixels of a segment
   * chooses the segment, and a drag reshapes it; a press inside a filled path chooses all
   * its anchors; a press on empty canvas starts a marquee that chooses the anchors inside
   * it, across objects. Shift adds to what is chosen and takes back what already was.
   */
  private startPathEdit(
    point: Point,
    before: StudioDocument,
    modifiers: { shift?: boolean; alt?: boolean; ctrl?: boolean },
    tool = this.tool(),
  ) {
    const editable = (candidate: Layer | null | undefined): Layer | null => {
      if (!candidate || this.isEffectivelyLocked(candidate) || !candidate.visible || candidate.guide || candidate.dimension || candidate.procedural) return null;
      if (!["path", "rectangle", "ellipse"].includes(candidate.kind)) return null;
      return candidate.curves ? candidate : { ...candidate, kind: "path", curves: this.editableCurves(candidate) };
    };
    // Anchors and segments of the selected objects come first, the frontmost object after.
    let layer: Layer | null = null;
    let hit: ReturnType<EditorService["findCurveNode"]>;
    let segment: ReturnType<EditorService["segmentAt"]> = null;
    for (const candidate of [...this.selectedLayers()].reverse().map(editable)) {
      if (!candidate) continue;
      hit = this.findCurveNode(candidate, point);
      if (hit) { layer = candidate; break; }
    }
    if (!layer && tool === "direct") {
      for (const candidate of [...this.selectedLayers()].reverse().map(editable)) {
        if (!candidate) continue;
        segment = this.segmentAt(candidate, point);
        if (segment) { layer = candidate; break; }
      }
    }
    const picked = !layer ? pick(this.document().layers.filter((l) => !l.dimension || this.dimensionsVisible()), point) ?? null : null;
    if (!layer && picked) {
      layer = editable(picked);
      if (layer) {
        hit = this.findCurveNode(layer, point);
        if (!hit && tool === "direct") segment = this.segmentAt(layer, point);
      } else if (picked && tool === "direct") {
        // A text or an image is taken whole by the Direct Selection tool.
        if (!this.isEffectivelyLocked(picked)) this.selectLayer(picked.id, !!modifiers.shift);
        return;
      }
    }
    if (!layer) {
      if (tool === "direct") {
        if (!modifiers.shift) { this.activeNodes.set([]); this.activeSegments.set([]); this.otherAnchors.set({}); }
        this.startAreaSelection(point, "rectangle", !!modifiers.shift, true);
      } else this.selectedId.set(null);
      return;
    }
    const curves = structuredClone(layer.curves!);
    const target = layer;
    // Shift keeps the anchors chosen on the other objects; a plain press starts again.
    if (this.selectedId() !== target.id) {
      if (modifiers.shift && this.selectedId()) {
        const previous = this.selectedId()!;
        this.otherAnchors.update((all) => ({ ...all, [previous]: this.activeNodes() }));
        this.selectedIds.update((ids) => [...ids.filter((id) => id !== target.id), target.id]);
        this.activeNodes.set(this.otherAnchors()[target.id] ?? []);
      } else {
        this.selectedIds.set([target.id]);
        this.activeNodes.set([]);
        this.otherAnchors.set({});
      }
      this.activeSegments.set([]);
      this.selectedId.set(target.id);
    } else if (!this.selectedIds().includes(target.id)) this.selectedIds.set([target.id]);
    this.setLayer(target.id, { kind: "path", curves });
    if (tool === "pathEraser") {
      this.gesture = { before, start: point, last: point, id: target.id, points: [], original: structuredClone({ ...target, curves }), mode: tool };
      this.erasePath(point);
      return;
    }
    if (segment) {
      const key = `${segment.path}:${segment.segment}`;
      if (modifiers.shift) {
        this.activeSegments.update((keys) => keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
      } else if (!this.activeSegments().includes(key)) {
        this.activeSegments.set([key]);
        this.activeNodes.set([]);
      }
      this.gesture = { before, start: point, last: point, id: target.id, points: [], original: structuredClone({ ...target, curves }), mode: `segment:${segment.path}:${segment.segment}:${segment.t}` };
      return;
    }
    if (!hit) {
      // A press inside a filled path chooses all of its anchors, and a drag moves them.
      const filled = target.fill !== "none" && target.fill !== "transparent" && curves.some((c) => c.closed);
      if (tool === "direct" && filled) {
        this.activeNodes.set(curves.flatMap((path, pi) => path.nodes.map((_, ni) => `${pi}:${ni}`)));
        this.activeSegments.set([]);
        this.gesture = { before, start: point, last: point, id: target.id, points: [], original: structuredClone({ ...target, curves }), mode: "node:0:0:point" };
      }
      return;
    }
    const key = hit.path + ":" + hit.index;
    const deselectNodeOnClick =
      modifiers.shift && hit.part === "point" && this.activeNodes().includes(key)
        ? key
        : undefined;
    if (modifiers.shift && hit.part === "point") {
      if (!this.activeNodes().includes(key))
        this.activeNodes.update((keys) => [...keys, key]);
    } else if (hit.part === "point" && !this.activeNodes().includes(key)) {
      this.activeNodes.set([key]);
      this.otherAnchors.set({});
      this.selectedIds.set([target.id]);
    }
    if (hit.part === "point" && !modifiers.shift) this.activeSegments.set([]);
    const others = Object.entries(this.otherAnchors()).filter(([id, keys]) => keys.length && this.selectedIds().includes(id));
    if (hit.part === "point" && others.length && this.activeNodes().includes(key)) {
      // Anchors chosen on several objects move together.
      const ids = [target.id, ...others.map(([id]) => id)];
      this.gesture = { before, start: point, last: point, id: target.id, points: [], original: structuredClone({ ...target, curves }), mode: "anchors", ids, deselectNodeOnClick };
      this.anchorOriginals = new Map(ids.map((id) => [id, structuredClone(this.document().layers.find((l) => l.id === id)!)]));
      return;
    }
    this.gesture = {
      before,
      start: point,
      last: point,
      id: target.id,
      points: [],
      original: structuredClone({ ...target, curves }),
      mode: "node:" + hit.path + ":" + hit.index + ":" + hit.part,
      deselectNodeOnClick,
    };
  }
  private anchorOriginals?: Map<string, Layer>;
  /** Moves the anchors chosen on every object by the drag, handles and all. */
  private dragAnchorsAcross(point: Point, modifiers: { shift?: boolean }) {
    const g = this.gesture!;
    const end = modifiers.shift ? snapDirection(g.start, point, this.snapAngle()) : point;
    const dx = end.x - g.start.x, dy = end.y - g.start.y;
    const updates = new Map<string, Layer>();
    for (const [id, original] of this.anchorOriginals ?? []) {
      const keys = new Set(this.anchorKeysOf(id));
      if (!original.curves || !keys.size) continue;
      const curves = original.curves.map((path, pi) => ({
        ...path,
        nodes: path.nodes.map((node, ni) => {
          if (!keys.has(`${pi}:${ni}`)) return node;
          const at = worldPoint(original, node.point);
          return placeAnchor(node, localPoint(original, { x: at.x + dx, y: at.y + dy }));
        }),
      }));
      updates.set(id, { ...original, curves });
    }
    this.document.update((d) => ({ ...d, layers: d.layers.map((l) => updates.get(l.id) ?? l) }));
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
  /** The chosen anchors of every selected object, as layer, path and index. */
  private chosenAnchors(): Array<{ layer: Layer; path: number; index: number }> {
    const result: Array<{ layer: Layer; path: number; index: number }> = [];
    for (const layer of this.selectedLayers()) {
      if (!layer.curves || this.isEffectivelyLocked(layer)) continue;
      for (const key of this.anchorKeysOf(layer.id)) {
        const [path, index] = key.split(":").map(Number);
        if (layer.curves[path]?.nodes[index]) result.push({ layer, path, index });
      }
    }
    return result;
  }
  /**
   * Object > Path > Join. Two chosen endpoints are joined; a path whose own two endpoints
   * are chosen, or a whole open path, is closed; two whole open paths are joined at their
   * nearest endpoints. Endpoints that lie on each other become one anchor, a corner or a
   * smooth point, which is why the caller may be asked for the kind first.
   */
  joinSelection(kind?: "corner" | "smooth"): "joined" | "chooseKind" | "nothing" {
    const ends = this.chosenAnchors().filter(({ layer, path, index }) => {
      const p = layer.curves![path];
      return !p.closed && (index === 0 || index === p.nodes.length - 1);
    });
    let pair: Array<{ layer: Layer; path: number; atStart: boolean }> = [];
    if (ends.length === 2) pair = ends.map((e) => ({ layer: e.layer, path: e.path, atStart: e.index === 0 }));
    else if (!this.chosenAnchors().length) {
      const open = this.selectedLayers().filter((l) => l.curves?.length === 1 && !l.curves[0].closed && l.curves[0].nodes.length > 1 && !this.isEffectivelyLocked(l));
      if (open.length === 1) pair = [{ layer: open[0], path: 0, atStart: true }, { layer: open[0], path: 0, atStart: false }];
      else if (open.length === 2) {
        const candidates = [true, false].flatMap((a) => [true, false].map((b) => {
          const pa = open[0].curves![0].nodes, pb = open[1].curves![0].nodes;
          const wa = worldPoint(open[0], (a ? pa[0] : pa[pa.length - 1]).point), wb = worldPoint(open[1], (b ? pb[0] : pb[pb.length - 1]).point);
          return { a, b, distance: Math.hypot(wa.x - wb.x, wa.y - wb.y) };
        })).sort((x, y) => x.distance - y.distance);
        pair = [{ layer: open[0], path: 0, atStart: candidates[0].a }, { layer: open[1], path: 0, atStart: candidates[0].b }];
      }
    }
    if (pair.length !== 2) { this.status.set("Choose two endpoints of open paths to join."); return "nothing"; }
    const [first, second] = pair;
    const endPoint = (e: typeof first) => {
      const nodes = e.layer.curves![e.path].nodes;
      return worldPoint(e.layer, (e.atStart ? nodes[0] : nodes[nodes.length - 1]).point);
    };
    const a = endPoint(first), b = endPoint(second);
    const coincident = Math.hypot(a.x - b.x, a.y - b.y) <= 0.5;
    if (coincident && !kind) return "chooseKind";
    const before = this.document();
    if (first.layer.id === second.layer.id && first.path === second.path) {
      const curves = structuredClone(first.layer.curves!);
      curves[first.path] = closeByJoin(curves[first.path], kind ?? "corner");
      this.commitStep(before);
      this.setLayer(first.layer.id, fitCurves(first.layer, curves));
    } else {
      const target = first.layer;
      const other = second.layer.id === target.id
        ? second.layer.curves![second.path]
        : mapCurves([second.layer.curves![second.path]], (p) => localPoint(target, worldPoint(second.layer, p)))[0];
      const joined = joinPaths(target.curves![first.path], first.atStart, other, second.atStart, kind ?? "corner");
      const curves = structuredClone(target.curves!);
      curves[first.path] = joined;
      if (second.layer.id === target.id) curves.splice(second.path, 1);
      this.commitStep(before);
      this.document.update((d) => ({
        ...d,
        layers: d.layers
          .map((l) => {
            if (l.id === target.id) return fitCurves(target, curves);
            if (l.id === second.layer.id && second.layer.id !== target.id) {
              const rest = l.curves!.filter((_, i) => i !== second.path);
              return rest.length ? fitCurves(l, rest) : null;
            }
            return l;
          })
          .filter((l): l is Layer => !!l),
      }));
      this.selectedIds.set([target.id]);
      this.selectedId.set(target.id);
    }
    this.activeNodes.set([]);
    this.otherAnchors.set({});
    this.activeSegments.set([]);
    this.status.set("Joined.");
    this.changed();
    return "joined";
  }
  /** Object > Path > Average: moves the chosen anchors to their common position. */
  averageSelection(axis: "horizontal" | "vertical" | "both"): boolean {
    const chosen = this.chosenAnchors();
    if (chosen.length < 2) { this.status.set("Choose two or more anchors to average."); return false; }
    const worlds = chosen.map(({ layer, path, index }) => worldPoint(layer, layer.curves![path].nodes[index].point));
    const targets = averagePoints(worlds, axis);
    const before = this.document();
    const updates = new Map<string, CurvePath[]>();
    chosen.forEach(({ layer, path, index }, i) => {
      const curves = updates.get(layer.id) ?? structuredClone(layer.curves!);
      curves[path].nodes[index] = placeAnchor(curves[path].nodes[index], localPoint(layer, targets[i]));
      updates.set(layer.id, curves);
    });
    this.commitStep(before);
    this.document.update((d) => ({ ...d, layers: d.layers.map((l) => (updates.has(l.id) ? fitCurves(l, updates.get(l.id)!) : l)) }));
    this.changed();
    return true;
  }
  /** Converts the chosen anchors to corners without handles, or to smooth points. */
  convertSelectedAnchors(kind: "corner" | "smooth"): boolean {
    const chosen = this.chosenAnchors();
    if (!chosen.length) { this.status.set("Choose the anchors to convert."); return false; }
    const before = this.document();
    const updates = new Map<string, CurvePath[]>();
    for (const { layer, path, index } of chosen) {
      const curves = updates.get(layer.id) ?? structuredClone(layer.curves!);
      const p = curves[path], node = p.nodes[index];
      if (kind === "corner") p.nodes[index] = anchor(node.point);
      else {
        // A smooth point takes handles along the line between its neighbours, a third of the way to each.
        const n = p.nodes.length;
        const prev = p.closed || index > 0 ? p.nodes[(index - 1 + n) % n].point : node.point;
        const next = p.closed || index < n - 1 ? p.nodes[(index + 1) % n].point : node.point;
        const dx = next.x - prev.x, dy = next.y - prev.y, length = Math.hypot(dx, dy) || 1;
        const back = Math.hypot(node.point.x - prev.x, node.point.y - prev.y) / 3;
        const ahead = Math.hypot(next.x - node.point.x, next.y - node.point.y) / 3;
        p.nodes[index] = {
          point: { ...node.point },
          incoming: { x: node.point.x - (dx / length) * back, y: node.point.y - (dy / length) * back },
          outgoing: { x: node.point.x + (dx / length) * ahead, y: node.point.y + (dy / length) * ahead },
          smooth: true,
        };
      }
      updates.set(layer.id, curves);
    }
    this.commitStep(before);
    this.document.update((d) => ({ ...d, layers: d.layers.map((l) => (updates.has(l.id) ? fitCurves(l, updates.get(l.id)!) : l)) }));
    this.changed();
    return true;
  }
  /** Removes the chosen anchors and keeps each path whole, as Remove Selected Anchor Points does. */
  removeSelectedAnchors(): boolean {
    const chosen = this.chosenAnchors();
    if (!chosen.length) { this.status.set("Choose the anchors to remove."); return false; }
    const before = this.document();
    const updates = new Map<string, CurvePath[]>();
    const byLayer = new Map<string, Array<{ path: number; index: number }>>();
    for (const c of chosen) byLayer.set(c.layer.id, [...(byLayer.get(c.layer.id) ?? []), { path: c.path, index: c.index }]);
    for (const [id, list] of byLayer) {
      const layer = this.document().layers.find((l) => l.id === id)!;
      let curves = structuredClone(layer.curves!);
      // Later anchors go first so the earlier indices stay right.
      for (const { path, index } of [...list].sort((a, b) => b.path - a.path || b.index - a.index)) curves[path] = deleteAnchorKeepingShape(curves[path], index);
      curves = curves.filter((c) => c.nodes.length > 1);
      updates.set(id, curves);
    }
    this.commitStep(before);
    this.document.update((d) => ({ ...d, layers: d.layers.flatMap((l) => (!updates.has(l.id) ? [l] : updates.get(l.id)!.length ? [fitCurves(l, updates.get(l.id)!)] : [])) }));
    this.activeNodes.set([]);
    this.otherAnchors.set({});
    this.selectedIds.update((ids) => ids.filter((id) => this.document().layers.some((l) => l.id === id)));
    this.selectedId.set(this.selectedIds().at(-1) ?? null);
    this.changed();
    return true;
  }
  /** Cuts the paths at the chosen anchors; each cut leaves two endpoints on top of each other. */
  cutAtSelectedAnchors(): boolean {
    const layer = this.selected();
    const keys = layer ? this.anchorKeysOf(layer.id) : [];
    if (!layer?.curves || !keys.length || this.isEffectivelyLocked(layer)) { this.status.set("Choose the anchors to cut the path at."); return false; }
    const pieces = layer.curves.flatMap((path, pi) => cutAtAnchors(path, keys.filter((k) => +k.split(":")[0] === pi).map((k) => +k.split(":")[1])));
    if (pieces.length === layer.curves.length && pieces.every((p, i) => p.closed === layer.curves![i].closed)) { this.status.set("The path cannot be cut at an endpoint."); return false; }
    this.replaceWithPieces(this.document(), layer, pieces, []);
    this.status.set(`Cut into ${pieces.length} paths.`);
    return true;
  }
  /** Select > Object > Stray Points: paths made of a single anchor. */
  selectStrayPoints(): number {
    const stray = this.document().layers.filter((l) => l.kind === "path" && !l.guide && !l.dimension && !l.procedural && l.visible && !this.isEffectivelyLocked(l)
      && ((l.curves && l.curves.every((c) => c.nodes.length <= 1)) || (!l.curves && l.points.length <= 1)));
    this.selectedIds.set(stray.map((l) => l.id));
    this.selectedId.set(stray.at(-1)?.id ?? null);
    this.activeNodes.set([]);
    this.status.set(stray.length ? `Selected ${stray.length} stray point${stray.length > 1 ? "s" : ""}.` : "There are no stray points.");
    return stray.length;
  }
  private simplifyBefore?: { document: StudioDocument; ids: string[] };
  /**
   * Object > Path > Simplify, previewed on the selected paths while its dialog is open.
   * Returns the anchor counts before and after, which the dialog shows.
   */
  previewSimplify(options: SimplifyOptions, show = true): { original: number; current: number } {
    if (!this.simplifyBefore) this.simplifyBefore = { document: this.document(), ids: this.selectedLayers().filter((l) => l.kind === "path" && l.curves && !this.isEffectivelyLocked(l) && !l.dimension && !l.procedural).map((l) => l.id) };
    const base = this.simplifyBefore;
    let original = 0, current = 0;
    const layers = base.document.layers.map((l) => {
      if (!base.ids.includes(l.id) || !l.curves) return l;
      const simplified = l.curves.map((c) => simplifyPath(c, options));
      original += l.curves.reduce((n, c) => n + c.nodes.length, 0);
      current += simplified.reduce((n, c) => n + c.nodes.length, 0);
      return fitCurves(l, simplified);
    });
    // With the preview off the dialog still counts, but the paths stay as they were.
    this.document.set(show ? { ...base.document, layers } : base.document);
    return { original, current };
  }
  /** Keeps the previewed simplification as one step, or puts the paths back. */
  finishSimplify(apply: boolean) {
    const base = this.simplifyBefore;
    this.simplifyBefore = undefined;
    if (!base) return;
    if (!apply) { this.document.set(base.document); this.revision.update((x) => x + 1); return; }
    this.commitStep(base.document);
    this.activeNodes.set([]);
    this.changed();
  }
  /** Simplify's Show Original: the paths as they were, drawn thin behind the preview. */
  readonly simplifyShowOriginal = signal(false);
  private simplifyGhosts(): Layer[] {
    const base = this.simplifyBefore;
    if (!base || !this.simplifyShowOriginal()) return [];
    return base.document.layers
      .filter((l) => base.ids.includes(l.id))
      .map((l) => ({ ...l, id: "__original__" + l.id, fill: "none", stroke: "#e2304d", strokeWidth: 1 / Math.max(0.1, this.zoom()), brushStroke: undefined, lineEnds: undefined, opacity: 0.8 }));
  }
  /** Whether a Simplify preview is open; the original is still what undo returns to. */
  simplifying() { return !!this.simplifyBefore; }
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
    if (action === "simplify") curves = curves.map((c) => simplifyPath(c, DEFAULT_SIMPLIFY));
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
  /**
   * Starts transforming the selection with two fingers: the selection scales in
   * proportion, turns and travels with them, around its pivot. Returns false when there
   * is nothing the fingers may transform.
   */
  startTouchTransform(): boolean {
    const active = this.selectionLayer();
    if (!active || this.gesture || this.selectedLayers().some((layer) => this.isEffectivelyLocked(layer))) return false;
    this.gesture = {
      before: structuredClone(this.document()),
      start: { x: 0, y: 0 },
      last: { x: 0, y: 1 },
      id: active.id,
      points: [],
      original: structuredClone(active),
      mode: "scale",
      ids: this.selectedLayers().filter((l) => !l.guide).map((l) => l.id),
    };
    return true;
  }
  /** Applies the change of the two fingers since they landed, in document units for the shift. */
  touchTransform(scale: number, rotation: number, shift: Point) {
    const g = this.gesture;
    if (!g || g.mode !== "scale") return;
    const factor = Math.min(10, Math.max(0.05, Number.isFinite(scale) ? scale : 1));
    const w = g.original.width, h = g.original.height;
    const target = this.aroundPivot(g.original, {
      ...g.original,
      width: w * factor,
      height: h * factor,
      x: g.original.x + (w * (1 - factor)) / 2,
      y: g.original.y + (h * (1 - factor)) / 2,
      rotation: g.original.rotation + rotation,
    });
    this.transformSelection(g, { ...target, x: target.x + shift.x, y: target.y + shift.y });
  }
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
  /**
   * The Path Eraser removes the parts of the path the pointer passes over and keeps the
   * rest as the Bezier segments it was, cut exactly where the eraser met them.
   */
  private erasePath(point: Point) {
    const g = this.gesture!;
    g.points.push(point);
    const original = g.original;
    const local = g.points.map((p) => localPoint(original, p));
    const radius = 5 / this.zoom() + original.strokeWidth / 2;
    const curves = this.editableCurves(original).flatMap((path) => removeRanges(path, rangesNear(path, local, radius)));
    if (!curves.length) { this.setLayer(g.id, { kind: "path", curves: [] }); return; }
    this.setLayer(g.id, fitCurves({ ...original, kind: "path" }, curves));
  }
  /**
   * A path erased to nothing goes, and a single path the eraser cut in pieces becomes one
   * object per piece, as the pieces are separate paths now.
   */
  private finishPathEraser(g: { id: string; original: Layer }) {
    const layer = this.document().layers.find((l) => l.id === g.id);
    if (!layer) return;
    if (!layer.curves?.length) {
      this.document.update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== g.id) }));
      this.selectedId.set(null);
      this.selectedIds.set([]);
      return;
    }
    if (this.editableCurves(g.original).length !== 1 || layer.curves.length < 2) return;
    const pieces = layer.curves.map((path) => {
      const world = this.worldCurve(layer, path);
      const fresh = fitCurves({ ...newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }), rotation: 0 }, [world]);
      return { ...layer, ...fresh, id: fresh.id, kind: "path" as const, rotation: 0, flipX: false, flipY: false, skewX: 0, points: [] };
    });
    this.document.update((d) => ({ ...d, layers: d.layers.flatMap((l) => (l.id === g.id ? pieces : [l])) }));
    this.selectedIds.set(pieces.map((piece) => piece.id));
    this.selectedId.set(pieces[0].id);
  }
  /** The Eraser's nib, as its options set it; Illustrator's default is a round 10 point nib. */
  readonly eraserShape = signal<{ angle: number; roundness: number; diameter: number }>({ angle: 0, roundness: 100, diameter: 10 });
  private eraserTargets: string[] = [];
  private eraserMarquee = false;
  /** The layers the Eraser works on: the selected ones, or every one when nothing is selected. */
  private eraserLayers(): Layer[] {
    const vector = (l: Layer) => l.visible && !l.guide && !l.dimension && !l.procedural && !this.isEffectivelyLocked(l) && ["path", "rectangle", "ellipse"].includes(l.kind);
    const selected = this.selectedLayers();
    return (selected.length ? selected : this.document().layers).filter(vector);
  }
  /**
   * The Eraser on vector artwork: the nib erases whatever it passes over, across every
   * object when nothing is selected. Shift keeps the drag on a horizontal, vertical or
   * diagonal line, and Alt draws a marquee whose whole area is erased on release.
   */
  private startVectorEraser(point: Point, before: StudioDocument, modifiers: { alt?: boolean }) {
    this.eraserTargets = this.eraserLayers().map((l) => l.id);
    if (!this.eraserTargets.length) { this.status.set("There is nothing here the Eraser can erase."); return; }
    this.eraserMarquee = !!modifiers.alt;
    this.gesture = { before, start: point, last: point, id: this.eraserTargets[0], points: [point], original: this.document().layers.find((l) => l.id === this.eraserTargets[0])!, mode: "vectorEraser" };
    if (this.eraserMarquee) this.areaSelection.set({ kind: "rectangle", start: point, end: point, points: [point] });
    else this.eraseAlong(point, point);
  }
  private dragVectorEraser(point: Point, modifiers: { shift?: boolean; alt?: boolean }) {
    const g = this.gesture!;
    if (this.eraserMarquee) {
      let end = point;
      if (modifiers.shift) {
        // Alt with Shift keeps the marquee square.
        const side = Math.max(Math.abs(point.x - g.start.x), Math.abs(point.y - g.start.y));
        end = { x: g.start.x + Math.sign(point.x - g.start.x || 1) * side, y: g.start.y + Math.sign(point.y - g.start.y || 1) * side };
      }
      this.areaSelection.set({ kind: "rectangle", start: g.start, end, points: [g.start] });
      return;
    }
    const to = modifiers.shift ? snapDirection(g.start, point, 45) : point;
    this.eraseAlong(g.points[g.points.length - 1], to);
    g.points.push(to);
  }
  /** Erases with the nib at every step from one pointer position to the next, so fast drags leave no gaps. */
  private eraseAlong(from: Point, to: Point) {
    const shape = this.eraserShape();
    const brush = { kind: "calligraphic" as const, ...shape };
    // The nib is convex, so the area it sweeps in a straight move is the hull of its two ends.
    this.eraseAreas([convexHull([...nibOutline(brush, from), ...nibOutline(brush, to)])]);
  }
  private eraseAreas(areas: Point[][]) {
    const updates = new Map<string, Layer>();
    for (const id of this.eraserTargets) {
      const layer = this.document().layers.find((l) => l.id === id);
      if (!layer) continue;
      let curves = this.editableCurves(layer);
      for (const area of areas) curves = eraseArea(curves, area.map((p) => localPoint(layer, p)));
      if (curves.reduce((n, c) => n + c.nodes.length, 0) > 20000) continue;
      updates.set(id, curves.length ? { ...layer, kind: "path", curves } : { ...layer, kind: "path", curves: [] });
    }
    this.document.update((d) => ({ ...d, layers: d.layers.map((l) => updates.get(l.id) ?? l) }));
  }
  /** Ends an erasure: a marquee erases its area, emptied objects go and cut paths come apart. */
  private finishVectorEraser() {
    const area = this.areaSelection();
    if (this.eraserMarquee && area) {
      const { start, end } = area;
      this.eraseAreas([[start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }]]);
      this.areaSelection.set(null);
    }
    this.eraserMarquee = false;
    const pieces: Layer[] = [];
    this.document.update((d) => ({
      ...d,
      layers: d.layers.flatMap((l) => {
        if (!this.eraserTargets.includes(l.id)) return [l];
        if (!l.curves?.length) return [];
        const open = l.curves.filter((c) => !c.closed);
        if (open.length < 2 || open.length !== l.curves.length) return [fitCurves(l, l.curves)];
        // Open paths the Eraser cut in pieces become one object per piece.
        return open.map((path) => {
          const fresh = fitCurves({ ...newLayer("path", crypto.randomUUID(), { x: 0, y: 0 }), rotation: 0 }, [this.worldCurve(l, path)]);
          const piece = { ...l, ...fresh, id: fresh.id, kind: "path" as const, rotation: 0, flipX: false, flipY: false, skewX: 0, points: [] };
          pieces.push(piece);
          return [piece];
        }).flat();
      }),
    }));
    const kept = this.selectedIds().filter((id) => this.document().layers.some((l) => l.id === id));
    if (this.selectedIds().length) {
      const ids = [...kept, ...pieces.map((p) => p.id)];
      this.selectedIds.set(ids);
      this.selectedId.set(ids.at(-1) ?? null);
    }
    this.eraserTargets = [];
  }
  /** Changes the Eraser's diameter by a step, as [ and ] do in Illustrator. */
  resizeEraser(step: number) {
    this.eraserShape.update((shape) => ({ ...shape, diameter: Math.min(1296, Math.max(1, Math.round(shape.diameter + step))) }));
    this.status.set(`Eraser diameter: ${this.eraserShape().diameter} px`);
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
    if (!symbol || this.document().layers.length >= MAX_LAYERS) return;
    this.commitStep(this.document());
    this.addInstance(point);
    this.changed();
  }
  private addInstance(point: Point) {
    const symbol = this.document().symbols?.find(
      (s) => s.id === this.activeSymbol(),
    );
    if (!symbol || this.document().layers.length >= MAX_LAYERS) return;
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
    if (retained.length + regions.length > MAX_LAYERS)
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
    if (this.document().layers.length >= MAX_LAYERS)
      throw new Error("The document cannot hold more layers.");
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
    if (name.endsWith(".eps") || name.endsWith(".ps")) {
      if (file.size > 20_000_000) throw new Error("Choose a drawing under 20 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      return this.placeImport(epsArtwork(epsPostScript(bytes), { name: file.name.slice(0, 80) }));
    }
    if (name.endsWith(".dwg")) throw new Error("DWG cannot be read; export the drawing as DXF and import that.");
    if (name.endsWith(".ai") || name.endsWith(".pdf")) {
      if (file.size > 20_000_000) throw new Error("Choose a drawing under 20 MB.");
      return this.placeImport(await this.readPdf(new Uint8Array(await file.arrayBuffer()), file.name.slice(0, 80)));
    }
    return this.importImage(file);
  }
  /**
   * Reads the drawing of a PDF or Illustrator file. The streams are decompressed here,
   * where the platform lives, and interpreted by the reader in the domain.
   */
  private async readPdf(bytes: Uint8Array, name: string): Promise<ImportResult> {
    const objects = pdfObjects(bytes);
    const page = pdfFirstPage(objects);
    let content = "";
    for (const id of page.contents) {
      const stream = objects.get(id)?.stream;
      if (!stream) continue;
      content += await this.streamText(bytes.slice(stream.start, stream.end), stream.filter);
    }
    if (!content.trim()) throw new Error("The drawing of this file could not be read.");
    return pdfArtwork(content, page, { name });
  }
  /** Decompresses a stream with the decompression the browser provides; raw data passes through. */
  private async streamText(data: Uint8Array, filter: string): Promise<string> {
    let bytes = data;
    if (filter === "FlateDecode") {
      const inflate = async (format: "deflate" | "deflate-raw") => {
        const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      };
      try { bytes = await inflate("deflate"); }
      catch { try { bytes = await inflate("deflate-raw"); } catch { throw new Error("The drawing of this file could not be read."); } }
    } else if (filter) throw new Error("The drawing of this file could not be read.");
    let text = "";
    for (let index = 0; index < bytes.length; index++) text += String.fromCharCode(bytes[index]);
    return text;
  }
  /** Places an imported drawing as one history step, reporting what the reader skipped. */
  private placeImport(result: ImportResult) {
    if (!result.layers.length) throw new Error("The drawing has no content this editor can place.");
    const document = this.document();
    if (document.layers.length + result.layers.length > MAX_LAYERS) throw new Error("The document cannot hold more layers.");
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
