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
import {
  blankDocument,
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
@Injectable({ providedIn: "root" })
export class EditorService {
  readonly snapAngle = signal(45);
  readonly shapeOptions = signal<ShapeOptions>({ ...DEFAULT_SHAPE });
  readonly activeNodes = signal<string[]>([]);
  readonly penId = signal<string | null>(null);
  readonly activeSymbol = signal<string | null>(null);
  readonly symbolRadius = signal(70);
  readonly symbolIntensity = signal(0.25);
  readonly showHandles = signal(true);
  readonly handleSize = signal(4);
  readonly document = signal<StudioDocument>(blankDocument());
  readonly selectedId = signal<string | null>(null);
  readonly tool = signal<ToolId>("select");
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
    const layers = this.selectedLayers();
    return layers.length > 1
      ? {
          ...newLayer("rectangle", "__selection__", { x: 0, y: 0 }),
          ...selectionBounds(layers),
        }
      : (layers[0] ?? null);
  });
  readonly selected = computed(
    () =>
      this.document().layers.find((l) => l.id === this.selectedId()) ?? null,
  );
  readonly history = new DocumentHistory();
  readonly renderer = new CanvasRenderer();
  painting?: { id: string; canvas: HTMLCanvasElement };
  private gesture?: {
    before: StudioDocument;
    start: Point;
    last: Point;
    id: string;
    points: Point[];
    original: Layer;
    mode: string;
    ids?: string[];
  };
  constructor() {
    try {
      const draft = localStorage.getItem("xds-draft");
      if (draft) this.document.set(parseDocument(draft));
    } catch {
      this.status.set(
        "Previous draft could not be restored. Open a saved project.",
      );
    }
  }
  private changed() {
    this.revision.update((x) => x + 1);
    this.renderer.prune(this.document().layers);
    try {
      const text = JSON.stringify(this.document());
      if (text.length < 4_000_000) localStorage.setItem("xds-draft", text);
      else {
        localStorage.removeItem("xds-draft");
        this.status.set(
          "Large project: save a project file to preserve your work.",
        );
      }
    } catch {
      this.status.set("Browser storage is full. Save a project file.");
    }
  }
  private setLayer(id: string, patch: Partial<Layer>) {
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  }
  updateLayer(patch: Partial<Layer>) {
    const layer = this.selected();
    if (!layer || layer.locked) return;
    this.history.commit(this.document());
    if (patch.width !== undefined || patch.height !== undefined)
      patch = {
        ...resizeLayer(
          layer,
          patch.width ?? layer.width,
          patch.height ?? layer.height,
        ),
        ...patch,
      };
    this.setLayer(layer.id, patch);
    this.changed();
  }
  toggle(id: string, key: "visible" | "locked") {
    this.history.commit(this.document());
    const layer = this.document().layers.find((l) => l.id === id)!;
    this.setLayer(id, { [key]: !layer[key] });
    this.changed();
  }
  rename(name: string) {
    this.history.commit(this.document());
    this.document.update((d) => ({ ...d, name: name.slice(0, 150) }));
    this.changed();
  }
  background(value: string) {
    this.history.commit(this.document());
    this.document.update((d) => ({ ...d, background: value }));
    this.changed();
  }
  moveOrder(delta: number) {
    const id = this.selectedId(),
      layers = [...this.document().layers],
      i = layers.findIndex((l) => l.id === id),
      j = i + delta;
    if (i < 0 || j < 0 || j >= layers.length) return;
    this.history.commit(this.document());
    [layers[i], layers[j]] = [layers[j], layers[i]];
    this.document.update((d) => ({ ...d, layers }));
    this.changed();
  }
  remove() {
    const ids = new Set(
      this.selectedLayers()
        .filter((l) => !l.locked)
        .map((l) => l.id),
    );
    if (!ids.size) return;
    this.history.commit(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.filter((l) => !ids.has(l.id)),
    }));
    this.selectedId.set(null);
    this.selectedIds.set([]);
    this.changed();
  }
  duplicate() {
    const layers = this.selectedLayers();
    if (!layers.length || this.document().layers.length + layers.length > 150)
      return;
    this.history.commit(this.document());
    const groups = new Map<string, string>();
    const copies = layers.map((layer) => ({
      ...structuredClone(layer),
      id: crypto.randomUUID(),
      name: layer.name + " copy",
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
    this.document.update((d) => ({ ...d, layers: [...d.layers, ...copies] }));
    this.selectedIds.set(copies.map((l) => l.id));
    this.selectedId.set(copies.at(-1)!.id);
    this.changed();
  }
  undo() {
    this.penId.set(null);
    this.cancel();
    this.document.set(this.history.undo(this.document()));
    this.changed();
  }
  redo() {
    this.penId.set(null);
    this.cancel();
    this.document.set(this.history.redo(this.document()));
    this.changed();
  }
  reset() {
    this.finishPath();
    this.history.commit(this.document());
    this.document.set(blankDocument());
    this.selectedId.set(null);
    this.changed();
  }
  open(text: string) {
    this.finishPath();
    const doc = parseDocument(text);
    this.history.commit(this.document());
    this.document.set(doc);
    this.selectedId.set(null);
    this.changed();
    this.status.set("Project opened");
  }
  start(
    point: Point,
    modifiers: { shift?: boolean; alt?: boolean } = {},
    override?: ToolId,
  ) {
    const tool = override ?? this.tool();
    if (tool === "hand") return;
    const before = structuredClone(this.document());
    if (tool !== "pen" && !override) this.penId.set(null);
    if (tool === "mirror") {
      this.reflect(modifiers.alt ? "vertical" : "horizontal");
      return;
    }
    if (tool === "scale") {
      const active = this.selectionLayer();
      if (active)
        this.gesture = {
          before,
          start: point,
          last: point,
          id: active.id,
          points: [],
          original: structuredClone(active),
          mode: "scale",
          ids: this.selectedLayers().map((l) => l.id),
        };
      return;
    }
    if (tool === "zoom") return;
    if (tool === "pen") {
      this.startPen(point, before);
      return;
    }
    if (
      [
        "direct",
        "addAnchor",
        "deleteAnchor",
        "convertAnchor",
        "scissors",
        "smooth",
        "pathEraser",
      ].includes(tool)
    ) {
      this.startPathEdit(point, before, modifiers);
      return;
    }
    if (tool === "spray" || tool.startsWith("symbol")) {
      this.startSymbol(point, before);
      return;
    }
    if (tool === "path") {
      const active = this.selected();
      if (active?.kind === "path" && !active.locked && active.visible) {
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
      const existing = pick(this.document().layers, point);
      if (existing?.kind === "text") {
        this.selectedId.set(existing.id);
        return;
      }
    }
    if (tool === "select" || tool === "rotate") {
      const active = this.selectionLayer();
      if (active && !active.locked && active.visible) {
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
            ids: this.selectedLayers().map((l) => l.id),
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
            ids: this.selectedLayers().map((l) => l.id),
          };
          return;
        }
      }
      const layer = pick(this.document().layers, point);
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
            ids: this.selectedLayers().map((l) => l.id),
          };
      } else if (!modifiers.shift) {
        this.selectedId.set(null);
        this.selectedIds.set([]);
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
        !active.locked &&
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
  move(point: Point, modifiers: { shift?: boolean; alt?: boolean } = {}) {
    const g = this.gesture;
    if (!g) return;
    if (g.mode === "rotate")
      this.transformSelection(g, {
        ...g.original,
        rotation: rotationFromDrag(
          g.original,
          g.start,
          point,
          modifiers.shift,
          this.snapAngle(),
        ),
      });
    else if (g.mode === "scale") {
      const factor = Math.max(
        0.05,
        Math.min(10, 1 + (point.x - g.start.x + point.y - g.start.y) / 200),
      );
      this.transformSelection(g, {
        ...g.original,
        width: g.original.width * factor,
        height: g.original.height * factor,
        x: g.original.x + (g.original.width * (1 - factor)) / 2,
        y: g.original.y + (g.original.height * (1 - factor)) / 2,
      });
    } else if (g.mode === "pen") {
      const curves = structuredClone(g.original.curves!),
        node = curves[0].nodes.at(-1)!,
        p = localPoint(g.original, point);
      node.outgoing = p;
      node.incoming = { x: node.point.x * 2 - p.x, y: node.point.y * 2 - p.y };
      node.smooth = true;
      this.setLayer(g.id, { curves });
    } else if (g.mode.startsWith("node:")) this.dragNode(point, modifiers.alt);
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
      this.transformSelection(g, {
        ...g.original,
        x: g.original.x + end.x - g.start.x,
        y: g.original.y + end.y - g.start.y,
      });
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
    if (!g || !painting) return;
    const ctx = painting.canvas.getContext("2d")!,
      a = localPoint(g.original, g.last),
      b = localPoint(g.original, point);
    ctx.save();
    ctx.scale(
      painting.canvas.width / g.original.width,
      painting.canvas.height / g.original.height,
    );
    ctx.globalCompositeOperation =
      g.mode === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = this.fill();
    ctx.fillStyle = this.fill();
    ctx.lineWidth = this.size();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, this.size() / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.revision.update((v) => v + 1);
  }
  end() {
    const g = this.gesture;
    if (!g) return;
    const layer = this.document().layers.find((l) => l.id === g.id);
    if (layer?.curves && (g.mode === "pen" || g.mode.startsWith("node:")))
      this.setLayer(g.id, fitCurves(layer, layer.curves));
    if (this.painting)
      this.setLayer(g.id, {
        source: this.painting.canvas.toDataURL("image/png"),
      });
    this.history.commit(g.before);
    this.gesture = undefined;
    this.painting = undefined;
    this.changed();
  }
  cancel() {
    if (this.gesture) this.document.set(this.gesture.before);
    this.gesture = undefined;
    this.painting = undefined;
    this.revision.update((x) => x + 1);
  }

  reflect(axis: "horizontal" | "vertical") {
    const layers = this.selectedLayers().filter((l) => !l.locked);
    if (!layers.length) return;
    const bounds = selectionBounds(layers),
      ids = new Set(layers.map((l) => l.id));
    this.history.commit(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) =>
        ids.has(l.id)
          ? {
              ...l,
              rotation: -l.rotation,
              ...(l.skewX !== undefined ? { skewX: -l.skewX } : {}),
              ...(axis === "horizontal"
                ? {
                    x: 2 * bounds.x + bounds.width - l.x - l.width,
                    flipX: !l.flipX,
                  }
                : {
                    y: 2 * bounds.y + bounds.height - l.y - l.height,
                    flipY: !l.flipY,
                  }),
            }
          : l,
      ),
    }));
    this.changed();
  }
  transformBy(rotation = 0, scale = 1) {
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
        ids: this.selectedLayers().map((l) => l.id),
      };
    this.history.commit(before);
    this.transformSelection(g, {
      ...source,
      width: source.width * scale,
      height: source.height * scale,
      x: source.x + (source.width * (1 - scale)) / 2,
      y: source.y + (source.height * (1 - scale)) / 2,
      rotation: source.rotation + rotation,
    });
    this.changed();
  }
  selectLayer(id: string, add = false) {
    const layer = this.document().layers.find((l) => l.id === id);
    if (!layer || layer.locked || !layer.visible) return;
    const root = layer.groupPath?.[0],
      members = this.document()
        .layers.filter(
          (l) =>
            (root ? l.groupPath?.[0] === root : l.id === id) &&
            l.visible &&
            !l.locked,
        )
        .map((l) => l.id);
    let ids = members;
    if (add) {
      const existing = this.selectedLayers().map((l) => l.id);
      ids = members.every((id) => existing.includes(id))
        ? existing.filter((id) => !members.includes(id))
        : [...new Set([...existing, ...members])];
    }
    this.selectedIds.set(ids);
    this.selectedId.set(ids.at(-1) ?? null);
  }
  selectAll() {
    const ids = this.document()
      .layers.filter((l) => l.visible && !l.locked)
      .map((l) => l.id);
    this.selectedIds.set(ids);
    this.selectedId.set(ids.at(-1) ?? null);
  }
  group(ungroup = false) {
    const layers = this.selectedLayers().filter((l) => !l.locked);
    if (!layers.length || (!ungroup && layers.length < 2)) return;
    if (!ungroup && layers.some((l) => (l.groupPath?.length ?? 0) >= 16))
      return;
    this.history.commit(this.document());
    const ids = new Set(layers.map((l) => l.id)),
      group = crypto.randomUUID();
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) =>
        ids.has(l.id)
          ? {
              ...l,
              groupPath: ungroup
                ? (l.groupPath ?? []).slice(1)
                : [group, ...(l.groupPath ?? [])],
            }
          : l,
      ),
    }));
    this.changed();
  }
  arrange(mode: Parameters<typeof alignLayers>[1], artboard = false) {
    const layers = this.selectedLayers().filter((l) => !l.locked);
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
      map = new Map(changed.map((l) => [l.id, l]));
    this.history.commit(this.document());
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => map.get(l.id) ?? l),
    }));
    this.changed();
  }
  boolean(operation: Parameters<typeof booleanLayers>[1]) {
    const layers = this.selectedLayers().filter((l) => !l.locked);
    if (layers.length < 2) return;
    try {
      const result = booleanLayers(layers, operation, crypto.randomUUID()),
        ids = new Set(layers.map((l) => l.id)),
        index = this.document().layers.findIndex((l) => l.id === layers[0].id);
      this.history.commit(this.document());
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
    if (!g.ids || g.ids.length === 1) {
      const resized = resizeLayer(g.original, target.width, target.height);
      this.setLayer(g.ids?.[0] ?? g.id, {
        ...target,
        points: resized.points,
        ...(resized.curves ? { curves: resized.curves } : {}),
      });
      return;
    }
    const updates = new Map(
      transformLayers(
        g.before.layers.filter(
          (layer) => g.ids!.includes(layer.id) && !layer.locked,
        ),
        g.original,
        target,
        target.rotation - g.original.rotation,
      ).map((layer) => [layer.id, layer]),
    );
    this.document.update((d) => ({
      ...d,
      layers: d.layers.map((l) => updates.get(l.id) ?? l),
    }));
  }

  setTool(tool: ToolId) {
    if (tool !== this.tool()) this.finishPath();
    this.activeNodes.set([]);
    this.tool.set(tool);
  }
  finishPath() {
    this.end();
    this.penId.set(null);
  }
  private startPen(point: Point, before: StudioDocument) {
    let layer = this.document().layers.find(
      (l) => l.id === this.penId() && !l.locked && l.visible,
    );
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
      this.history.commit(before);
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
  private startPathEdit(
    point: Point,
    before: StudioDocument,
    modifiers: { shift?: boolean; alt?: boolean },
  ) {
    let layer = this.selected();
    let hit:
      | { path: number; index: number; part: "point" | "incoming" | "outgoing" }
      | undefined;
    const find = (candidate: Layer) => {
      const p = localPoint(candidate, point);
      candidate.curves?.forEach((path, pi) =>
        path.nodes.forEach((node, index) => {
          for (const part of ["incoming", "outgoing", "point"] as const)
            if (
              Math.hypot(node[part].x - p.x, node[part].y - p.y) <
              9 / this.zoom()
            )
              hit = { path: pi, index, part };
        }),
      );
    };
    if (layer && !layer.locked && layer.visible) {
      if (
        !layer.curves &&
        ["path", "rectangle", "ellipse"].includes(layer.kind)
      )
        layer = { ...layer, kind: "path", curves: this.editableCurves(layer) };
      find(layer);
    }
    if (!hit) {
      layer = pick(this.document().layers, point) ?? null;
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
        find(layer);
      }
    }
    if (
      !layer ||
      layer.locked ||
      !layer.visible ||
      ["image", "text"].includes(layer.kind)
    ) {
      this.selectedId.set(null);
      return;
    }
    this.selectedIds.set([layer.id]);
    this.selectedId.set(layer.id);
    const curves = this.editableCurves(layer),
      p = localPoint(layer, point),
      tool = this.tool();
    if (tool === "smooth") {
      this.history.commit(before);
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
    if (tool === "addAnchor" || tool === "scissors") {
      const near = nearestSegment(curves, p);
      if (!near || near.distance > 12 / this.zoom()) return;
      curves[near.path] = splitSegment(curves[near.path], near.segment, near.t);
      if (tool === "scissors") {
        const c = curves[near.path],
          at = near.segment + 1;
        if (c.closed) {
          c.nodes = [...c.nodes.slice(at), ...c.nodes.slice(0, at + 1)];
          c.closed = false;
        } else {
          curves.splice(
            near.path,
            1,
            { nodes: c.nodes.slice(0, at + 1), closed: false },
            { nodes: c.nodes.slice(at), closed: false },
          );
        }
      }
      this.history.commit(before);
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
      this.history.commit(before);
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
      this.history.commit(before);
      this.setLayer(layer.id, { curves });
      this.changed();
      return;
    }
    if (modifiers.shift) {
      this.activeNodes.update((keys) =>
        keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
      );
    } else if (!this.activeNodes().includes(key)) this.activeNodes.set([key]);
    this.gesture = {
      before,
      start: point,
      last: point,
      id: layer.id,
      points: [],
      original: structuredClone(layer),
      mode: "node:" + hit.path + ":" + hit.index + ":" + hit.part,
    };
  }
  private dragNode(point: Point, independent = false) {
    const g = this.gesture!;
    const [, pi, ni, part] = g.mode.split(":"),
      curves = structuredClone(g.original.curves!),
      node = curves[+pi].nodes[+ni],
      p = localPoint(g.original, point);
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
          length = Math.hypot(
            node[other].x - node.point.x,
            node[other].y - node.point.y,
          ),
          dx = p.x - node.point.x,
          dy = p.y - node.point.y,
          mag = Math.hypot(dx, dy) || 1;
        node[other] = {
          x: node.point.x - (dx / mag) * length,
          y: node.point.y - (dy / mag) * length,
        };
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
    if (!layer || layer.locked || ["image", "text"].includes(layer.kind))
      return;
    let curves = this.editableCurves(layer);
    if (action === "extend") {
      this.setLayer(layer.id, { kind: "path", curves });
      this.penId.set(layer.id);
      this.tool.set("pen");
      return;
    }
    this.history.commit(this.document());
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
  nudge(dx: number, dy: number) {
    const layer = this.selected();
    if (!layer || layer.locked) return;
    this.history.commit(this.document());
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
          .filter((l) => !l.locked)
          .map((l) => l.id),
      );
      this.document.update((d) => ({
        ...d,
        layers: d.layers.map((l) =>
          ids.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l,
        ),
      }));
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
    if (!layer || layer.locked) return;
    const symbols = this.document().symbols ?? [];
    if (symbols.length >= 100) return;
    this.history.commit(this.document());
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
    this.history.commit(this.document());
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
    if (!layer || layer.locked) return;
    const symbol = this.document().symbols?.find((s) => s.id === id);
    if (!symbol && action !== "expand") return;
    this.history.commit(this.document());
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
      "symbols.ximply",
    );
  }
  importSymbols(text: string) {
    const imported = parseDocument(text).symbols ?? [],
      current = this.document().symbols ?? [];
    if (current.length + imported.length > 100)
      throw new Error("Symbol library limit exceeded");
    this.history.commit(this.document());
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
          !l.locked &&
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
    this.history.commit(current);
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
    this.history.commit(this.document());
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
    this.history.commit(this.document());
    this.document.update((d) => ({ ...d, layers: [...d.layers, layer] }));
    this.selectedId.set(layer.id);
    this.tool.set("select");
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
      this.document().name + ".ximply",
    );
    this.status.set("Project file saved");
  }
  exportSvg() {
    this.download(
      new Blob([svgExport(this.document())], { type: "image/svg+xml" }),
      this.document().name + ".svg",
    );
    this.status.set("SVG exported; raster layers remain embedded images");
  }
  async exportPng() {
    const canvas = await this.renderer.export(this.document());
    canvas.toBlob((blob) => {
      if (blob) this.download(blob, this.document().name + ".png");
    }, "image/png");
  }
}
