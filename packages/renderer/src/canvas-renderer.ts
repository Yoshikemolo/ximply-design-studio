import { materializeProcedural, projectionCurves, projectionDash } from "../../domain/src/procedural";
import { dimensionGeometry, dimensionLabelLayout } from "../../domain/src/dimensions";
import { lineEndGeometry, pathLineEnds, LineEnd } from "../../domain/src/line-endings";
import { brushOutline } from "../../domain/src/brush-stroke";
import { Point } from "../../domain/src/document";
import { defaultTypography, layoutText, textFont, TextMeasurement, TextTypography } from "../../domain/src/text-layout";
import { selectionBounds } from "../../domain/src/arrange";
import { newLayer, defaultStrokeStyle, strokeBounds } from "../../domain/src/document";
import { worldPoint } from "../../domain/src/curves";
import { CurvePath } from "../../domain/src/curves";
import { Layer, StudioDocument } from "../../domain/src/document";
import { gradientGeometry, PatternDefinition, renderedStops } from "../../domain/src/paint";
import { materializeEnvelopes } from "../../domain/src/envelope";
import { meshFacets } from "../../domain/src/gradient-mesh";
/** Makes the off-screen canvas a pattern tile is drawn on. */
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;
const browserCanvas: CanvasFactory = (width, height) => {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export class CanvasRenderer {
  constructor(private readonly createCanvas: CanvasFactory = browserCanvas) {}
  private images = new Map<string, HTMLImageElement>();
  private measureContext?: CanvasRenderingContext2D;
  /** The patterns of the document being drawn, and their tiles drawn once each. */
  private patterns = new Map<string, PatternDefinition>();
  private tiles = new Map<PatternDefinition, HTMLCanvasElement>();
  /** The transform of the page, so a pattern lines up with the document origin. */
  private pageTransform?: DOMMatrix;
  readonly measureText: TextMeasurement = (text, size, typography = { ...defaultTypography }) => {
    this.measureContext ??= window.document.createElement("canvas").getContext("2d")!;
    this.measureContext.font = textFont(size, typography);
    return this.measureContext.measureText(text).width;
  };
  image(source: string, ready: () => void): HTMLImageElement | undefined {
    if (!source) return undefined;
    const cached = this.images.get(source);
    if (cached)
      return cached.complete && cached.naturalWidth > 0 ? cached : undefined;
    const image = new Image();
    image.onload = ready;
    image.onerror = () => this.images.delete(source);
    image.src = source;
    this.images.set(source, image);
    return undefined;
  }
  prune(layers: Layer[]) {
    const active = new Set(
      layers.filter((l) => l.kind === "image").map((l) => l.source),
    );
    for (const key of this.images.keys())
      if (!active.has(key)) this.images.delete(key);
  }
  draw(
    canvas: HTMLCanvasElement,
    document: StudioDocument,
    selection: string | string[] | null,
    ready: () => void,
    painting?: { id: string; canvas: HTMLCanvasElement },
    transparent = false,
    interaction: {
      zoom: number;
      direct: boolean;
      showHandles?: boolean;
      /** The frame, the resizing handles and the rotation knob of the selection. */
      boundingBox?: boolean;
      /**
       * The box of the Free Transform tool, corners clockwise from the top left in page
       * coordinates; it replaces the bounding box and follows a distortion.
       */
      quad?: Point[];
      /** The mesh node chosen on the selected envelope, whose handles are drawn. */
      meshNode?: number;
      /** Outline view: the artwork is drawn as hairline contours without its paints. */
      outline?: boolean;
      /** Ink of the outline view, which the shell picks from the theme. */
      outlineInk?: string;
      handleSize?: number;
      /**
       * How the anchors of the selected path are shown, as Illustrator's Selection and
       * Anchor Display preferences set it: which are chosen (drawn solid), which handles
       * show, which anchor is under the pointer, the sizes and the handle style.
       */
      anchors?: {
        selected: string[];
        handles: string[];
        hover: string | null;
        size: "small" | "mixed" | "large";
        handleStyle: "small" | "large" | "cross";
        /** Focal points of the Reshape tool, drawn with a square around them. */
        focal?: string[];
        /** Anchors chosen on the other selected objects, drawn on each of them. */
        others?: Record<string, { selected: string[]; handles: string[] }>;
      };
    } = { zoom: 1, direct: false },
  ) {
    if (canvas.width !== document.width) canvas.width = document.width;
    if (canvas.height !== document.height) canvas.height = document.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!transparent && document.background !== "none") {
      ctx.fillStyle = document.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const hairline = 1 / Math.max(0.1, interaction.zoom || 1);
    this.usePatterns(document, ctx);
    for (const layer of materializeEnvelopes(materializeProcedural(document)).layers)
      if (layer.visible && !layer.guide)
        this.layer(
          ctx,
          interaction.outline ? this.asOutline(layer, hairline, interaction.outlineInk ?? "#20262f") : layer,
          ready,
          interaction.outline ? undefined : painting?.id === layer.id ? painting.canvas : undefined,
        );
    const selected = document.layers.filter(
      (l) =>
        (Array.isArray(selection)
          ? selection.includes(l.id)
          : l.id === selection) &&
        l.visible &&
        !l.locked &&
        !l.guide,
    );
    const layer =
      selected.length > 1
        ? {
            ...newLayer("rectangle", "__selection__", { x: 0, y: 0 }),
            ...selectionBounds(selected),
          }
        : selected[0];
    if (selected.length === 1 && (selected[0].envelope?.editing === "envelope" || selected[0].gradientMesh)) this.mesh(ctx, selected[0], interaction.zoom, interaction.meshNode);
    if (layer && interaction.quad?.length === 4) {
      const unit = 1 / Math.max(0.1, interaction.zoom), size = (interaction.handleSize ?? 4) * unit, q = interaction.quad;
      ctx.save();
      ctx.strokeStyle = "#0d59f2";
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1.5 * unit;
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      const handles = [...q, ...q.map((p, i) => ({ x: (p.x + q[(i + 1) % 4].x) / 2, y: (p.y + q[(i + 1) % 4].y) / 2 }))];
      for (const p of handles) { ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2); ctx.strokeRect(p.x - size, p.y - size, size * 2, size * 2); }
      ctx.restore();
    }
    if (layer) {
      const zoom = Math.max(0.1, interaction.zoom),
        unit = 1 / zoom,
        size = (interaction.handleSize ?? 4) * unit;
      ctx.save();
      this.transform(ctx, layer);
      ctx.strokeStyle = "#0d59f2";
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1.5 * unit;
      // The bounding box can be hidden to see the artwork without its frame and handles.
      if (interaction.boundingBox !== false && !interaction.quad) {
        ctx.setLineDash([5 * unit, 3 * unit]);
        ctx.strokeRect(
          -3 * unit,
          -3 * unit,
          layer.width + 6 * unit,
          layer.height + 6 * unit,
        );
        ctx.setLineDash([]);
        for (const [x, y] of [
          [0, 0],
          [layer.width, 0],
          [0, layer.height],
          [layer.width, layer.height],
          [layer.width / 2, 0],
          [layer.width / 2, layer.height],
          [0, layer.height / 2],
          [layer.width, layer.height / 2],
        ]) {
          ctx.fillRect(x - size, y - size, size * 2, size * 2);
          ctx.strokeRect(x - size, y - size, size * 2, size * 2);
        }
        ctx.beginPath();
        ctx.moveTo(layer.width / 2, 0);
        ctx.lineTo(layer.width / 2, -28 * unit);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(layer.width / 2, -28 * unit, 6 * unit, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (interaction.direct && layer.curves && !layer.procedural && !layer.dimension)
        this.anchors(ctx, layer, interaction.anchors, interaction.showHandles !== false, unit, size);
      ctx.restore();
    }
    const others = interaction.direct ? interaction.anchors?.others ?? {} : {};
    for (const other of selected) {
      const info = others[other.id];
      if (!info || !other.curves || other.id === layer?.id) continue;
      const unit = 1 / Math.max(0.1, interaction.zoom), size = (interaction.handleSize ?? 4) * unit;
      ctx.save();
      this.transform(ctx, other);
      this.anchors(ctx, other, { ...interaction.anchors!, selected: info.selected, handles: info.handles, hover: null }, true, unit, size);
      ctx.restore();
    }
  }
  /** Anchors and handles of one path, solid where chosen and hollow elsewhere. */
  private anchors(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    display: NonNullable<Parameters<CanvasRenderer["draw"]>[6]>["anchors"],
    showHandles: boolean,
    unit: number,
    size: number,
  ) {
    const chosen = new Set(display?.selected ?? []);
    // Without anchors chosen the whole path is selected, and all its anchors show solid.
    const whole = !display || chosen.size === 0;
    const handles = display ? new Set(display.handles) : null;
    const large = size * 1.5;
    const anchorSize = (on: boolean) => (display?.size === "large" || (display?.size === "mixed" && on) ? large : size);
    const handleRadius = (display?.handleStyle === "large" ? 4.5 : 3) * unit;
    layer.curves!.forEach((path, pi) =>
      path.nodes.forEach((node, ni) => {
        for (const part of ["incoming", "outgoing"] as const) {
          const handle = node[part];
          const shown = handles ? handles.has(`${pi}:${ni}:${part}`) : showHandles;
          if (!shown || (handle.x === node.point.x && handle.y === node.point.y)) continue;
          ctx.strokeStyle = "#0d59f2";
          ctx.lineWidth = 1.2 * unit;
          ctx.beginPath();
          ctx.moveTo(node.point.x, node.point.y);
          ctx.lineTo(handle.x, handle.y);
          ctx.stroke();
          if (display?.handleStyle === "cross") {
            const arm = 3.5 * unit;
            ctx.beginPath();
            ctx.moveTo(handle.x - arm, handle.y);
            ctx.lineTo(handle.x + arm, handle.y);
            ctx.moveTo(handle.x, handle.y - arm);
            ctx.lineTo(handle.x, handle.y + arm);
            ctx.stroke();
          } else {
            ctx.fillStyle = "#0d59f2";
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }),
    );
    layer.curves!.forEach((path, pi) =>
      path.nodes.forEach((node, ni) => {
        const key = `${pi}:${ni}`;
        const on = whole || chosen.has(key);
        const half = anchorSize(on);
        ctx.lineWidth = 1.2 * unit;
        ctx.strokeStyle = "#0d59f2";
        ctx.fillStyle = on ? "#0d59f2" : "#ffffff";
        ctx.fillRect(node.point.x - half, node.point.y - half, half * 2, half * 2);
        ctx.strokeRect(node.point.x - half, node.point.y - half, half * 2, half * 2);
        if (display?.hover === key || display?.focal?.includes(key)) {
          // The anchor under the pointer is ringed so it can be told from its neighbours.
          const ring = half + 2.5 * unit;
          ctx.lineWidth = 1.5 * unit;
          ctx.strokeRect(node.point.x - ring, node.point.y - ring, ring * 2, ring * 2);
        }
      }),
    );
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.5 * unit;
  }
  private curve(ctx: CanvasRenderingContext2D, path: CurvePath) {
    if (!path.nodes.length) return;
    ctx.moveTo(path.nodes[0].point.x, path.nodes[0].point.y);
    const count = path.closed ? path.nodes.length : path.nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = path.nodes[i],
        b = path.nodes[(i + 1) % path.nodes.length];
      ctx.bezierCurveTo(
        a.outgoing.x,
        a.outgoing.y,
        b.incoming.x,
        b.incoming.y,
        b.point.x,
        b.point.y,
      );
    }
    if (path.closed) ctx.closePath();
  }

  private transform(ctx: CanvasRenderingContext2D, l: Layer) {
    ctx.translate(l.x + l.width / 2, l.y + l.height / 2);
    ctx.rotate((l.rotation * Math.PI) / 180);
    if (l.skewX)
      ctx.transform(1, 0, Math.tan((l.skewX * Math.PI) / 180), 1, 0, 0);
    ctx.translate(-l.width / 2, -l.height / 2);
    if (l.flipX || l.flipY) {
      ctx.translate(l.flipX ? l.width : 0, l.flipY ? l.height : 0);
      ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
    }
  }
  private closedStroke(ctx: CanvasRenderingContext2D, layer: Layer, path: () => void) {
    const alignment = layer.strokeStyle?.alignment ?? "center";
    ctx.save();
    if (alignment !== "center") {
      ctx.beginPath();
      if (alignment === "outside") {
        const bounds = strokeBounds(layer);
        ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      }
      path();
      ctx.clip("evenodd");
      ctx.lineWidth = layer.strokeWidth * 2;
    }
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.restore();
  }
  /**
   * The outline view of a layer: its contours in one ink and no paint at all. An image has
   * no contour of its own, so its frame stands for it, and a dimension keeps its drawing,
   * since it is an annotation rather than artwork.
   */
  private asOutline(layer: Layer, hairline: number, ink: string): Layer {
    if (layer.dimension) return layer;
    const outlined: Layer = {
      ...layer,
      fill: "none",
      stroke: ink,
      strokeWidth: hairline,
      strokeStyle: { cap: "butt", join: "miter", alignment: "center", dash: [] },
      opacity: 1,
      blend: "source-over",
    };
    if (layer.kind === "image") return { ...outlined, kind: "rectangle", source: "", curves: undefined };
    if (layer.kind === "text") return { ...layer, fill: ink, stroke: "none", opacity: 1, blend: "source-over" };
    return outlined;
  }
  /** A gradient mesh, as facets in the colour at their middle, each also stroked so no seam shows between them. */
  private gradientMesh(ctx: CanvasRenderingContext2D, layer: Layer) {
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    // A pixel-wide stroke of each facet's own colour covers the seams its neighbours leave.
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    for (const facet of meshFacets(layer)) {
      ctx.beginPath();
      facet.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = facet.color;
      ctx.strokeStyle = facet.color;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
  /** The mesh of a selected envelope: its edges, its nodes, and the handles of the chosen node. */
  private mesh(ctx: CanvasRenderingContext2D, layer: Layer, zoom: number, chosen?: number) {
    const mesh = (layer.envelope ?? layer.gradientMesh)!.mesh, unit = 1 / Math.max(0.1, zoom), w = (p: Point) => worldPoint(layer, p);
    const at = (i: number, j: number) => mesh.nodes[i * (mesh.columns + 1) + j];
    ctx.save();
    ctx.strokeStyle = "#0d59f2";
    ctx.lineWidth = unit;
    ctx.beginPath();
    for (let i = 0; i <= mesh.rows; i++)
      for (let j = 0; j <= mesh.columns; j++) {
        const n = at(i, j), p = w(n.point);
        if (j < mesh.columns) { const m = at(i, j + 1), a = w(n.right), b = w(m.left), q = w(m.point); ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(a.x, a.y, b.x, b.y, q.x, q.y); }
        if (i < mesh.rows) { const m = at(i + 1, j), a = w(n.down), b = w(m.up), q = w(m.point); ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(a.x, a.y, b.x, b.y, q.x, q.y); }
      }
    ctx.stroke();
    const size = 3 * unit;
    mesh.nodes.forEach((n, index) => {
      const p = w(n.point);
      ctx.fillStyle = index === chosen ? "#0d59f2" : "#ffffff";
      ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
      ctx.strokeRect(p.x - size, p.y - size, size * 2, size * 2);
      if (index !== chosen) return;
      for (const part of [n.left, n.right, n.up, n.down]) {
        if (part.x === n.point.x && part.y === n.point.y) continue;
        const h = w(part);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x, h.y, size, 0, Math.PI * 2); ctx.fillStyle = "#0d59f2"; ctx.fill();
      }
    });
    ctx.restore();
  }
  private usePatterns(document: StudioDocument, ctx: CanvasRenderingContext2D) {
    const patterns = document.patterns ?? [];
    this.patterns = new Map(patterns.map((pattern) => [pattern.id, pattern]));
    for (const pattern of this.tiles.keys()) if (!patterns.includes(pattern)) this.tiles.delete(pattern);
    this.pageTransform = typeof ctx.getTransform === "function" ? ctx.getTransform() : undefined;
  }
  /** The tile of a pattern, drawn from its own artwork on a canvas of its size. */
  private tile(pattern: PatternDefinition): HTMLCanvasElement {
    let tile = this.tiles.get(pattern);
    if (tile) return tile;
    tile = this.createCanvas(Math.max(1, Math.round(pattern.width)), Math.max(1, Math.round(pattern.height)));
    const ctx = tile.getContext("2d");
    if (ctx) for (const layer of pattern.layers) if (layer.visible) this.layer(ctx, layer, () => undefined);
    this.tiles.set(pattern, tile);
    return tile;
  }
  /**
   * The fill of an object: its colour, or the gradient or pattern it holds. A gradient runs
   * in the object's own box and turns with it; a pattern tiles from the document origin,
   * as Illustrator lays patterns out from the ruler origin.
   */
  private fillStyle(ctx: CanvasRenderingContext2D, l: Layer): string | CanvasGradient | CanvasPattern {
    const paint = l.fillPaint;
    if (!paint) return l.fill;
    if (paint.kind === "gradient") {
      const g = gradientGeometry(paint, l.width, l.height);
      const gradient = paint.type === "radial"
        ? ctx.createRadialGradient(g.start.x, g.start.y, 0, g.start.x, g.start.y, g.radius)
        : ctx.createLinearGradient(g.start.x, g.start.y, g.end.x, g.end.y);
      if (!gradient) return l.fill;
      for (const stop of renderedStops(paint)) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
      return gradient;
    }
    const pattern = this.patterns.get(paint.patternId);
    if (!pattern) return l.fill;
    const fill = ctx.createPattern(this.tile(pattern), "repeat");
    if (!fill) return l.fill;
    if (this.pageTransform && typeof fill.setTransform === "function" && typeof ctx.getTransform === "function")
      fill.setTransform(ctx.getTransform().inverse().multiply(this.pageTransform));
    return fill;
  }
  private layer(
    ctx: CanvasRenderingContext2D,
    l: Layer,
    ready: () => void,
    painting?: HTMLCanvasElement,
  ) {
    if (l.dimension) { this.dimension(ctx, l); return; }
    if (l.gradientMesh) { this.gradientMesh(ctx, l); return; }
    ctx.save();
    this.transform(ctx, l);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    const hasFill = l.fill !== "none";
    const hasStroke = l.stroke !== "none" && l.strokeWidth > 0;
    const fill = hasFill ? this.fillStyle(ctx, l) : l.fill;
    if (hasFill) ctx.fillStyle = fill;
    if (hasStroke) ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    const strokeStyle = l.strokeStyle ?? defaultStrokeStyle;
    ctx.lineCap = strokeStyle.cap;
    ctx.lineJoin = strokeStyle.join;
    ctx.setLineDash(strokeStyle.dash?.length ? strokeStyle.dash : []);
    ctx.miterLimit = 10;
    if (l.kind === "rectangle") {
      if (hasFill) ctx.fillRect(0, 0, l.width, l.height);
      if (hasStroke) this.closedStroke(ctx, l, () => ctx.rect(0, 0, l.width, l.height));
    }
    if (l.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        l.width / 2,
        l.height / 2,
        l.width / 2,
        l.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      if (hasFill) ctx.fill();
      if (hasStroke) this.closedStroke(ctx, l, () => { ctx.moveTo(l.width, l.height / 2); ctx.ellipse(l.width / 2, l.height / 2, l.width / 2, l.height / 2, 0, 0, Math.PI * 2); });
    }
    if (l.curves) {
      const projection = projectionCurves(l);
      const drawn = l.curves.filter((_, index) => !projection[index]);
      ctx.beginPath();
      // A fill paints every contour, open ones included: filling closes a path, as it does
      // in the drawing tools this editor follows, while the stroke keeps the ends apart.
      for (const path of drawn) this.curve(ctx, path);
      if (hasFill) ctx.fill("evenodd");
      if (hasStroke && l.brushStroke) {
        // A brushed path paints the area its nib sweeps, in the colour of the stroke.
        ctx.fillStyle = l.stroke;
        ctx.beginPath();
        for (const path of drawn)
          for (const ring of brushOutline(path, l.brushStroke, l.strokeWidth)) {
            if (!ring.length) continue;
            ctx.moveTo(ring[0].x, ring[0].y);
            for (const point of ring.slice(1)) ctx.lineTo(point.x, point.y);
            ctx.closePath();
          }
        ctx.fill("nonzero");
      } else if (hasStroke) {
        if (strokeStyle.alignment === "center") {
          ctx.beginPath();
          for (const path of drawn) this.curve(ctx, path);
          ctx.stroke();
        } else {
          const closed = drawn.filter((path) => path.closed);
          if (closed.length) this.closedStroke(ctx, l, () => { for (const path of closed) this.curve(ctx, path); });
          ctx.beginPath();
          for (const path of drawn.filter((path) => !path.closed)) this.curve(ctx, path);
          ctx.stroke();
        }
        if (projection.some(Boolean)) {
          ctx.save();
          ctx.setLineDash(projectionDash(l.strokeWidth));
          ctx.beginPath();
          for (const path of l.curves.filter((_, index) => projection[index])) this.curve(ctx, path);
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if (l.kind === "path" && l.points.length && hasStroke) {
      ctx.beginPath();
      ctx.moveTo(l.points[0].x, l.points[0].y);
      for (const p of l.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    if (!l.brushStroke) for (const end of pathLineEnds(l)) this.ending(ctx, end.point, end.direction, end.style, l.stroke, l.strokeWidth);
    if (l.kind === "text" && !l.textLayout && !l.typography) {
      ctx.font = `${l.fontSize}px sans-serif`;
      ctx.textBaseline = "top";
      l.text
        .split("\n")
        .forEach((line, index) => {
          const y = index * l.fontSize * 1.2;
          if (hasFill) ctx.fillText(line, 0, y);
          if (hasStroke) ctx.strokeText(line, 0, y);
        });
    }
    if (l.kind === "text" && (l.textLayout || l.typography)) {
      const layout = layoutText(l, (text, size, typography) => {
        ctx.font = textFont(size, typography);
        return ctx.measureText(text).width;
      });
      const type = layout.typography;
      ctx.save();
      if (l.textLayout) {
        ctx.beginPath();
        ctx.rect(0, 0, layout.width, layout.height);
        ctx.clip();
      }
      ctx.font = textFont(layout.fontSize, type);
      ctx.textBaseline = "alphabetic";
      ctx.save();
      ctx.scale(type.horizontalScale, type.verticalScale);
      for (const line of layout.lines)
        for (const glyph of line.glyphs) {
          const x = glyph.x / type.horizontalScale, y = line.y / type.verticalScale;
          if (hasFill) ctx.fillText(glyph.text, x, y);
          if (hasStroke) ctx.strokeText(glyph.text, x, y);
        }
      ctx.restore();
      if (type.decoration !== "none" && (hasFill || hasStroke)) {
        ctx.fillStyle = hasFill ? fill : l.stroke;
        for (const line of layout.lines) {
          const offset = type.decoration === "underline" ? layout.fontSize * 0.12 : -layout.fontSize * 0.3;
          ctx.fillRect(line.x, line.y + offset * type.verticalScale, line.width, Math.max(1, layout.fontSize / 16) * type.verticalScale);
        }
      }
      ctx.restore();
    }
    if (l.kind === "image") {
      const image = painting ?? this.image(l.source, ready);
      ctx.filter = `brightness(${l.adjustments.brightness}%) contrast(${l.adjustments.contrast}%) saturate(${l.adjustments.saturation}%) blur(${l.adjustments.blur}px)`;
      if (image) ctx.drawImage(image, 0, 0, l.width, l.height);
    }
    ctx.restore();
  }
  private ending(ctx: CanvasRenderingContext2D, point: Point, direction: Point, style: LineEnd, paint: string, width: number, spread?: number) {
    if (paint === "none" || width <= 0) return;
    const g = lineEndGeometry(point, direction, style, spread);
    ctx.save(); ctx.fillStyle = paint; ctx.strokeStyle = paint; ctx.lineWidth = width; ctx.lineJoin = "round";
    if (g.circle) { ctx.beginPath();ctx.arc(g.circle.center.x,g.circle.center.y,g.circle.radius,0,Math.PI*2);ctx.fill(); }
    for (const points of g.segments ?? [g.points]) { if (!points.length) continue;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);if(g.closed){ctx.closePath();ctx.fill();}ctx.stroke(); }
    ctx.restore();
  }
  private dimension(ctx: CanvasRenderingContext2D, layer: Layer) {
    const measure = (text: string, size: number, type: TextTypography) => { ctx.font = textFont(size, type); return ctx.measureText(text).width; };
    const d = dimensionGeometry(layer, measure), meta = layer.dimension!;
    ctx.save();ctx.globalAlpha=layer.opacity;ctx.globalCompositeOperation=layer.blend;
    ctx.lineCap=layer.strokeStyle?.cap??"butt";ctx.lineJoin=layer.strokeStyle?.join??"miter";
    for(const line of d.lines){ const paint=line.extension?meta.extension.stroke:layer.stroke,width=line.extension?meta.extension.strokeWidth:layer.strokeWidth;if(paint==="none"||width<=0)continue;ctx.strokeStyle=paint;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(line.a.x,line.a.y);ctx.lineTo(line.b.x,line.b.y);ctx.stroke(); }
    if(d.arc && layer.stroke!=="none" && layer.strokeWidth>0){const a=d.arc;ctx.strokeStyle=layer.stroke;ctx.lineWidth=layer.strokeWidth;ctx.beginPath();ctx.arc(a.center.x,a.center.y,a.radius,a.startAngle,a.endAngle,a.endAngle<a.startAngle);ctx.stroke();}
    for(const end of d.ends)this.ending(ctx,end.point,end.direction,end.style,layer.stroke,layer.strokeWidth,end.spread);
    const layout=dimensionLabelLayout(layer,d.text,measure),type=layout.typography;
    ctx.translate(d.labelPosition.x,d.labelPosition.y);ctx.rotate(d.labelAngle);ctx.translate(-layout.width/2,-layout.height/2);
    if(layer.textLayout){ctx.beginPath();ctx.rect(0,0,layout.width,layout.height);ctx.clip();}ctx.scale(type.horizontalScale,type.verticalScale);ctx.font=textFont(layout.fontSize,type);ctx.textBaseline="alphabetic";
    if(layer.fill!=="none"){ctx.fillStyle=layer.fill;for(const line of layout.lines)for(const glyph of line.glyphs)ctx.fillText(glyph.text,glyph.x/type.horizontalScale,line.y/type.verticalScale);}
    if(layer.fill!=="none" && type.decoration!=="none")for(const line of layout.lines)ctx.fillRect(line.x/type.horizontalScale,line.y/type.verticalScale+(type.decoration==="underline"?layout.fontSize*.12:-layout.fontSize*.3),line.width/type.horizontalScale,Math.max(1,layout.fontSize/16));
    ctx.restore();
  }
  async export(
    document: StudioDocument,
    transparent = false,
  ): Promise<HTMLCanvasElement> {
    await Promise.all(
      document.layers
        .filter((l) => l.kind === "image" && l.source)
        .map(async (l) => {
          let image = this.images.get(l.source);
          if (!image) {
            image = new Image();
            image.src = l.source;
            this.images.set(l.source, image);
          }
          await image.decode();
        }),
    );
    const canvas = window.document.createElement("canvas");
    this.draw(canvas, document, null, () => {}, undefined, transparent);
    return canvas;
  }
}
