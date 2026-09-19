import { selectionBounds } from "../../domain/src/arrange";
import { newLayer } from "../../domain/src/document";
import { CurvePath } from "../../domain/src/curves";
import { Layer, StudioDocument } from "../../domain/src/document";
export class CanvasRenderer {
  private images = new Map<string, HTMLImageElement>();
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
    if (!transparent) {
      ctx.fillStyle = document.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    for (const layer of document.layers)
      if (layer.visible)
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
        !l.locked,
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
      if (interaction.direct && layer.curves)
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
  private layer(
    ctx: CanvasRenderingContext2D,
    l: Layer,
    ready: () => void,
    painting?: HTMLCanvasElement,
  ) {
    ctx.save();
    this.transform(ctx, l);
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    ctx.fillStyle = l.fill;
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (l.kind === "rectangle") {
      ctx.fillRect(0, 0, l.width, l.height);
      if (l.strokeWidth) ctx.strokeRect(0, 0, l.width, l.height);
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
      ctx.fill();
      if (l.strokeWidth) ctx.stroke();
    }
    if (l.curves) {
      ctx.beginPath();
      for (const path of l.curves.filter((p) => p.closed))
        this.curve(ctx, path);
      ctx.fill("evenodd");
      ctx.beginPath();
      for (const path of l.curves) this.curve(ctx, path);
      if (l.strokeWidth > 0) ctx.stroke();
    } else if (l.kind === "path" && l.points.length && l.strokeWidth > 0) {
      ctx.beginPath();
      ctx.moveTo(l.points[0].x, l.points[0].y);
      for (const p of l.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    if (l.kind === "text") {
      ctx.font = `${l.fontSize}px sans-serif`;
      ctx.textBaseline = "top";
      l.text
        .split("\n")
        .forEach((line, index) =>
          ctx.fillText(line, 0, index * l.fontSize * 1.2),
        );
    }
    if (l.kind === "image") {
      const image = painting ?? this.image(l.source, ready);
      ctx.filter = `brightness(${l.adjustments.brightness}%) contrast(${l.adjustments.contrast}%) saturate(${l.adjustments.saturation}%) blur(${l.adjustments.blur}px)`;
      if (image) ctx.drawImage(image, 0, 0, l.width, l.height);
    }
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
