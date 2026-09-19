import { createCanvas } from "@napi-rs/canvas";
import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../src/canvas-renderer";
import { blankDocument, newLayer } from "../../domain/src/document";
describe("Canvas2D pixel oracles", () => {
  it("does not render vector paths whose stroke width is zero", () => {
    const canvas = createCanvas(100, 100),
      doc = {
        ...blankDocument(),
        width: 100,
        height: 100,
        layers: [
          {
            ...newLayer("path", "a", { x: 0, y: 0 }, "#000000", "#000000", 0),
            points: [
              { x: 0, y: 50 },
              { x: 100, y: 50 },
            ],
          },
        ],
      };
    new CanvasRenderer().draw(
      canvas as unknown as HTMLCanvasElement,
      doc,
      null,
      () => {},
    );
    expect([
      ...canvas.getContext("2d").getImageData(50, 50, 1, 1).data,
    ]).toEqual([255, 255, 255, 255]);
  });
  it("composites opacity and hidden layers over the document background", () => {
    const canvas = createCanvas(100, 100),
      doc = { ...blankDocument(), width: 100, height: 100 };
    const layer = {
      ...newLayer("rectangle", "a", { x: 10, y: 10 }, "#ff0000", "#ff0000", 0),
      width: 50,
      height: 50,
      opacity: 0.5,
    };
    doc.layers = [layer];
    new CanvasRenderer().draw(
      canvas as unknown as HTMLCanvasElement,
      doc,
      null,
      () => {},
    );
    const pixel = canvas.getContext("2d").getImageData(20, 20, 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBeGreaterThanOrEqual(127);
    expect(pixel[1]).toBeLessThanOrEqual(128);
    layer.visible = false;
    new CanvasRenderer().draw(
      canvas as unknown as HTMLCanvasElement,
      doc,
      null,
      () => {},
    );
    expect([
      ...canvas.getContext("2d").getImageData(20, 20, 1, 1).data,
    ]).toEqual([255, 255, 255, 255]);
  });
  it("renders a transparent layer plane without introducing a white background", () => {
    const canvas = createCanvas(100, 100),
      doc = { ...blankDocument(), width: 100, height: 100 };
    doc.layers = [
      {
        ...newLayer("ellipse", "a", { x: 10, y: 10 }, "#0000ff", "#0000ff", 0),
        width: 50,
        height: 50,
      },
    ];
    new CanvasRenderer().draw(
      canvas as unknown as HTMLCanvasElement,
      doc,
      null,
      () => {},
      undefined,
      true,
    );
    expect(canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3]).toBe(0);
    expect([
      ...canvas.getContext("2d").getImageData(35, 35, 1, 1).data,
    ]).toEqual([0, 0, 255, 255]);
  });
});

it("renders cubic curvature rather than its control polygon or chord", () => {
  const canvas = createCanvas(120, 120),
    doc = blankDocument();
  doc.width = 120;
  doc.height = 120;
  const point = (x: number, y: number) => ({
    point: { x, y },
    incoming: { x, y },
    outgoing: { x, y },
    smooth: false,
  });
  const a = point(10, 10),
    b = point(110, 10);
  a.outgoing = { x: 10, y: 110 };
  b.incoming = { x: 110, y: 110 };
  doc.layers = [
    {
      ...newLayer("path", "curve", { x: 0, y: 0 }),
      width: 120,
      height: 120,
      stroke: "#ff0000",
      strokeWidth: 4,
      curves: [{ nodes: [a, b], closed: false }],
    },
  ];
  new CanvasRenderer().draw(
    canvas as unknown as HTMLCanvasElement,
    doc,
    null,
    () => {},
    undefined,
    true,
  );
  const ctx = canvas.getContext("2d");
  expect([...ctx.getImageData(60, 85, 1, 1).data]).toEqual([255, 0, 0, 255]);
  expect(ctx.getImageData(60, 10, 1, 1).data[3]).toBe(0);
});

it("renders centered shear with a pixel oracle outside the original rectangle", () => {
  const canvas = createCanvas(150, 130),
    doc = { ...blankDocument(), width: 150, height: 130 };
  doc.layers = [
    {
      ...newLayer(
        "rectangle",
        "shear",
        { x: 40, y: 30 },
        "#ff0000",
        "#ff0000",
        0,
      ),
      width: 40,
      height: 60,
      skewX: 45,
    },
  ];
  new CanvasRenderer().draw(
    canvas as unknown as HTMLCanvasElement,
    doc,
    null,
    () => {},
    undefined,
    true,
  );
  const ctx = canvas.getContext("2d");
  expect([...ctx.getImageData(90, 80, 1, 1).data]).toEqual([255, 0, 0, 255]);
  expect(ctx.getImageData(45, 80, 1, 1).data[3]).toBe(0);
});
