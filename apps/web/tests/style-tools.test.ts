// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it } from "vitest";
import { EditorService } from "../src/app/editor.service";
import { newLayer, parseDocument } from "../../../packages/domain/src/document";
import { defaultShortcuts, validateShortcuts } from "../../../packages/domain/src/shortcuts";
const style = { alignment: "outside", join: "miter", cap: "square" } as const;
function setup() {
  const e = new EditorService();
  const source = { ...newLayer("rectangle", "source", { x: 200, y: 20 }), width: 80, height: 80, fill: "#ff004480", stroke: "none", strokeWidth: 12, strokeStyle: style, opacity: 0.35 };
  const target = { ...newLayer("rectangle", "target", { x: 0, y: 20 }), width: 80, height: 80, fill: "#00ff00", stroke: "#000000", opacity: 0.8 };
  e.document.update(doc => ({ ...doc, layers: [target, source] }));
  e.selectLayer("target");
  return e;
}
beforeEach(() => localStorage.clear());
describe("style eyedropper", () => {
  it("copies complete scoped appearance to defaults and selection without copying layer opacity", () => {
    const e = setup(), before = structuredClone(e.document());
    e.setTool("eyedropper"); e.start({ x: 240, y: 60 }); e.end();
    expect(e.selected()!).toMatchObject({ fill: "#ff004480", stroke: "none", strokeWidth: 12, strokeStyle: style, opacity: 0.8 });
    expect(e.fill()).toBe("#ff004480"); expect(e.stroke()).toBe("none"); expect(e.strokeStyle()).toEqual(style);
    expect(e.selectedId()).toBe("target");
    e.undo(); expect(e.document()).toEqual(before);
    e.redo(); expect(e.selected()!.strokeStyle).toEqual(style);
  });
  it("samples a locked source but never changes locked selected artwork", () => {
    const e = setup(); e.toggle("source", "locked"); e.toggle("target", "locked");
    const before = structuredClone(e.document());
    expect(e.sampleStyle({ x: 240, y: 60 })).toBe(true);
    expect(e.document()).toEqual(before); expect(e.fill()).toBe("#ff004480");
  });
  it("copies fill only while preserving the target's complete stroke", () => {
    const e = setup(); e.styleScope.set("fill");
    expect(e.sampleStyle({ x: 240, y: 60 })).toBe(true);
    expect(e.selected()!.fill).toBe("#ff004480");
    expect(e.selected()!.stroke).toBe("#000000"); expect(e.selected()!.strokeWidth).toBe(2); expect(e.selected()!.strokeStyle).toBeUndefined();
    expect(e.sampleStyle({ x: 1000, y: 1000 })).toBe(false);
  });
});
describe("style paint bucket", () => {
  it("edits alignment across a mixed selection without overwriting each layer's cap and join", () => {
    const e = setup(); e.selectAll();
    const before = structuredClone(e.document());
    e.setStrokeStyle({ alignment: "inside" });
    expect(e.document().layers[0].strokeStyle).toEqual({ alignment: "inside", cap: "round", join: "round" });
    expect(e.document().layers[1].strokeStyle).toEqual({ alignment: "inside", cap: "square", join: "miter" });
    e.undo(); expect(e.document()).toEqual(before);
  });
  it("applies stroke scope to a group as one reversible edit", () => {
    const e = setup();
    e.document.update(doc => ({ ...doc, layers: doc.layers.map(item => ({ ...item, groupPath: ["group"] })) }));
    e.styleScope.set("stroke"); e.stroke.set("#12345680"); e.size.set(8); e.strokeStyle.set(style);
    const before = structuredClone(e.document());
    e.setTool("paintBucket"); e.start({ x: 40, y: 60 }); e.end();
    expect(e.document().layers.every(item => item.stroke === "#12345680" && item.strokeWidth === 8 && item.strokeStyle?.alignment === "outside")).toBe(true);
    expect(e.document().layers[0].fill).toBe(before.layers[0].fill);
    expect(e.document().layers[1].fill).toBe(before.layers[1].fill);
    expect(e.selectedIds()).toEqual(["target", "source"]);
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
    e.undo(); expect(e.document()).toEqual(before);
  });
  it("does not paint through a locked topmost object or partially modify a locked group", () => {
    const e = setup(); e.toggle("target", "locked"); e.fill.set("none");
    const before = structuredClone(e.document());
    expect(e.applyStyleAt({ x: 40, y: 60 })).toBe(false); expect(e.document()).toEqual(before);
    e.document.update(doc => ({ ...doc, layers: doc.layers.map(item => ({ ...item, groupPath: ["group"] })) }));
    expect(e.applyStyleAt({ x: 240, y: 60 })).toBe(false);
    expect(e.document().layers[1].fill).toBe("#ff004480");
  });
  it("never creates objects on misses and keeps guide metadata unchanged", () => {
    const e = setup();
    const id = e.beginGuideDrag("vertical", 500)!; e.endGuideDrag(true);
    const before = structuredClone(e.document());
    e.setTool("paintBucket"); e.start({ x: 500, y: 500 }); e.end();
    e.setTool("eyedropper"); e.start({ x: 500, y: 500 }); e.end();
    expect(e.document()).toEqual(before); expect(e.document().layers.at(-1)?.id).toBe(id);
  });
  it("new shapes and Bézier paths inherit the current stroke style", () => {
    const e = setup(); e.selectedIds.set([]); e.selectedId.set(null); e.setStrokeStyle(style);
    e.setTool("rectangle"); e.start({ x: 400, y: 100 }); e.move({ x: 480, y: 180 }); e.end();
    expect(e.selected()!.strokeStyle).toEqual(style);
    e.setTool("pen"); e.start({ x: 400, y: 250 }); e.end();
    expect(e.selected()!.strokeStyle).toEqual(style);
  });
});
describe("style tool shortcut migration", () => {
  it("adds defaults to older maps and preserves user bindings that already use I or K", () => {
    const old = defaultShortcuts(); delete old["tool.eyedropper"]; delete old["tool.paintBucket"];
    expect(validateShortcuts(old)["tool.eyedropper"]).toEqual(["I"]);
    old["tool.pen"] = ["I"]; old["tool.rectangle"] = ["K"];
    const migrated = validateShortcuts(old);
    expect(migrated["tool.pen"]).toEqual(["I"]); expect(migrated["tool.rectangle"]).toEqual(["K"]);
    expect(migrated["tool.eyedropper"]).toEqual([]); expect(migrated["tool.paintBucket"]).toEqual([]);
  });
  it("continues rejecting explicitly configured collisions", () => {
    const bindings = defaultShortcuts(); bindings["tool.pen"] = ["I"];
    expect(() => validateShortcuts(bindings)).toThrow(/collision/);
  });
});
