// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorService } from "../src/app/editor.service";
import { newLayer, parseDocument } from "../../../packages/domain/src/document";
import type { SnapConfig } from "../../../packages/domain/src/measurements";
const shape = (id: string, x = 0) => ({ ...newLayer("rectangle", id, { x, y: 20 }), width: 100, height: 80 });
const editor = () => {
  const result = new EditorService();
  result.document.update((doc) => ({ ...doc, layers: [shape("a"), shape("b", 200)] }));
  result.selectAll();
  return result;
};
beforeEach(() => localStorage.clear());
describe("appearance transactions", () => {
  it("sets transparent paint on the entire selection as one undoable transaction", () => {
    const e = editor(), previous = structuredClone(e.document());
    e.setPaint("fill", "none");
    expect(e.selectedLayers().map((layer) => layer.fill)).toEqual(["none", "none"]);
    e.undo();
    expect(e.document()).toEqual(previous);
    e.redo();
    expect(e.selectedLayers().every((layer) => layer.fill === "none")).toBe(true);
  });
  it("swaps alpha colors without losing opacity and adjusts all stroke widths", () => {
    const e = editor();
    e.setPaint("fill", "#ff004480");
    e.setPaint("stroke", "none");
    e.swapPaint();
    expect(e.selectedLayers().every((layer) => layer.fill === "none" && layer.stroke === "#ff004480")).toBe(true);
    e.setStrokeWidth(12);
    expect(e.selectedLayers().every((layer) => layer.strokeWidth === 12)).toBe(true);
    e.undo();
    expect(e.selectedLayers().every((layer) => layer.strokeWidth === 2)).toBe(true);
  });
  it("keeps locked paint unchanged and ignores invalid values", () => {
    const e = editor();
    e.toggle("a", "locked");
    e.setPaint("fill", "#ffffff");
    expect(e.document().layers[0].fill).not.toBe("#ffffff");
    const previous = structuredClone(e.document());
    e.setPaint("fill", "url(https://example.com)");
    e.setStrokeWidth(NaN);
    expect(e.document()).toEqual(previous);
  });
  it("does not create a black paint layer when no fill is selected", () => {
    const e = editor();
    e.setPaint("fill", "none");
    e.tool.set("brush");
    const before = structuredClone(e.document());
    const canvas = vi.spyOn(document, "createElement");
    e.start({ x: 10, y: 10 }); e.move({ x: 20, y: 20 }); e.end();
    expect(e.document()).toEqual(before);
    expect(canvas).not.toHaveBeenCalled();
    canvas.mockRestore();
  });
});
describe("guide lifecycle", () => {
  it("creates and repositions a guide with one undo per completed drag and native persistence", () => {
    const e = editor();
    const id = e.beginGuideDrag("vertical", 10)!;
    e.updateGuideDrag(40); e.updateGuideDrag(80); e.endGuideDrag(true);
    expect(e.document().layers.find((layer) => layer.id === id)?.x).toBe(80);
    expect(parseDocument(JSON.stringify(e.document())).layers.at(-1)?.guide).toBe("vertical");
    e.beginGuideDrag("vertical", 80, id); e.updateGuideDrag(150); e.endGuideDrag(true);
    e.undo(); expect(e.document().layers.at(-1)?.x).toBe(80);
    e.undo(); expect(e.document().layers).toHaveLength(2);
    e.redo(); expect(e.document().layers.at(-1)?.x).toBe(80);
  });
  it("discards a new guide outside the artboard and undoes deletion of an existing guide", () => {
    const e = editor();
    e.beginGuideDrag("horizontal", -20); e.endGuideDrag(false);
    expect(e.document().layers).toHaveLength(2);
    const id = e.beginGuideDrag("horizontal", 75)!; e.endGuideDrag(true);
    e.beginGuideDrag("horizontal", 75, id); e.endGuideDrag(false);
    expect(e.document().layers).toHaveLength(2);
    e.undo(); expect(e.document().layers.at(-1)?.y).toBe(75);
    e.toggle(id, "locked");
    expect(e.beginGuideDrag("horizontal", 75, id)).toBeNull();
  });
  it("cancels guide movement and excludes guides from selection-all and paint", () => {
    const e = editor();
    const id = e.beginGuideDrag("vertical", 50)!; e.endGuideDrag(true);
    e.beginGuideDrag("vertical", 50, id); e.updateGuideDrag(100); e.cancel();
    expect(e.document().layers.at(-1)?.x).toBe(50);
    e.selectLayer(id); e.setPaint("stroke", "#000000");
    expect(e.document().layers.at(-1)?.stroke).toBe("#00b8d9");
    e.selectAll(); e.group();
    expect(e.selectedLayers()).toHaveLength(2);
    expect(e.document().layers.at(-1)?.groupPath).toBeUndefined();
  });
});
describe("guide isolation", () => {
  it("keeps a guide unchanged during mixed-selection transforms and path commands", () => {
    const e = editor();
    const id = e.beginGuideDrag("vertical", 60)!; e.endGuideDrag(true);
    const guide = structuredClone(e.document().layers.at(-1));
    e.selectLayer(id); e.pathAction("extend");
    expect(e.penId()).toBeNull();
    e.selectLayer("a", true); e.transformBy(45, 2);
    expect(e.document().layers.find((layer) => layer.id === id)).toEqual(guide);
    e.selectLayer(id); e.tool.set("eraser"); e.start({ x: 60, y: 0 }); e.end();
    expect(e.document().layers.find((layer) => layer.id === id)).toEqual(guide);
  });
});
describe("layer ordering and snapping", () => {
  it("moves a complete group around another group without splitting either or changing selection", () => {
    const e = editor();
    e.document.update((doc) => ({ ...doc, layers: [shape("a"), shape("b"), shape("c"), shape("d")].map((layer, index) => ({ ...layer, groupPath: [index < 2 ? "first" : "second"] })) }));
    e.selectLayer("a");
    e.reorderLayer("a", "c", "after");
    expect(e.document().layers.map((layer) => layer.id)).toEqual(["c", "d", "a", "b"]);
    expect(e.selectedLayers().map((layer) => layer.id)).toEqual(["a", "b"]);
    e.undo(); expect(e.document().layers.map((layer) => layer.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("snaps the moving object's boundary rather than the pointer and does not accumulate drag error", () => {
    const e = editor(); e.selectedIds.set([]); e.selectedId.set(null); e.zoom.set(2);
    const config: SnapConfig = { zoom: 2, rulers: { enabled: false, visible: true, step: 50, radius: 8 }, grid: { enabled: false, visible: true, step: 20, radius: 8 }, guides: { enabled: true, visible: true, radius: 8, items: [{ axis: "x", position: 120 }] } };
    e.snapConfig.set(config);
    e.start({ x: 30, y: 45 }); e.move({ x: 48, y: 45 });
    expect(e.selected()?.x).toBe(20);
    e.move({ x: 60, y: 45 });
    expect(e.selected()?.x).toBe(30);
    e.end(); e.undo(); expect(e.selected()?.x).toBe(0);
  });
});
