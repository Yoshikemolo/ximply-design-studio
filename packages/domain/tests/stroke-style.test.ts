import { describe, expect, it } from "vitest";
import { blankDocument, defaultStrokeStyle, hitTest, newLayer, parseDocument, svgExport } from "../src/document";

describe("native stroke style contract", () => {
  it("round trips all style values and symbols in native2", () => {
    for (const alignment of ["inside", "outside", "center"] as const)
      for (const join of ["round", "bevel", "miter"] as const)
        for (const cap of ["round", "square", "butt"] as const) {
          const layer = { ...newLayer("rectangle", "r", {x:30,y:30}), strokeStyle: {alignment,join,cap} };
          const doc = { ...blankDocument(), layers: [layer], symbols: [{ id:"s", name:"Style", layer }] };
          expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
          expect(svgExport(doc)).toContain(`stroke-linecap="${cap}" stroke-linejoin="${join}" stroke-miterlimit="10"`);
        }
  });
  it("rejects malformed style objects and native1 style metadata", () => {
    const layer = newLayer("path", "p", {x:0,y:0});
    for (const strokeStyle of [null, {}, { ...defaultStrokeStyle, alignment: "outer" }, { ...defaultStrokeStyle, cap: "project" }, { ...defaultStrokeStyle, join: "sharp" }, { ...defaultStrokeStyle, cap: ["round"] }, { ...defaultStrokeStyle, join: ["round"] }, { ...defaultStrokeStyle, alignment: ["center"] }, { ...defaultStrokeStyle, extra: 1 }]) {
      expect(() => parseDocument(JSON.stringify({ ...blankDocument(), layers:[{...layer,strokeStyle}] }))).toThrow();
    }
    expect(() => parseDocument(JSON.stringify({ ...blankDocument(), version:1, layers:[{...layer,strokeStyle:defaultStrokeStyle}] }))).toThrow();
  });
  it("retains legacy defaults and hits the visible outside outline", () => {
    const layer = { ...newLayer("rectangle", "r", {x:100,y:100}, "none", "#000000", 40), width:100,height:100 };
    expect(svgExport({...blankDocument(),layers:[layer]})).toContain('stroke-linecap="round" stroke-linejoin="round"');
    expect(hitTest(layer,{x:70,y:150})).toBe(false);
    expect(hitTest({...layer,strokeStyle:{...defaultStrokeStyle,alignment:"outside"}},{x:70,y:150})).toBe(true);
  });
  it("uses unique generated stroke regions and does not align open paths or live text", () => {
    const layer = { ...newLayer("rectangle", "arbitrary unsafe id", {x:0,y:0}),strokeStyle:{...defaultStrokeStyle,alignment:"inside" as const} };
    const svg = svgExport({...blankDocument(),layers:[layer,{...layer,id:"b"}]});
    expect(svg).toContain('id="stroke-region-0"');
    expect(svg).toContain('id="stroke-region-1"');
    expect(svg).not.toContain('arbitrary unsafe id');
    for (const kind of ["text","path"] as const) expect(svgExport({...blankDocument(),layers:[{...layer,kind}]})).not.toContain('clipPath');
  });
});
