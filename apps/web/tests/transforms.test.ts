// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it } from "vitest";
import { worldPoint } from "../../../packages/domain/src/curves";
import { selectionBounds } from "../../../packages/domain/src/arrange";
import { EditorService } from "../src/app/editor.service";

describe("editable transform regressions", () => {
  beforeEach(() => localStorage.clear());
  function curve() {
    const editor = new EditorService();
    editor.setTool("pen");
    editor.start({ x: 100, y: 100 });
    editor.move({ x: 125, y: 125 });
    editor.end();
    editor.start({ x: 200, y: 200 });
    editor.end();
    return editor;
  }
  it("scales Bézier anchors and controls together with the selected bounds", () => {
    const editor = curve();
    const original = structuredClone(editor.selected()!);
    editor.transformBy(0, 2);
    const changed = editor.selected()!;
    expect(changed.width).toBe(original.width * 2);
    expect(changed.curves![0].nodes[0].outgoing!.x).toBe(
      original.curves![0].nodes[0].outgoing!.x * 2,
    );
    expect(changed.curves![0].nodes[1].point.y).toBe(
      original.curves![0].nodes[1].point.y * 2,
    );
    editor.undo();
    expect(editor.selected()!.curves).toEqual(original.curves);
  });
  it.each(["horizontal", "vertical"] as const)(
    "reflects skewed geometry across the %s axis",
    (axis) => {
      const editor = curve();
      editor.updateLayer({ rotation: 30, skewX: 25 });
      const original = structuredClone(editor.selected()!);
      const box = selectionBounds([original]);
      const p = { x: 15, y: 20 };
      const before = worldPoint(original, p);
      editor.reflect(axis);
      const after = worldPoint(editor.selected()!, p);
      expect(after.x).toBeCloseTo(
        axis === "horizontal" ? 2 * box.x + box.width - before.x : before.x,
      );
      expect(after.y).toBeCloseTo(
        axis === "vertical" ? 2 * box.y + box.height - before.y : before.y,
      );
    },
  );
  it("keeps the unfinished pen path when the temporary selection lands on it", () => {
    const editor = curve();
    const id = editor.penId();
    editor.start({ x: 200, y: 200 }, {}, "select");
    editor.end();
    expect(editor.tool()).toBe("pen");
    expect(editor.penId()).toBe(id);
    editor.start({ x: 300, y: 100 });
    editor.end();
    expect(editor.document().layers).toHaveLength(1);
    expect(editor.selected()!.curves![0].nodes).toHaveLength(3);
  });
  it("leaves the path open when Ctrl-click lands away from every object, as in Illustrator", () => {
    const editor = curve();
    editor.start({ x: 500, y: 500 }, {}, "select");
    editor.end();
    expect(editor.penId()).toBeNull();
    expect(editor.selectedIds()).toEqual([]);
    editor.start({ x: 600, y: 600 });
    editor.end();
    expect(editor.document().layers).toHaveLength(2);
  });
  it("preserves each linked symbol instance organization and transform when redefined", () => {
    const editor = curve();
    editor.finishPath();
    editor.defineSymbol();
    const first = editor.selectedId()!;
    editor.updateLayer({
      groupPath: ["group"],
      flipX: true,
      flipY: true,
      skewX: 20,
      visible: false,
    });
    editor.toggle(first, "locked");
    editor.placeSymbol({ x: 500, y: 500 });
    editor.updateLayer({ fill: "#ff0000" });
    editor.symbolAction("redefine");
    const linked = editor
      .document()
      .layers.find((layer) => layer.id === first)!;
    expect(linked).toMatchObject({
      groupPath: ["group"],
      flipX: true,
      flipY: true,
      skewX: 20,
      locked: true,
      visible: false,
      fill: "#ff0000",
    });
  });
});
