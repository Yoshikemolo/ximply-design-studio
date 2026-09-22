import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { blankDocument, Layer, newLayer } from "../../domain/src/document";
import { addMeshPoint, gradientMeshFor, placeGradientMesh } from "../../domain/src/gradient-mesh";
import { CanvasRenderer } from "../src/canvas-renderer";

function render() {
  const rect: Layer = { ...newLayer("rectangle", "r", { x: 100, y: 100 }, "#ff0000", "none", 0), width: 200, height: 100 };
  const base = gradientMeshFor(rect, 1, 1, "flat", 0, "#ff0000")!;
  const { mesh } = addMeshPoint(base, 0.25, 0.3, "#0000ff");
  const { box, mesh: placed } = placeGradientMesh(mesh);
  const layer: Layer = { ...newLayer("path", "m", { x: box.x, y: box.y }, "#ff0000", "none", 0), width: box.width, height: box.height, points: [], gradientMesh: placed };
  const canvas = createCanvas(400, 300);
  new CanvasRenderer().draw(canvas as unknown as HTMLCanvasElement, { ...blankDocument(), version: 2, width: 400, height: 300, layers: [layer] }, null, () => {}, undefined, true);
  const ctx = canvas.getContext("2d");
  return (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
}

describe("gradient meshes on the canvas", () => {
  it("paint the colour of each mesh point there and blend in between", () => {
    const px = render();
    // Each facet takes the colour at its middle, a few units off the point's own.
    const blue = px(150, 130);
    expect(blue[0]).toBeLessThan(16);
    expect(blue[2]).toBeGreaterThan(240);
    expect(px(298, 198)[0]).toBeGreaterThan(245);
    const between = px(225, 165);
    expect(between[0]).toBeGreaterThan(0);
    expect(between[2]).toBeGreaterThan(0);
  });

  it("leave no seams between facets and nothing outside the mesh", () => {
    const px = render();
    for (const [x, y] of [[120, 110], [180, 150], [250, 180], [290, 120], [140, 190]]) expect(px(x, y)[3]).toBe(255);
    expect(px(50, 50)[3]).toBe(0);
  });
});
