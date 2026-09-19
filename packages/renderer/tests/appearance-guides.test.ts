import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { blankDocument, Layer, newLayer } from "../../domain/src/document";
import { CanvasRenderer } from "../src/canvas-renderer";

function render(layer: Layer, selection: string | null = null) {
  const canvas = createCanvas(100, 100);
  new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement, {
    ...blankDocument(), width: 100, height: 100, layers: [layer],
  }, selection, () => {}, undefined, true);
  return canvas.getContext("2d");
}

describe("absent paint pixel oracles", () => {
  it.each(["rectangle", "ellipse", "text", "path"] as const)("does not paint an unfilled and unstroked %s", (kind) => {
    const layer = { ...newLayer(kind, "a", { x: 10, y: 10 }, "none", "none", 8), width: 60, height: 60,
      points: [{ x: 0, y: 30 }, { x: 60, y: 30 }] };
    const pixels = render(layer).getImageData(0, 0, 100, 100).data;
    expect(pixels.every((value) => value === 0)).toBe(true);
  });

  it("leaves the rectangle interior transparent while painting its outline", () => {
    const layer = { ...newLayer("rectangle", "a", { x: 10, y: 10 }, "none", "#ff0000", 4), width: 60, height: 60 };
    const ctx = render(layer);
    expect([...ctx.getImageData(40, 40, 1, 1).data]).toEqual([0, 0, 0, 0]);
    expect([...ctx.getImageData(10, 40, 1, 1).data]).toEqual([255, 0, 0, 255]);
    const filled = render({ ...layer, fill: "#00ff00", stroke: "none" });
    expect([...filled.getImageData(40, 40, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(filled.getImageData(8, 40, 1, 1).data[3]).toBe(0);
  });

  it("keeps closed cubic interiors transparent while preserving their stroke", () => {
    const nodes = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }]
      .map((point) => ({ point, incoming: point, outgoing: point, smooth: false }));
    const layer = { ...newLayer("path", "curve", { x: 10, y: 10 }, "none", "#ff0000", 4),
      width: 60, height: 60, curves: [{ closed: true, nodes }] };
    const ctx = render(layer);
    expect(ctx.getImageData(40, 40, 1, 1).data[3]).toBe(0);
    expect([...ctx.getImageData(10, 40, 1, 1).data]).toEqual([255, 0, 0, 255]);
    const empty = render({ ...layer, stroke: "none" });
    expect(empty.getImageData(0, 0, 100, 100).data.every((value) => value === 0)).toBe(true);
  });

  it("renders fill and stroke alpha independently and combines layer opacity", () => {
    const layer = { ...newLayer("rectangle", "alpha", { x: 10, y: 10 }, "#ff000080", "#0000ff40", 4), width: 60, height: 60 };
    const ctx = render(layer);
    expect([...ctx.getImageData(40, 40, 1, 1).data]).toEqual([255, 0, 0, 128]);
    expect([...ctx.getImageData(8, 40, 1, 1).data]).toEqual([0, 0, 255, 64]);
    const faded = render({ ...layer, opacity: 0.5 });
    expect(faded.getImageData(40, 40, 1, 1).data[3]).toBe(64);
    expect(faded.getImageData(8, 40, 1, 1).data[3]).toBe(32);
  });

  it("renders text outlines without requiring a fill", () => {
    const layer = { ...newLayer("text", "a", { x: 10, y: 10 }, "none", "#ff0000", 2), text: "M", fontSize: 40 };
    const pixels = render(layer).getImageData(0, 0, 100, 100).data;
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(pixels.every((value, index) => index % 4 !== 1 && index % 4 !== 2 || value === 0)).toBe(true);
  });

  it("excludes guide artwork and selection decorations", () => {
    const layer = { ...newLayer("path", "guide", { x: 10, y: 10 }), guide: "vertical" as const,
      points: [{ x: 0, y: 0 }, { x: 0, y: 80 }], width: 1, height: 80 };
    expect(render(layer, layer.id).getImageData(0, 0, 100, 100).data.every((value) => value === 0)).toBe(true);
  });
});
