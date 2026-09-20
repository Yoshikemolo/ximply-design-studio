// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it } from "vitest";
import { EditorService, type ContextAction, type ContextTarget } from "../src/app/editor.service";
import { newLayer, parseDocument } from "../../../packages/domain/src/document";
import { anchor, worldPoint } from "../../../packages/domain/src/curves";
const layer = (id: string, groupPath?: string[]) => ({ ...newLayer("rectangle", id, { x: 0, y: 0 }), width: 100, height: 100, ...(groupPath ? { groupPath } : {}) });
function setup() {
  const e = new EditorService();
  e.document.update((doc) => ({ ...doc, layers: [layer("outsideBack"), layer("a", ["outer"]), layer("b", ["outer", "inner"]), layer("c", ["outer", "inner"]), layer("d", ["outer"]), layer("outsideFront")] }));
  return e;
}
const ids = (e: EditorService) => e.document().layers.map((item) => item.id);
const action = (e: EditorService, id: string, command: ContextAction, grouped = false) => e.runContextAction(e.contextForLayer(id, grouped)!, command);
function curve() {
  const e = new EditorService();
  const item = { ...newLayer("path", "curve", { x: 25, y: 40 }), width: 90, height: 90, rotation: 30, curves: [{ closed: false, nodes: [anchor({ x: 0, y: 0 }), anchor({ x: 30, y: 30 }), anchor({ x: 90, y: 30 })] }] };
  e.document.update((doc) => ({ ...doc, layers: [item] })); e.selectLayer(item.id);
  return e;
}
const nodeTarget = (e: EditorService, index = 1): ContextTarget => ({ kind: "node", layerId: "curve", path: 0, index, revision: e.revision() });
beforeEach(() => localStorage.clear());
describe("object context actions", () => {
  it("moves a child only within its parent, one undo at a time", () => {
    const e = setup(), before = structuredClone(e.document());
    expect(action(e, "b", "toFront")).toBe(true);
    expect(ids(e)).toEqual(["outsideBack", "a", "c", "b", "d", "outsideFront"]);
    expect(action(e, "b", "forward")).toBe(false);
    e.undo(); expect(e.document()).toEqual(before);
    e.redo(); expect(ids(e)[3]).toBe("b");
  });
  it("moves a selected subgroup intact among siblings without escaping the parent", () => {
    const e = setup();
    e.selectedIds.set(["b", "c"]); e.selectedId.set("b");
    const target = e.contextForLayer("b")!;
    expect(target).toMatchObject({ kind: "object", groupPath: ["outer", "inner"] });
    expect(e.runContextAction(target, "toFront")).toBe(true);
    expect(ids(e)).toEqual(["outsideBack", "a", "d", "b", "c", "outsideFront"]);
    expect(e.document().layers.find(item => item.id === "b")?.groupPath).toEqual(["outer", "inner"]);
    e.selectedIds.set(["b", "c"]); e.selectedId.set("b");
    expect(e.runContextAction(e.contextForLayer("b")!, "forward")).toBe(false);
  });
  it("moves the outer group as one root sibling block", () => {
    const e = setup();
    expect(action(e, "a", "toBack", true)).toBe(true);
    expect(ids(e)).toEqual(["a", "b", "c", "d", "outsideBack", "outsideFront"]);
    expect(action(e, "a", "toFront", true)).toBe(true);
    expect(ids(e)).toEqual(["outsideBack", "outsideFront", "a", "b", "c", "d"]);
  });
  it("hides a group, shows hidden members from Layers, and deletes it in one undo", () => {
    const e = setup();
    action(e, "a", "hide", true);
    expect(e.document().layers.slice(1, 5).every(item => !item.visible)).toBe(true);
    action(e, "a", "show", true);
    expect(e.document().layers.every(item => item.visible)).toBe(true);
    const before = structuredClone(e.document());
    action(e, "a", "delete", true); expect(ids(e)).toEqual(["outsideBack", "outsideFront"]);
    e.undo(); expect(e.document()).toEqual(before);
  });
  it("allows visibility but prevents destructive changes to locked groups and rejects stale targets", () => {
    const e = setup(); e.toggle("c", "locked");
    const target = e.contextForLayer("a")!;
    // Showing or hiding the bounding box changes no artwork, so it stays available.
    expect(e.contextActions(target).filter(item => item.enabled).map(item => item.id)).toEqual(["toggleBoundingBox", "hide"]);
    expect(e.runContextAction(target, "delete")).toBe(false);
    expect(e.runContextAction(target, "hide")).toBe(true);
    expect(e.runContextAction(target, "show")).toBe(false);
  });
});
describe("Bézier context operations", () => {
  it("prioritizes the visible selected node with no geometry mutation or history entry", () => {
    const e = curve(), before = structuredClone(e.document());
    const point = worldPoint(e.selected()!, e.selected()!.curves![0].nodes[1].point);
    expect(e.contextAt(point)).toMatchObject({ kind: "node", path: 0, index: 1 });
    expect(e.activeNodes()).toEqual(["0:1"]);
    expect(e.document()).toEqual(before);
  });
  it("expands one handle along the neighbor tangent and preserves the opposite world position", () => {
    const e = curve(), original = structuredClone(e.selected()!);
    expect(e.runContextAction(nodeTarget(e), "expandOutgoing")).toBe(true);
    const result = e.selected()!, node = result.curves![0].nodes[1];
    const worldOpposite = worldPoint(result, node.incoming);
    const oldOpposite = worldPoint(original, original.curves![0].nodes[1].incoming);
    expect(worldOpposite.x).toBeCloseTo(oldOpposite.x, 8); expect(worldOpposite.y).toBeCloseTo(oldOpposite.y, 8);
    expect(Math.hypot(node.outgoing.x - node.point.x, node.outgoing.y - node.point.y)).toBeCloseTo(20);
    expect(node.smooth).toBe(false);
    e.undo(); expect(e.selected()).toEqual(original);
  });
  it("smooths both handles, collapses only the requested one and preserves native roundtrip", () => {
    const e = curve(); e.runContextAction(nodeTarget(e), "smooth");
    let node = e.selected()!.curves![0].nodes[1];
    expect(node.smooth).toBe(true);
    const incoming = { x: node.incoming.x - node.point.x, y: node.incoming.y - node.point.y };
    const outgoing = { x: node.outgoing.x - node.point.x, y: node.outgoing.y - node.point.y };
    expect(incoming.x * outgoing.y - incoming.y * outgoing.x).toBeCloseTo(0);
    expect(incoming.x * outgoing.x + incoming.y * outgoing.y).toBeLessThan(0);
    const opposite = worldPoint(e.selected()!, node.outgoing);
    e.runContextAction(nodeTarget(e), "collapseIncoming"); node = e.selected()!.curves![0].nodes[1];
    expect(node.incoming).toEqual(node.point); expect(node.smooth).toBe(false);
    const after = worldPoint(e.selected()!, node.outgoing);
    expect(after.x).toBeCloseTo(opposite.x, 8); expect(after.y).toBeCloseTo(opposite.y, 8);
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
  });
  it("rejects stale node indices after deletion and removes the final empty path cleanly", () => {
    const e = curve(), stale = nodeTarget(e);
    e.runContextAction(stale, "deleteNode");
    expect(e.runContextAction(stale, "deleteNode")).toBe(false);
    expect(e.selected()!.curves![0].nodes).toHaveLength(2);
    e.runContextAction(nodeTarget(e, 0), "deleteNode");
    e.runContextAction(nodeTarget(e, 0), "deleteNode");
    expect(e.document().layers).toHaveLength(0);
    e.undo(); expect(e.document().layers[0].curves![0].nodes).toHaveLength(1);
  });
  it("does not expose node commands for guides or allow locked node edits", () => {
    const e = curve(); e.toggle("curve", "locked");
    expect(e.contextActions(nodeTarget(e)).every(item => !item.enabled)).toBe(true);
    expect(e.runContextAction(nodeTarget(e), "deleteNode")).toBe(false);
    const id = e.beginGuideDrag("vertical", 50)!; e.endGuideDrag(true);
    expect(e.contextActions({ ...nodeTarget(e), layerId: id })).toEqual([]);
  });
});
