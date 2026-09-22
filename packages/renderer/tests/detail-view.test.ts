import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { blankDocument, Layer, newLayer } from "../../domain/src/document";
import { CanvasRenderer } from "../src/canvas-renderer";

const doc = () => ({ ...blankDocument(), width: 200, height: 100, background: "#ffffff",
  layers: [{ ...newLayer("ellipse", "e", { x: 40, y: 20 }, "#ff0000", "none", 0), width: 60, height: 60 } as Layer] });

describe("a region of the page at a scale", () => {
  it("draws on a canvas the size of the region, each unit as many pixels as the scale", () => {
    const canvas = createCanvas(1, 1);
    new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement, doc(), null, () => {}, undefined, false, { zoom: 4, direct: false }, { x: 30, y: 10, width: 50, height: 40, scale: 4 });
    expect([canvas.width, canvas.height]).toEqual([200, 160]);
    const ctx = canvas.getContext("2d");
    const px = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    // Page point (70, 50), the middle of the circle, is at (160, 160) of the region... (70-30)*4 = 160, (50-10)*4 = 160.
    expect(px(159, 159).slice(0, 3)).toEqual([255, 0, 0]);
    // Page point (32, 12), outside the circle, is white background.
    expect(px(8, 8).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("keeps the edge of a shape sharp where the whole page drawn and enlarged would blur it", () => {
    const sharp = createCanvas(1, 1), whole = createCanvas(1, 1);
    new CanvasRenderer().draw(sharp as unknown as HTMLCanvasElement, doc(), null, () => {}, undefined, false, { zoom: 8, direct: false }, { x: 90, y: 40, width: 20, height: 20, scale: 8 });
    new CanvasRenderer().draw(whole as unknown as HTMLCanvasElement, doc(), null, () => {}, undefined, false, { zoom: 1, direct: false });
    // Along a line across the right edge of the circle at x 100: the magnified region goes from
    // red to white within about two pixels, where one page pixel would span eight.
    const row = [...sharp.getContext("2d").getImageData(0, 80, 160, 1).data].filter((_, i) => i % 4 === 1);
    const blended = row.filter((g) => g > 20 && g < 235).length;
    expect(blended).toBeLessThanOrEqual(3);
    expect(whole.width).toBe(200);
  });
});
