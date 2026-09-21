import { describe, expect, it } from "vitest";
import { blankDocument, hitTest, newLayer, parseDocument, svgExport } from "../src/document";

describe("native paint and guide contracts", () => {
  it("round trips absent paints and guides without changing document coordinates", () => {
    const doc = blankDocument();
    doc.layers = [
      { ...newLayer("rectangle", "art", { x: 20, y: 30 }, "none", "none"), width: 50, height: 50 },
      { ...newLayer("path", "guide", { x: 45, y: 0 }), guide: "vertical" },
    ];
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    expect(hitTest(doc.layers[0], { x: 40, y: 50 })).toBe(true);
    expect(hitTest({ ...doc.layers[1], points: [{ x: 0, y: 0 }, { x: 0, y: 100 }] }, { x: 45, y: 50 })).toBe(false);
    expect(svgExport(doc)).toContain('fill="none" stroke="none"');
    expect(svgExport(doc)).not.toContain("polyline");
  });

  it("rejects malformed guide metadata and unsupported paint values", () => {
    for (const patch of [
      { guide: "diagonal" }, { guide: null }, { guide: "vertical", kind: "rectangle" },
      { guide: "vertical", groupPath: ["group"] }, { guide: "vertical", x: 100001 },
      { guide: "vertical", symbolId: "unknown" }, { fill: "transparent" }, { stroke: "red" },
    ]) {
      const doc = { ...blankDocument(), layers: [{ ...newLayer("path", "g", { x: 0, y: 0 }), ...patch }] };
      expect(() => parseDocument(JSON.stringify(doc))).toThrow();
    }
    expect(() => parseDocument(JSON.stringify({ ...blankDocument(), version: 1, layers: [newLayer("rectangle", "a", { x: 0, y: 0 }, "none")] }))).toThrow();
    const layer = { ...newLayer("path", "g", { x: 0, y: 0 }), guide: "horizontal" as const };
    expect(() => parseDocument(JSON.stringify({ ...blankDocument(), version: 1, layers: [layer] }))).toThrow();
    expect(() => parseDocument(JSON.stringify({ ...blankDocument(), symbols: [{ id: "symbol", name: "Guide", layer }] }))).toThrow();
  });

  it("preserves independent alpha paints and exports compatible SVG opacity", () => {
    const doc = { ...blankDocument(), layers: [newLayer("rectangle", "alpha", { x: 0, y: 0 }, "#ff000080", "#0000ff40", 4)] };
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    expect(svgExport(doc)).toContain(`fill="#ff0000" fill-opacity="${128 / 255}" stroke="#0000ff" stroke-opacity="${64 / 255}"`);
    // The page background is a paint of its own: native-v2 accepts alpha and absence.
    for (const background of ["#ffffff80", "none"]) {
      const page = { ...doc, background };
      expect(parseDocument(JSON.stringify(page))).toEqual(page);
      expect(() => parseDocument(JSON.stringify({ ...page, version: 1, layers: [{ ...doc.layers[0], fill: "#ff0000", stroke: "#0000ff" }] }))).toThrow();
    }
    for (const invalid of [
      { ...doc, version: 1 }, { ...doc, background: "#ffffffzz" },
      { ...doc, layers: [{ ...doc.layers[0], fill: "#fff8" }] },
      { ...doc, layers: [{ ...doc.layers[0], stroke: "#ff0000zz" }] },
    ]) expect(() => parseDocument(JSON.stringify(invalid))).toThrow();
  });

  it("exports text fill and outline independently", () => {
    const doc = { ...blankDocument(), layers: [newLayer("text", "text", { x: 0, y: 0 }, "none", "#ffffff", 3)] };
    expect(svgExport(doc)).toContain('font-family="sans-serif" fill="none" stroke="#ffffff" stroke-width="3"');
  });
});
