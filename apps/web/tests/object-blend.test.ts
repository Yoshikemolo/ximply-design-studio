// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it } from "vitest";
import { EditorService } from "../src/app/editor.service";
import { newLayer, parseDocument } from "../../../packages/domain/src/document";
const shape = (id: string, x: number) => ({ ...newLayer("rectangle", id, { x, y: 50 }), width: 50, height: 50, fill: x ? "#ffffff" : "#000000" });
function setup() { const e = new EditorService(); e.document.update(doc => ({ ...doc, layers: [shape("back", 0), shape("front", 200)] })); e.selectAll(); return e; }
beforeEach(() => localStorage.clear());
describe("live object blends", () => {
  it("creates evenly spaced editable intermediates and updates endpoints with one undo", () => {
    const e = setup(), original = structuredClone(e.document());
    expect(e.canCreateBlend()).toBe(true); expect(e.createBlend(3)).toBe(true);
    expect(e.document().layers.map(layer => layer.x)).toEqual([0, 50, 100, 150, 200]);
    const blend = e.selectedBlend()!;
    e.selectBlendEndpoint("front"); e.updateLayer({ x: 400 });
    expect(e.document().layers.map(layer => layer.x)).toEqual([0, 100, 200, 300, 400]);
    expect(e.selectedBlend()?.id).toBe(blend.id);
    e.undo(); expect(e.document().layers.map(layer => layer.x)).toEqual([0, 50, 100, 150, 200]);
    e.undo(); expect(e.document()).toEqual(original);
  });
  it("changes progression and count, retaining stable old identities and undo", () => {
    const e = setup(); e.createBlend(3); const old = structuredClone(e.document());
    const first = e.selectedBlend()!.stepIds[0][0];
    expect(e.updateBlend({ steps: 1, easing: "ease-in" })).toBe(true);
    expect(e.document().layers.map(layer => layer.x)).toEqual([0, 50, 200]);
    expect(e.selectedBlend()!.stepIds[0][0]).toBe(first);
    e.undo(); expect(e.document()).toEqual(old);
  });
  it("blends two sibling groups inside a parent and preserves nesting after parent ungroup", () => {
    const e = setup();
    e.document.update(doc => ({ ...doc, layers: [shape("a", 0), shape("b", 20), shape("c", 200), shape("d", 220)].map((layer, index) => ({ ...layer, groupPath: ["parent", index < 2 ? "backGroup" : "frontGroup"] })) }));
    e.selectAll(); expect(e.createBlend(2)).toBe(true);
    expect(e.document().layers).toHaveLength(8);
    const blend = e.selectedBlend()!;
    expect(blend.backIds).toEqual(["a", "b"]); expect(blend.frontIds).toEqual(["c", "d"]);
    expect(e.document().layers.every(layer => layer.groupPath?.[0] === "parent")).toBe(true);
    e.group(true); expect(e.document().blends).toHaveLength(1);
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
  });
  it("duplicates a live blend with independent references and releases only the copy", () => {
    const e = setup(); e.createBlend(2); const original = e.selectedBlend()!;
    e.duplicate(); expect(e.document().blends).toHaveLength(2);
    const copy = e.selectedBlend()!; expect(copy.id).not.toBe(original.id);
    expect(copy.backIds.some(id => original.backIds.includes(id))).toBe(false);
    expect(e.releaseBlend()).toBe(true);
    expect(e.document().blends).toHaveLength(1); expect(e.document().blends![0].id).toBe(original.id);
    expect(e.document().layers).toHaveLength(6);
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
  });
  it("expands before editing derived geometry and preserves that edit with undo", () => {
    const e = setup(); e.createBlend(1); const generated = e.selectedBlend()!.stepIds[0][0];
    e.selectLayerExact(generated); e.updateLayer({ x: 123 });
    expect(e.document().blends).toHaveLength(0);
    expect(e.document().layers.find(layer => layer.id === generated)!.x).toBe(123);
    expect(e.status()).toContain("expanded");
    e.undo(); expect(e.document().blends).toHaveLength(1);
  });
  it("expands surviving artwork coherently when an endpoint is deleted", () => {
    const e = setup(); e.createBlend(2); e.selectBlendEndpoint("front"); e.remove();
    expect(e.document().blends).toHaveLength(0); expect(e.document().layers).toHaveLength(3);
    expect(e.status()).toContain("endpoints changed");
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
    e.undo(); expect(e.document().blends).toHaveLength(1);
  });
  it("blocks endpoint and configuration mutation if any blend member is locked", () => {
    const e = setup(); e.createBlend(2); const blend = e.selectedBlend()!;
    e.toggle(blend.stepIds[0][0], "locked");
    expect(e.document().layers.find(layer => layer.id === blend.stepIds[0][0])!.locked).toBe(true);
    e.selectBlendEndpoint("front"); const before = structuredClone(e.document());
    e.updateLayer({ x: 999 }); expect(e.updateBlend({ steps: 4 })).toBe(false);
    e.transformBy(90); e.remove(); expect(e.document()).toEqual(before);
  });
  it("previews drag interpolation without changing the document or losing metadata", () => {
    const e = setup(); e.createBlend(1); e.selectBlendEndpoint("front");
    // Inside the endpoint but clear of the pivot mark and of the resize handles.
    e.start({ x: 212, y: 62 }); e.move({ x: 312, y: 62 });
    const beforePreview = structuredClone(e.document());
    expect(e.previewDocument().layers[1].x).toBe(150);
    expect(e.document()).toEqual(beforePreview); expect(e.document().blends).toHaveLength(1);
    e.cancel(); expect(e.document().layers[1].x).toBe(100);
  });
  it("enforces layer and nesting bounds without leaving a partial transaction", () => {
    const e = setup();
    expect(e.createBlend(101)).toBe(false); expect(e.document().layers).toHaveLength(2);
    e.document.update(doc => ({ ...doc, layers: doc.layers.map(layer => ({ ...layer, groupPath: Array.from({ length: 15 }, (_, index) => "group" + index) })) }));
    expect(e.canCreateBlend()).toBe(false); expect(e.createBlend(1)).toBe(false);
  });
  it("expands to ordinary grouped paths while release restores original endpoints", () => {
    const e = setup(); e.createBlend(2); const before = structuredClone(e.document());
    expect(e.expandBlend()).toBe(true); expect(e.document().blends).toHaveLength(0);
    expect(e.document().layers).toEqual(before.layers);
    e.undo(); expect(e.releaseBlend()).toBe(true);
    expect(e.document().layers.map(layer => layer.id)).toEqual(["back", "front"]);
    expect(e.document().layers.every(layer => !layer.groupPath?.length)).toBe(true);
  });
});
describe("blending gradients between objects", () => {
  it("fades the gradient of one end into the flat fill of the other across the steps", () => {
    const e = new EditorService();
    const fade = { kind: "gradient" as const, type: "linear" as const, angle: 0, stops: [{ color: "#ff0000", location: 0, midpoint: 50 }, { color: "#0000ff", location: 100, midpoint: 50 }] };
    e.document.update(doc => ({ ...doc, version: 2, layers: [{ ...shape("back", 0), fill: "#ff0000", fillPaint: fade }, shape("front", 200)] }));
    e.selectAll();
    expect(e.createBlend(3)).toBe(true);
    const steps = e.document().layers.slice(1, 4);
    expect(steps.map(layer => layer.fillPaint?.kind)).toEqual(["gradient", "gradient", "gradient"]);
    // The middle step is half way from red and blue to the white of the front end.
    expect(steps[1].fillPaint!.kind === "gradient" && steps[1].fillPaint!.stops.map(stop => stop.color)).toEqual(["#ff8080", "#8080ff"]);
    expect(() => parseDocument(JSON.stringify(e.document()))).not.toThrow();
  });
});
