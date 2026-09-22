import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { blankDocument, Layer, newLayer, StudioDocument } from "../../domain/src/document";
import { GradientPaint, presetPattern } from "../../domain/src/paint";
import { CanvasFactory, CanvasRenderer } from "../src/canvas-renderer";

const factory: CanvasFactory = (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement;
const box = (extra: Partial<Layer> = {}): Layer => ({ ...newLayer("rectangle", "box", { x: 0, y: 0 }, "#000000", "none", 0), width: 100, height: 40, ...extra });
const blackWhite: GradientPaint = { kind: "gradient", type: "linear", angle: 0, stops: [{ color: "#000000", location: 0, midpoint: 50 }, { color: "#ffffff", location: 100, midpoint: 50 }] };
function render(layers: Layer[], extra: Partial<StudioDocument> = {}) {
  const canvas = createCanvas(100, 40);
  new CanvasRenderer(factory).draw(canvas as unknown as HTMLCanvasElement, { ...blankDocument(), version: 2, width: 100, height: 40, layers, ...extra }, null, () => {}, undefined, true);
  return canvas.getContext("2d");
}
const red = (ctx: ReturnType<typeof render>, x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[0];
const alpha = (ctx: ReturnType<typeof render>, x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];

describe("gradient fills", () => {
  it("run from the first stop to the last across the box", () => {
    const ctx = render([box({ fillPaint: blackWhite })]);
    expect(red(ctx, 1, 20)).toBeLessThan(10);
    expect(red(ctx, 50, 20)).toBeGreaterThan(115);
    expect(red(ctx, 50, 20)).toBeLessThan(140);
    expect(red(ctx, 98, 20)).toBeGreaterThan(245);
  });

  it("follow the angle, 90 degrees running from the bottom up", () => {
    const ctx = render([box({ fillPaint: { ...blackWhite, angle: 90 } })]);
    expect(red(ctx, 50, 38)).toBeLessThan(20);
    expect(red(ctx, 50, 1)).toBeGreaterThan(235);
  });

  it("move the even mix to a shifted midpoint", () => {
    const paint = structuredClone(blackWhite);
    paint.stops[0].midpoint = 25;
    const ctx = render([box({ fillPaint: paint })]);
    expect(red(ctx, 25, 20)).toBeGreaterThan(115);
    expect(red(ctx, 25, 20)).toBeLessThan(140);
  });

  it("spread a radial gradient from the centre", () => {
    const ctx = render([box({ fillPaint: { ...blackWhite, type: "radial" } })]);
    expect(red(ctx, 50, 20)).toBeLessThan(10);
    expect(red(ctx, 99, 20)).toBeGreaterThan(240);
  });

  it("paint nothing when the fill is None", () => {
    const ctx = render([box({ fill: "none", fillPaint: blackWhite })]);
    expect(alpha(ctx, 50, 20)).toBe(0);
  });
});

describe("pattern fills", () => {
  it("tile the artwork of the pattern from the document origin", () => {
    const stripes = presetPattern("checker", "p", "#ff0000", 20);
    const ctx = render([box({ x: 5, width: 95, fillPaint: { kind: "pattern", patternId: "p" } })], { patterns: [stripes] });
    // A 20 unit checker fills (0..10, 0..10) and (10..20, 10..20) of each tile, counted from
    // the page: at x 12 the page tile is empty, while a tile starting at the object would be full.
    expect(alpha(ctx, 7, 5)).toBe(255);
    expect(alpha(ctx, 12, 5)).toBe(0);
    expect(alpha(ctx, 25, 5)).toBe(255);
    expect(alpha(ctx, 35, 5)).toBe(0);
    expect(alpha(ctx, 55, 15)).toBe(255);
    expect(alpha(ctx, 45, 15)).toBe(0);
    expect(red(ctx, 7, 5)).toBe(255);
    expect(alpha(ctx, 2, 5)).toBe(0);
  });

  it("fall back to the fill colour when the pattern is missing", () => {
    const ctx = render([box({ fill: "#ff0000", fillPaint: { kind: "pattern", patternId: "gone" } })]);
    expect(red(ctx, 50, 20)).toBe(255);
    expect(alpha(ctx, 50, 20)).toBe(255);
  });
});
