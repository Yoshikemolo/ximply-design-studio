// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it } from "vitest";
import { newLayer, type Layer, type Point } from "../../../packages/domain/src/document";
import { worldPoint } from "../../../packages/domain/src/curves";
import { EditorService } from "../src/app/editor.service";

function setup(transform: Partial<Layer> = {}) {
  const editor = new EditorService();
  const layer: Layer = {
    ...newLayer("path", "curve", { x: 100, y: 100 }),
    width: 200,
    height: 150,
    curves: [{ closed: false, nodes: [
      { point: { x: 50, y: 50 }, incoming: { x: 20, y: 50 }, outgoing: { x: 80, y: 50 }, smooth: true },
      { point: { x: 150, y: 100 }, incoming: { x: 120, y: 100 }, outgoing: { x: 180, y: 100 }, smooth: true },
    ] }],
    ...transform,
  };
  editor.document.update((doc) => ({ ...doc, layers: [layer] }));
  editor.selectedId.set(layer.id);
  editor.selectedIds.set([layer.id]);
  editor.setTool("direct");
  editor.zoom.set(1);
  return editor;
}
function point(editor: EditorService, part: "point" | "incoming" | "outgoing", index = 0): Point {
  const layer = editor.selected()!;
  return worldPoint(layer, layer.curves![0].nodes[index][part]);
}
function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe("Bézier pointer editing", () => {
  beforeEach(() => localStorage.clear());

  it.each(["ctrl", "alt"] as const)("moves a handle independently with %s and restores coupling on release", (modifier) => {
    const editor = setup();
    const anchor = point(editor, "point"), opposite = point(editor, "incoming");
    editor.start(point(editor, "outgoing"));
    editor.move({ x: anchor.x, y: anchor.y + 40 }, { [modifier]: true });
    expectPoint(point(editor, "incoming"), opposite);
    expect(editor.selected()!.curves![0].nodes[0].smooth).toBe(false);
    editor.move({ x: anchor.x, y: anchor.y + 40 });
    expectPoint(point(editor, "incoming"), { x: anchor.x, y: anchor.y - 30 });
    expect(editor.selected()!.curves![0].nodes[0].smooth).toBe(true);
    editor.cancel();
    expectPoint(point(editor, "incoming"), opposite);
  });

  it("snaps handles in world coordinates on transformed paths and preserves undo/redo", () => {
    const editor = setup({ rotation: 37, skewX: 22, flipX: true });
    editor.snapAngle.set(30);
    const original = structuredClone(editor.document());
    const anchor = point(editor, "point"), opposite = point(editor, "incoming");
    editor.start(point(editor, "outgoing"));
    const distance = 50, angle = 38 * Math.PI / 180;
    editor.move({ x: anchor.x + distance * Math.cos(angle), y: anchor.y + distance * Math.sin(angle) }, { shift: true, ctrl: true });
    expectPoint(point(editor, "outgoing"), { x: anchor.x + distance * Math.cos(Math.PI / 6), y: anchor.y + 25 });
    expectPoint(point(editor, "incoming"), opposite);
    editor.end();
    const changed = structuredClone(editor.document());
    editor.undo();
    expect(editor.document()).toEqual(original);
    editor.redo();
    expect(editor.document()).toEqual(changed);
  });

  it("constrains already-selected anchors without deselecting or accumulating drift", () => {
    const editor = setup({ rotation: 33, skewX: 20 });
    editor.snapAngle.set(30);
    editor.activeNodes.set(["0:0"]);
    const anchor = point(editor, "point"), incoming = point(editor, "incoming");
    const other = point(editor, "point", 1);
    editor.start(anchor, { shift: true });
    editor.move({ x: anchor.x + 30, y: anchor.y + 40 }, { shift: true });
    const dx = 25, dy = 50 * Math.sin(Math.PI / 3);
    expectPoint(point(editor, "point"), { x: anchor.x + dx, y: anchor.y + dy });
    expectPoint(point(editor, "incoming"), { x: incoming.x + dx, y: incoming.y + dy });
    expectPoint(point(editor, "point", 1), other);
    editor.move({ x: anchor.x + 30, y: anchor.y + 40 });
    expectPoint(point(editor, "point"), { x: anchor.x + 30, y: anchor.y + 40 });
    editor.end();
    expect(editor.activeNodes()).toEqual(["0:0"]);
    editor.start(point(editor, "point"), { shift: true });
    editor.end();
    expect(editor.activeNodes()).toEqual([]);
  });

  it("edits selected path nodes with Select while body dragging still moves the object", () => {
    const editor = setup();
    editor.setTool("select");
    const outgoing = point(editor, "outgoing"), anchor = point(editor, "point");
    editor.start(outgoing);
    expect(editor.isEditingCurve()).toBe(true);
    editor.move({ x: outgoing.x, y: outgoing.y + 20 }, { ctrl: true });
    expectPoint(point(editor, "point"), anchor);
    editor.cancel();
    editor.start({ x: 200, y: 175 });
    expect(editor.isEditingCurve()).toBe(false);
    editor.move({ x: 210, y: 185 });
    expectPoint(point(editor, "point"), { x: anchor.x + 10, y: anchor.y + 10 });
  });

  it("honors effective selection override without invoking the underlying anchor-delete tool", () => {
    const editor = setup();
    editor.setTool("deleteAnchor");
    const start = point(editor, "point");
    editor.start(start, { ctrl: true }, "select");
    editor.move({ x: start.x + 20, y: start.y + 10 }, { ctrl: true });
    expect(editor.selected()!.curves![0].nodes).toHaveLength(2);
    expectPoint(point(editor, "point"), { x: start.x + 20, y: start.y + 10 });
    expect(editor.tool()).toBe("deleteAnchor");
  });

  it("does not hit hidden handles and clears node selection when picking another path", () => {
    const editor = setup();
    editor.setTool("select");
    editor.showHandles.set(false);
    editor.start(point(editor, "outgoing"));
    expect(editor.isEditingCurve()).toBe(false);
    editor.cancel();
    editor.showHandles.set(true);
    editor.selectLayer("curve");
    editor.setTool("direct");
    editor.activeNodes.set(["0:0", "0:1"]);
    const second = { ...structuredClone(editor.selected()!), id: "second", x: 500 };
    editor.document.update((doc) => ({ ...doc, layers: [...doc.layers, second] }));
    const start = worldPoint(second, second.curves![0].nodes[0].point);
    editor.start(start);
    expect(editor.selectedId()).toBe("second");
    expect(editor.activeNodes()).toEqual(["0:0"]);
  });

  it("constrains new Pen tangents using the configured angle and splits the handles with Alt during the drag", () => {
    const editor = new EditorService();
    editor.setTool("pen");
    editor.snapAngle.set(30);
    editor.start({ x: 100, y: 100 });
    editor.move({ x: 130, y: 140 }, { shift: true });
    expectPoint(point(editor, "outgoing"), { x: 125, y: 100 + 50 * Math.sin(Math.PI / 3) });
    expectPoint(point(editor, "incoming"), { x: 75, y: 100 - 50 * Math.sin(Math.PI / 3) });
    // As in Illustrator, Alt pressed during the drag leaves the incoming handle where it
    // was and lets the outgoing one go on alone, which makes the anchor a corner.
    editor.move({ x: 130, y: 140 }, { alt: true });
    expectPoint(point(editor, "outgoing"), { x: 130, y: 140 });
    expectPoint(point(editor, "incoming"), { x: 75, y: 100 - 50 * Math.sin(Math.PI / 3) });
    expect(editor.selected()!.curves![0].nodes[0].smooth).toBe(false);
    editor.cancel();
    expect(editor.document().layers).toHaveLength(0);
  });
  it("keeps the opposite handle's world length on skewed paths", () => {
    const editor = setup({ rotation: 28, skewX: 35, flipX: true });
    const anchor = point(editor, "point"), opposite = point(editor, "incoming");
    const length = Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y);
    editor.start(point(editor, "outgoing"));
    editor.move({ x: anchor.x, y: anchor.y + 40 });
    expectPoint(point(editor, "incoming"), { x: anchor.x, y: anchor.y - length });
    editor.move(anchor);
    expectPoint(point(editor, "incoming"), opposite);
  });

  it("does not carry node selections through the Layers panel, select-all, or document reset", () => {
    const editor = setup();
    const second = { ...structuredClone(editor.selected()!), id: "second", x: 500 };
    editor.document.update((doc) => ({ ...doc, layers: [...doc.layers, second] }));
    editor.activeNodes.set(["0:0", "0:1"]);
    editor.selectLayer("second");
    expect(editor.activeNodes()).toEqual([]);
    const first = point(editor, "point"), last = point(editor, "point", 1);
    editor.start(first, { shift: true });
    editor.move({ x: first.x + 20, y: first.y }, { shift: true });
    expectPoint(point(editor, "point", 1), last);
    editor.end();
    editor.selectAll();
    expect(editor.activeNodes()).toEqual([]);
    editor.activeNodes.set(["0:0"]);
    editor.reset();
    expect(editor.activeNodes()).toEqual([]);
  });

});
