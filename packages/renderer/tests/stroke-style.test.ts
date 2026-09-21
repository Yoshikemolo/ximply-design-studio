import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { blankDocument, defaultStrokeStyle, Layer, newLayer, svgExport } from "../../domain/src/document";
import { CanvasRenderer } from "../src/canvas-renderer";
const layer = (): Layer => ({ ...newLayer("rectangle", "rect", { x: 30, y: 30 }, "none", "#ff000080", 10), width: 40, height: 40, strokeStyle: { ...defaultStrokeStyle } });
function render(shape: Layer) {
  const canvas = createCanvas(120, 120);
  new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement, { ...blankDocument(), width: 120, height: 120, layers: [shape] }, null, () => {}, undefined, true);
  return canvas.getContext("2d");
}
function alpha(ctx: ReturnType<typeof render>, x: number, y: number) { return ctx.getImageData(x, y, 1, 1).data[3]; }
const contour = (x: number, y: number, side: number) => ({ closed: true, nodes: [{x,y}, {x:x+side,y}, {x:x+side,y:y+side}, {x,y:y+side}].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) });

describe("stroke geometry pixel oracles", () => {
  it("draws inside/outside width on the correct side without multiplying stroke alpha", () => {
    const inside = render({ ...layer(), strokeStyle: { ...defaultStrokeStyle, alignment: "inside" } });
    expect(alpha(inside, 25, 50)).toBe(0);
    expect(alpha(inside, 35, 50)).toBe(128);
    expect(alpha(inside, 42, 50)).toBe(0);
    const outside = render({ ...layer(), strokeStyle: { ...defaultStrokeStyle, alignment: "outside" } });
    expect(alpha(outside, 25, 50)).toBe(128);
    expect(alpha(outside, 35, 50)).toBe(0);
    expect(alpha(outside, 18, 50)).toBe(0);
  });
  it("keeps outside ellipse clipping free of connecting diagonals", () => {
    const ctx = render({ ...layer(), kind: "ellipse", strokeStyle: { ...defaultStrokeStyle, alignment: "outside" } });
    for (const [x,y] of [[75,50],[25,50],[50,25],[50,75],[68,68],[31,68],[68,31],[31,31]]) expect(alpha(ctx,x,y)).toBe(128);
    expect(alpha(ctx, 65, 50)).toBe(0);
  });
  it("aligns strokes to the evenodd interior and exterior of compound holes", () => {
    const shape = { ...layer(), kind: "path" as const, curves: [contour(0,0,60),contour(20,20,20)], width: 60, height: 60 };
    const inside = render({ ...shape, strokeStyle: { ...defaultStrokeStyle, alignment: "inside" } });
    const outside = render({ ...shape, strokeStyle: { ...defaultStrokeStyle, alignment: "outside" } });
    expect(alpha(inside,45,60)).toBe(128);
    expect(alpha(inside,55,60)).toBe(0);
    expect(alpha(outside,45,60)).toBe(0);
    expect(alpha(outside,55,60)).toBe(128);
  });
  it("keeps open strokes centered and distinguishes butt, square and round caps", () => {
    const shape = { ...layer(), kind: "path" as const, points: [{x:0,y:20},{x:40,y:20}], stroke: "#ff0000" };
    const butt = render({ ...shape, strokeStyle: { ...defaultStrokeStyle, alignment: "outside", cap: "butt" } });
    const square = render({ ...shape, strokeStyle: { ...defaultStrokeStyle, alignment: "inside", cap: "square" } });
    const round = render({ ...shape, strokeStyle: { ...defaultStrokeStyle, cap: "round" } });
    expect(alpha(butt,25,45)).toBe(0);
    expect(alpha(square,25,45)).toBe(255);
    expect(alpha(round,25,45)).toBe(0);
    expect(alpha(butt,50,46)).toBe(255);
    expect(alpha(butt,50,43)).toBe(0);
  });
  it("distinguishes miter, round and bevel corners", () => {
    const shape = { ...layer(), stroke: "#ff0000" };
    expect(alpha(render({ ...shape, strokeStyle: { ...defaultStrokeStyle, join: "miter" } }),25,25)).toBe(255);
    expect(alpha(render({ ...shape, strokeStyle: { ...defaultStrokeStyle, join: "round" } }),25,25)).toBe(0);
    expect(alpha(render({ ...shape, strokeStyle: { ...defaultStrokeStyle, join: "bevel" } }),25,25)).toBe(0);
  });
  it("paints mixed closed and open centered contours once at intersections", () => {
    const open = { closed: false, nodes: [{x:-15,y:20},{x:55,y:20}].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) };
    const ctx = render({ ...layer(), kind: "path", curves: [contour(0,0,40),open] });
    expect(alpha(ctx,30,50)).toBe(128);
  });
  it("SVG masks and clips reproduce closed outline positions", async () => {
    for (const alignment of ["inside", "outside"] as const) {
      const shape = { ...layer(), strokeStyle: { ...defaultStrokeStyle, alignment } };
      const svg = svgExport({ ...blankDocument(), width: 120, height: 120, layers: [shape] });
      const image = await loadImage(Buffer.from(svg));
      const canvas = createCanvas(120,120), ctx = canvas.getContext("2d");
      ctx.drawImage(image,0,0);
      const outside = [...ctx.getImageData(25,50,1,1).data], inside = [...ctx.getImageData(35,50,1,1).data];
      expect(outside).toEqual(alignment === "outside" ? [255,127,127,255] : [255,255,255,255]);
      expect(inside).toEqual(alignment === "inside" ? [255,127,127,255] : [255,255,255,255]);
    }
  });
});
