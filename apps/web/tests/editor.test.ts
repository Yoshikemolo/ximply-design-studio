// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { EditorService } from "../src/app/editor.service";
describe("editor command facade", () => {
  beforeEach(() => localStorage.clear());
  it("draws and moves an editable shape, with undo and redo", () => {
    const e = new EditorService();
    e.tool.set("rectangle");
    e.start({ x: 10, y: 20 });
    e.move({ x: 110, y: 100 });
    e.end();
    expect(e.selected()?.width).toBe(100);
    e.tool.set("select");
    e.start({ x: 30, y: 30 });
    e.move({ x: 50, y: 50 });
    e.end();
    expect(e.selected()?.x).toBe(30);
    e.undo();
    expect(e.selected()?.x).toBe(10);
    e.redo();
    expect(e.selected()?.x).toBe(30);
  });
  it("cancels incomplete drawing and protects locked layers", () => {
    const e = new EditorService();
    e.tool.set("ellipse");
    e.start({ x: 0, y: 0 });
    e.move({ x: 100, y: 100 });
    e.cancel();
    expect(e.document().layers).toHaveLength(0);
    e.start({ x: 0, y: 0 });
    e.move({ x: 100, y: 100 });
    e.end();
    const id = e.selected()!.id;
    e.toggle(id, "locked");
    e.updateLayer({ width: 500 });
    e.remove();
    expect(e.document().layers).toHaveLength(1);
    expect(e.selected()?.width).toBe(100);
  });
  it("duplicates, reorders and round trips native document data", () => {
    const e = new EditorService();
    e.tool.set("text");
    e.start({ x: 10, y: 10 });
    e.end();
    e.updateLayer({ text: "Hello" });
    e.duplicate();
    expect(e.document().layers).toHaveLength(2);
    const id = e.selectedId();
    e.moveOrder(-1);
    expect(e.document().layers[0].id).toBe(id);
    const saved = JSON.stringify(e.document());
    e.reset();
    e.open(saved);
    expect(e.document().layers[0].text).toBe("Hello");
    e.selectedId.set(id);
    e.remove();
    expect(e.document().layers).toHaveLength(1);
  });
  it("paints pixels and erases them while keeping undo evidence", async () => {
    const canvases = new WeakMap<
      HTMLCanvasElement,
      ReturnType<typeof createCanvas>
    >();
    const native = (element: HTMLCanvasElement) => {
      let canvas = canvases.get(element);
      if (!canvas) {
        canvas = createCanvas(element.width, element.height);
        canvases.set(element, canvas);
      }
      return canvas;
    };
    const context = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(function (this: HTMLCanvasElement) {
        return native(this).getContext("2d") as never;
      });
    const encode = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockImplementation(function (this: HTMLCanvasElement) {
        return native(this).toDataURL("image/png");
      });
    try {
      const e = new EditorService();
      e.tool.set("brush");
      e.fill.set("#ff0000");
      e.size.set(20);
      e.start({ x: 50, y: 50 });
      e.move({ x: 80, y: 50 });
      e.end();
      const source = e.selected()!.source,
        image = await loadImage(source);
      const pixelCanvas = createCanvas(1200, 800);
      pixelCanvas.getContext("2d").drawImage(image, 0, 0);
      expect([
        ...pixelCanvas.getContext("2d").getImageData(65, 50, 1, 1).data,
      ]).toEqual([255, 0, 0, 255]);
      vi.spyOn(e.renderer, "image").mockReturnValue(
        image as unknown as HTMLImageElement,
      );
      e.tool.set("eraser");
      e.start({ x: 65, y: 50 });
      e.end();
      const erased = await loadImage(e.selected()!.source);
      pixelCanvas.getContext("2d").clearRect(0, 0, 1200, 800);
      pixelCanvas.getContext("2d").drawImage(erased, 0, 0);
      expect(
        pixelCanvas.getContext("2d").getImageData(65, 50, 1, 1).data[3],
      ).toBe(0);
      e.undo();
      expect(e.selected()!.source).toBe(source);
    } finally {
      context.mockRestore();
      encode.mockRestore();
    }
  });
});

describe("curve gestures and reusable artwork", () => {
  beforeEach(() => localStorage.clear());
  it("creates cubic controls, closes paths, and preserves undo", () => {
    const e = new EditorService();
    e.setTool("pen");
    e.start({ x: 100, y: 100 });
    e.move({ x: 140, y: 100 });
    e.end();
    e.start({ x: 200, y: 200 });
    e.move({ x: 200, y: 240 });
    e.end();
    e.start({ x: 100, y: 200 });
    e.end();
    expect(e.document().layers).toHaveLength(1);
    expect(e.selected()!.curves![0].nodes).toHaveLength(3);
    e.start({ x: 100, y: 100 });
    expect(e.selected()!.curves![0].closed).toBe(true);
    e.undo();
    expect(e.selected()!.curves![0].closed).toBe(false);
  });
  it("uses rotation and edge handles with independent geometry", () => {
    const e = new EditorService();
    e.tool.set("rectangle");
    e.start({ x: 100, y: 100 });
    e.move({ x: 300, y: 200 });
    e.end();
    e.setTool("select");
    e.start({ x: 300, y: 150 });
    e.move({ x: 350, y: 150 });
    e.end();
    expect(e.selected()!.width).toBe(250);
    expect(e.selected()!.height).toBe(100);
    const center = { x: 225, y: 150 };
    e.start({ x: 225, y: 100 - 28 / e.zoom() });
    e.move({ x: center.x + 100, y: center.y }, { shift: true });
    e.end();
    expect(e.selected()!.rotation).toBe(90);
    expect(e.selected()!.x + e.selected()!.width / 2).toBe(center.x);
    e.undo();
    expect(e.selected()!.rotation).toBe(0);
  });
  it("selects existing text rather than creating another layer", () => {
    const e = new EditorService();
    e.setTool("text");
    e.start({ x: 20, y: 20 });
    e.end();
    e.start({ x: 30, y: 30 });
    e.end();
    expect(e.document().layers).toHaveLength(1);
  });
  it("creates and redefines linked symbols while keeping instance positions", () => {
    const e = new EditorService();
    e.setTool("rectangle");
    e.start({ x: 0, y: 0 });
    e.move({ x: 100, y: 100 });
    e.end();
    e.defineSymbol();
    e.placeSymbol({ x: 300, y: 300 });
    const second = e.selected()!;
    expect(second.symbolId).toBe(e.document().symbols![0].id);
    e.updateLayer({ fill: "#ff0000" });
    e.symbolAction("redefine");
    expect(e.document().layers.every((l) => l.fill === "#ff0000")).toBe(true);
    expect(e.selected()!.x).toBe(250);
    const native = JSON.stringify(e.document());
    e.open(native);
    expect(e.document().symbols).toHaveLength(1);
  });
});

describe("multi-selection and group transformations", () => {
  beforeEach(() => localStorage.clear());
  function scene() {
    const e = new EditorService();
    e.setTool("rectangle");
    e.start({ x: 10, y: 10 });
    e.move({ x: 110, y: 110 });
    e.end();
    const first = e.selectedId()!;
    e.start({ x: 210, y: 10 });
    e.move({ x: 310, y: 110 });
    e.end();
    const second = e.selectedId()!;
    e.selectLayer(first);
    e.selectLayer(second, true);
    return { e, first, second };
  }
  it("toggles Shift selections and preserves nested group levels", () => {
    const { e, first, second } = scene();
    expect(e.selectedLayers()).toHaveLength(2);
    e.group();
    const outer = e.selected()!.groupPath![0];
    e.group();
    expect(e.selected()!.groupPath).toHaveLength(2);
    e.group(true);
    expect(e.selected()!.groupPath).toEqual([outer]);
    e.selectLayer(first);
    expect(e.selectedLayers()).toHaveLength(2);
    e.group(true);
    e.selectLayer(second, true);
    expect(e.selectedLayers().map((l) => l.id)).toEqual([first]);
  });
  it("moves an entire group as one undoable canvas gesture", () => {
    const { e, first } = scene();
    e.group();
    e.setTool("select");
    e.start({ x: 50, y: 50 });
    e.move({ x: 70, y: 80 });
    e.end();
    expect(e.document().layers.map((l) => [l.x, l.y])).toEqual([
      [30, 40],
      [230, 40],
    ]);
    e.undo();
    expect(e.document().layers[0].x).toBe(10);
  });
  it("reflects, rotates and scales all members with persistent grouping", () => {
    const { e } = scene();
    e.group();
    e.reflect("horizontal");
    expect(e.document().layers.map((l) => l.x)).toEqual([210, 10]);
    expect(e.document().layers.every((l) => l.flipX)).toBe(true);
    e.transformBy(90);
    expect(e.document().layers.every((l) => l.rotation === 90)).toBe(true);
    e.transformBy(0, 2);
    expect(e.document().layers.every((l) => l.width === 200)).toBe(true);
    expect(e.document().layers.every((l) => l.groupPath?.length === 1)).toBe(
      true,
    );
    e.open(JSON.stringify(e.document()));
    expect(e.document().layers[0].flipX).toBe(true);
  });
  it("boolean results stay editable and undo restores source layers", () => {
    const { e, second } = scene();
    e.selectedId.set(second);
    e.selectedIds.set([]);
    e.updateLayer({ x: 60 });
    e.selectAll();
    e.boolean("union");
    expect(e.document().layers).toHaveLength(1);
    expect(e.selected()!.curves!.length).toBeGreaterThan(0);
    e.undo();
    expect(e.document().layers).toHaveLength(2);
  });
});
