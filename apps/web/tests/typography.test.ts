// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { EditorService } from "../src/app/editor.service";
import { newLayer, parseDocument } from "../../../packages/domain/src/document";
import { defaultTypography, textFont } from "../../../packages/domain/src/text-layout";
function setup() {
  const e = new EditorService();
  const context = createCanvas(1, 1).getContext("2d");
  e.renderer.measureText = (text, size, typography) => { context.font = textFont(size, typography); return context.measureText(text).width; };
  const text = { ...newLayer("text", "text", { x: 40, y: 50 }), text: "Words have measured widths", fontSize: 24, width: 150, height: 90 };
  e.document.update((doc) => ({ ...doc, layers: [text] })); e.selectLayer("text");
  return e;
}
beforeEach(() => localStorage.clear());
describe("text layout transactions", () => {
  it("resizes content from actual font metrics and undoes text plus dimensions together", () => {
    const e = setup(); e.updateTextLayout({ sizing: "content" });
    const expected = e.renderer.measureText(e.selected()!.text, 24, defaultTypography);
    expect(e.selected()!.width).toBeCloseTo(expected, 4);
    expect(e.selected()!.height).toBeCloseTo(28.8);
    const before = structuredClone(e.selected());
    e.updateLayer({ text: "Short" });
    expect(e.selected()!.width).toBeCloseTo(e.renderer.measureText("Short", 24, defaultTypography), 4);
    e.undo(); expect(e.selected()).toEqual(before);
    e.redo(); expect(e.selected()!.text).toBe("Short");
  });
  it("makes fit and auto sizing exclusive, preserving the base font size", () => {
    const e = setup(); e.updateTextLayout({ sizing: "content", wrap: true });
    expect(e.selected()!.textLayout).toMatchObject({ sizing: "content", wrap: false, fit: false });
    e.updateLayer({ width: 60, height: 20 });
    e.updateTextLayout({ fit: true, wrap: true });
    expect(e.selected()!.textLayout).toMatchObject({ sizing: "fixed", fit: true, wrap: true });
    e.updateLayer({ width: 60, height: 20 });
    expect(e.textMetrics(e.selected()!).fontSize).toBeLessThan(24);
    expect(e.selected()!.fontSize).toBe(24);
    e.updateTextLayout({ sizing: "height" });
    expect(e.selected()!.textLayout?.fit).toBe(false);
  });
  it("auto height wraps without changing the width or source text", () => {
    const e = setup(); const source = e.selected()!.text;
    e.updateTextLayout({ sizing: "height", wrap: true, hyphenate: true });
    expect(e.selected()!.width).toBe(150);
    expect(e.selected()!.height).toBeGreaterThan(28.8);
    expect(e.selected()!.text).toBe(source);
    e.updateTextLayout({ sizing: "width" });
    expect(e.selected()!.textLayout?.wrap).toBe(false);
  });
  it("previews inline drafts without mutating document or adding history", () => {
    const e = setup(); e.updateTextLayout({ sizing: "content" });
    const before = structuredClone(e.document());
    const commit = vi.spyOn(e.history, "commit");
    const preview = e.previewText(e.selected()!, "A longer inline draft now in progress");
    expect(preview.width).toBeGreaterThan(e.selected()!.width);
    expect(e.document()).toEqual(before); expect(commit).not.toHaveBeenCalled();
  });
});
describe("typography updates", () => {
  it("updates multiple unlocked text layers in one undo and ignores artwork and locked text", () => {
    const e = setup();
    e.document.update((doc) => ({ ...doc, layers: [...doc.layers, { ...doc.layers[0], id: "second" }, { ...doc.layers[0], id: "locked", locked: true }, newLayer("rectangle", "shape", { x: 0, y: 0 })] }));
    e.selectedIds.set(["text", "second", "locked", "shape"]); e.selectedId.set("text");
    const before = structuredClone(e.document());
    e.updateTypography({ fontFamily: "Georgia", fontWeight: 700, fontStyle: "italic", decoration: "underline" });
    expect(e.document().layers.slice(0, 2).every(layer => layer.typography?.fontFamily === "Georgia")).toBe(true);
    expect(e.document().layers[2].typography).toBeUndefined();
    expect(e.document().layers[3].typography).toBeUndefined();
    e.undo(); expect(e.document()).toEqual(before);
  });
  it("reflows scales and spacing with independent numeric geometry oracles", () => {
    const e = setup(); e.updateLayer({ text: "AB CD\nEF" }); e.updateTextLayout({ sizing: "content" });
    const measured = e.renderer.measureText("AB CD", 24, defaultTypography);
    e.updateTypography({ letterSpacing: 2, wordSpacing: 5, paragraphSpacing: 8, lineHeight: 30, horizontalScale: 1.5, verticalScale: 2 });
    expect(e.selected()!.width).toBeCloseTo((measured + 4 * 2 + 5) * 1.5, 4);
    expect(e.selected()!.height).toBeCloseTo((30 * 2 + 8) * 2);
    expect(parseDocument(JSON.stringify(e.document()))).toEqual(e.document());
  });
  it("reflows font size without scaling base dimensions twice and rejects invalid values", () => {
    const e = setup(); e.updateTextLayout({ sizing: "width" });
    e.updateTextFontSize(48);
    expect(e.selected()!.width).toBeCloseTo(e.renderer.measureText(e.selected()!.text, 48, defaultTypography), 4);
    expect(e.selected()!.height).toBe(90);
    const before = structuredClone(e.document());
    e.updateTextFontSize(NaN); e.updateTypography({ fontWeight: 450 }); e.updateTypography({ horizontalScale: 0 });
    expect(e.document()).toEqual(before);
  });
  it("preserves legacy missing metadata until typography is explicitly configured", () => {
    const e = setup(); e.updateLayer({ text: "Legacy fixed text" });
    expect(e.selected()!.textLayout).toBeUndefined(); expect(e.selected()!.typography).toBeUndefined();
    expect(e.selected()!.width).toBe(150); expect(e.selected()!.height).toBe(90);
    e.updateTypography({ align: "right" });
    expect(e.selected()!.typography).toEqual({ ...defaultTypography, align: "right" });
    expect(e.selected()!.textLayout?.sizing).toBe("fixed");
  });
});

describe("auto text sizing through transforms", () => {
  it("reflows auto height after pointer resizing the width and undoes the whole change", () => {
    const e = setup(); e.updateTextLayout({ sizing: "height", wrap: true });
    const before = structuredClone(e.selected()!);
    e.start({ x: before.x + before.width, y: before.y + before.height / 2 });
    e.move({ x: before.x + before.width / 2, y: before.y + before.height / 2 }); e.end();
    expect(e.selected()!.width).toBeCloseTo(75);
    expect(e.selected()!.height).toBeGreaterThan(before.height);
    expect(e.selected()!.height).toBeCloseTo(e.textMetrics(e.selected()!).height);
    e.undo(); expect(e.selected()).toEqual(before);
  });
  it("keeps content-sized text bounds consistent after a group transformation", () => {
    const e = setup(); e.updateTextLayout({ sizing: "content" });
    const width = e.selected()!.width, height = e.selected()!.height;
    e.document.update(doc => ({ ...doc, layers: [...doc.layers, newLayer("rectangle", "shape", { x: 300, y: 200 })] }));
    e.selectAll(); e.group();
    e.transformBy(0, 2);
    const text = e.document().layers.find(layer => layer.id === "text")!;
    expect(text.width).toBeCloseTo(width); expect(text.height).toBeCloseTo(height);
    expect(text.width).toBeCloseTo(e.textMetrics(text).width);
  });
});
