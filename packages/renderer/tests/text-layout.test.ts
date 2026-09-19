import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { blankDocument, Layer, newLayer } from "../../domain/src/document";
import { defaultTextLayout, defaultTypography } from "../../domain/src/text-layout";
import { CanvasRenderer } from "../src/canvas-renderer";
function render(layer: Layer) {
  const canvas = createCanvas(180, 150);
  new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement, { ...blankDocument(), width: 180, height: 150, layers: [layer] }, null, () => {}, undefined, true);
  return canvas.getContext("2d");
}
const text = (): Layer => ({ ...newLayer("text", "text", { x: 10, y: 10 }, "#ff0000", "none"), text: "MMMM MMMM", fontSize: 30, width: 100, height: 100, typography: { ...defaultTypography, fontFamily: "monospace" }, textLayout: { ...defaultTextLayout, wrap: true } });
const alpha = (ctx: ReturnType<typeof render>, x: number, y: number, width: number, height: number) => ctx.getImageData(x, y, width, height).data.some((value, index) => index % 4 === 3 && value > 0);

describe("typography renderer pixel oracles", () => {
  it("wraps into visible second line and clips fixed-frame overflow", () => {
    const layer = text(), ctx = render(layer);
    expect(alpha(ctx, 10, 10, 100, 30)).toBe(true);
    expect(alpha(ctx, 10, 46, 100, 30)).toBe(true);
    expect(alpha(ctx, 111, 10, 69, 100)).toBe(false);
    const clipped = render({ ...layer, height: 30 });
    expect(alpha(clipped, 10, 40, 100, 60)).toBe(false);
  });
  it("retains unframed legacy text overflow instead of clipping old projects", () => {
    const layer = text();
    delete layer.textLayout;
    delete layer.typography;
    layer.width = 1;
    layer.height = 1;
    expect(alpha(render(layer), 20, 10, 80, 40)).toBe(true);
  });
  it("draws underline with selected independent paint and explicit baseline shift", () => {
    const layer = { ...text(), text: "MM", fontSize: 20, typography: { ...defaultTypography, fontFamily: "monospace" as const, decoration: "underline" as const, baselineShift: -10 } };
    const ctx = render(layer);
    // Baseline = origin10 + (20*.8 -(-10)) =36; underline begins38.4.
    expect([...ctx.getImageData(15, 39, 1, 1).data]).toEqual([255, 0, 0, 166]);
    expect(alpha(ctx, 10, 10, 70, 10)).toBe(false);
  });
  it("shrinks text into a fixed box and respects transparent fill with outline", () => {
    const layer = { ...text(), text: "MMMMMMMM", width: 45, height: 20, fill: "none", stroke: "#0000ff80", strokeWidth: 1, textLayout: { ...defaultTextLayout, fit: true } };
    const ctx = render(layer);
    expect(alpha(ctx, 10, 10, 45, 20)).toBe(true);
    expect(alpha(ctx, 56, 10, 100, 100)).toBe(false);
    const pixels = ctx.getImageData(0, 0, 180, 150).data;
    expect(pixels.every((value, index) => index % 4 !== 0 || value === 0)).toBe(true);
  });
});
