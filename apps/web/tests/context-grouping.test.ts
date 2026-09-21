// @vitest-environment happy-dom
import "@angular/compiler";
import { describe, expect, it } from "vitest";
import { EditorService } from "../src/app/editor.service";
import { newLayer, parseDocument } from "../../../packages/domain/src/document";
function setup() {
  const editor = new EditorService();
  editor.document.update(doc => ({ ...doc, layers: ["a", "b", "c", "d", "e"].map(id => newLayer("rectangle", id, { x: 0, y: 0 })) }));
  return editor;
}
function select(editor: EditorService, ids: string[]) { editor.selectedIds.set(ids); editor.selectedId.set(ids.at(-1)!); }
describe("contextual grouping", () => {
  it("preserves multiple selection on right click, groups and undoes atomically", () => {
    const e = setup(); select(e, ["a", "b"]);
    const before = structuredClone(e.document()), target = e.contextForLayer("a")!;
    expect(e.selectedIds()).toEqual(["a", "b"]);
    expect(e.contextActions(target).find(action => action.id === "group")?.enabled).toBe(true);
    expect(e.runContextAction(target, "group")).toBe(true);
    expect(e.document().layers[0].groupPath).toEqual(e.document().layers[1].groupPath);
    e.undo(); expect(e.document()).toEqual(before);
  });
  it("ungroups every selected group without touching ungrouped objects", () => {
    const e = setup();
    e.document.update(doc => ({ ...doc, layers: doc.layers.map((layer, index) => ({ ...layer, ...(index < 4 ? { groupPath: [index < 2 ? "first" : "second"] } : {}) })) }));
    select(e, ["a", "b", "c", "d", "e"]);
    const untouched = e.document().layers[4];
    const target = e.contextForLayer("a")!;
    expect(e.contextActions(target).filter(action => ["group", "ungroup"].includes(action.id)).every(action => action.enabled)).toBe(true);
    e.runContextAction(target, "ungroup");
    expect(e.document().layers.slice(0, 4).every(layer => layer.groupPath?.length === 0)).toBe(true);
    expect(e.document().layers[4]).toBe(untouched);
  });
  it("regroups from one member preserving edits and nested membership across save/load", () => {
    const e = setup();
    e.document.update(doc => ({ ...doc, layers: doc.layers.map((layer, index) => ({ ...layer, ...(index < 3 ? { groupPath: index < 2 ? ["outer", "inner"] : ["outer"] } : {}) })) }));
    select(e, ["a", "b", "c"]); e.group(true);
    e.document.update(doc => ({ ...doc, layers: doc.layers.map(layer => layer.id === "a" ? { ...layer, x: 77, fill: "#FF0000" } : layer) }));
    e.document.set(parseDocument(JSON.stringify(e.document())));
    select(e, ["c"]); const target = e.contextForLayer("c", false)!;
    expect(e.runContextAction(target, "regroup")).toBe(true);
    expect(e.document().layers[0]).toMatchObject({ x: 77, fill: "#FF0000", groupPath: ["outer", "inner"] });
    expect(e.document().layers[2].groupPath).toEqual(["outer"]);
    e.undo(); expect(e.document().layers[2].regroupPath).toEqual(["outer"]);
  });
  it("does not silently regroup locked or newly grouped members", () => {
    const e = setup(); select(e, ["a", "b"]); e.group(); e.group(true);
    e.document.update(doc => ({ ...doc, layers: doc.layers.map(layer => layer.id === "b" ? { ...layer, locked: true } : layer) }));
    select(e, ["a"]); const target = e.contextForLayer("a", false)!;
    expect(e.contextActions(target).find(action => action.id === "regroup")?.enabled).toBe(false);
    expect(e.runContextAction(target, "regroup")).toBe(false);
  });
  it("ungroups only a selected nested group and regroups it without losing its parent", () => {
    const e = setup();
    e.document.update(doc => ({ ...doc, layers: doc.layers.map((layer, index) => ({ ...layer, ...(index < 3 ? { groupPath: index < 2 ? ["outer", "inner"] : ["outer"] } : {}) })) }));
    select(e, ["a", "b"]); const target = e.contextForLayer("a")!;
    expect(e.runContextAction(target, "ungroup")).toBe(true);
    expect(e.document().layers.slice(0, 3).map(layer => layer.groupPath)).toEqual([["outer"], ["outer"], ["outer"]]);
    select(e, ["a"]); e.regroup();
    expect(e.document().layers.slice(0, 3).map(layer => layer.groupPath)).toEqual([["outer", "inner"], ["outer", "inner"], ["outer"]]);
  });

  it("wraps a selected nested group without pulling in its parent siblings", () => {
    const e = setup();
    e.document.update(doc => ({ ...doc, layers: doc.layers.map((layer, index) => ({ ...layer, ...(index < 3 ? { groupPath: index < 2 ? ["outer", "inner"] : ["outer"] } : {}) })) }));
    select(e, ["a", "b"]);
    expect(e.runContextAction(e.contextForLayer("a")!, "group")).toBe(true);
    expect(e.document().layers[0].groupPath?.[0]).toBe("outer");
    expect(e.document().layers[0].groupPath?.[2]).toBe("inner");
    expect(e.document().layers[2].groupPath).toEqual(["outer"]);
  });

});
