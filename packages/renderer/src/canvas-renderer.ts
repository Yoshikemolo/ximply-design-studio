import { materializeProcedural, projectionCurves, projectionDash } from "../../domain/src/procedural";
import { dimensionGeometry, dimensionLabelLayout } from "../../domain/src/dimensions";
import { lineEndGeometry, pathLineEnds, LineEnd } from "../../domain/src/line-endings";
import { Point } from "../../domain/src/document";
import { defaultTypography, layoutText, textFont, TextMeasurement, TextTypography } from "../../domain/src/text-layout";
import { selectionBounds } from "../../domain/src/arrange";
import { newLayer, defaultStrokeStyle, strokeBounds } from "../../domain/src/document";
import { CurvePath } from "../../domain/src/curves";
import { Layer, StudioDocument } from "../../domain/src/document";
export class CanvasRenderer {
  private images = new Map<string, HTMLImageElement>();
  private measureContext?: CanvasRenderingContext2D;
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
      handleSize?: number;
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
    for (const layer of materializeProcedural(document).layers)
      if (layer.visible && !layer.guide)
        this.layer(
          ctx,
          layer,
          ready,
          painting?.id === layer.id ? painting.canvas : undefined,
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
    if (layer) {
      const zoom = Math.max(0.1, interaction.zoom),
        unit = 1 / zoom,
        size = (interaction.handleSize ?? 4) * unit;
      ctx.save();
      this.transform(ctx, layer);
      ctx.strokeStyle = "#0d59f2";
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1.5 * unit;
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
      if (interaction.direct && layer.curves && !layer.procedural && !layer.dimension)
        for (const path of layer.curves)
          for (const node of path.nodes) {
            if (interaction.showHandles !== false)
              for (const handle of [node.incoming, node.outgoing]) {
                ctx.beginPath();
                ctx.moveTo(node.point.x, node.point.y);
                ctx.lineTo(handle.x, handle.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(handle.x, handle.y, 3 * unit, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              }
            ctx.fillStyle = "#0d59f2";
            ctx.fillRect(
              node.point.x - size,
              node.point.y - size,
              size * 2,
              size * 2,
            );
            ctx.fillStyle = "#ffffff";
          }
      ctx.restore();
    }
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
  private layer(
    ctx: CanvasRenderingContext2D,
    l: Layer,
    ready: () => void,
    painting?: HTMLCanvasElement,
  ) {
    if (l.dimension) { this.dimension(ctx, l); return; }
    ctx.save();
    this.transform(ctx, l);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    const hasFill = l.fill !== "none";
    const hasStroke = l.stroke !== "none" && l.strokeWidth > 0;
    if (hasFill) ctx.fillStyle = l.fill;
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
      for (const path of drawn.filter((p) => p.closed))
        this.curve(ctx, path);
      if (hasFill) ctx.fill("evenodd");
      if (hasStroke) {
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
    for (const end of pathLineEnds(l)) this.ending(ctx, end.point, end.direction, end.style, l.stroke, l.strokeWidth);
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
        ctx.fillStyle = hasFill ? l.fill : l.stroke;
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
