import { describe, expect, it } from "vitest";
import { defaultTextLayout, defaultTypography, layoutText, TextInput, TextTypography, textFont } from "../src/text-layout";
import { blankDocument, newLayer, parseDocument, svgExport } from "../src/document";
const measure = (text: string, size: number) => Array.from(text).length * size;
const input = (patch: Partial<TextInput> = {}): TextInput => ({ text: "ab cd", fontSize: 10, width: 30, height: 100, ...patch });
const typography = (patch: Partial<TextTypography>) => ({ ...defaultTypography, ...patch });

describe("shared text layout", () => {
  it("preserves explicit newlines and legacy unwrapped overflow", () => {
    const result = layoutText(input({ text: "abc\n\nxy" }), measure);
    expect(result.lines.map((line) => line.text)).toEqual(["abc", "", "xy"]);
    expect(result.lines.map((line) => line.y)).toEqual([8, 20, 32]);
    expect(result.contentHeight).toBe(36);
    expect(layoutText(input(), measure).overflow).toBe(true);
    const empty = layoutText(input({ text: "" }), measure);
    expect(empty.lines).toHaveLength(1);
    expect(empty.contentWidth).toBe(0);
  });
  it("wraps words and emergency-splits long words without changing source", () => {
    const source = input({ text: "ab cd abcdef", textLayout: { ...defaultTextLayout, wrap: true } });
    expect(layoutText(source, measure).lines.map((line) => line.text)).toEqual(["ab", "cd", "abc", "def"]);
    expect(source.text).toBe("ab cd abcdef");
    expect(layoutText(input({ text: "😀😀", width: 5, textLayout: { ...defaultTextLayout, wrap: true } }), measure).lines.map((line) => line.text)).toEqual(["😀", "😀"]);
  });
  it("automatically hyphenates English and Spanish with language patterns", () => {
    for (const [language, text] of [["en", "representation"], ["es", "representación"]] as const) {
      const result = layoutText(input({ text, width: 70, typography: typography({ language }), textLayout: { ...defaultTextLayout, wrap: true, hyphenate: true } }), measure);
      expect(result.lines.some((line) => line.text.endsWith("-"))).toBe(true);
      expect(result.lines.map((line) => line.text.replace(/-$/, "")).join("")).toBe(text);
      expect(result.lines.every((line) => line.width <= 70)).toBe(true);
    }
  });
  it("supports discretionary hyphens while hiding unused soft hyphens", () => {
    const source = input({ text: "ab\u00adcd", width: 30, textLayout: { ...defaultTextLayout, wrap: true, hyphenate: true } });
    expect(layoutText(source, measure).lines.map((line) => line.text)).toEqual(["ab-", "cd"]);
    expect(layoutText({ ...source, width: 100 }, measure).lines[0].text).toBe("abcd");
  });
  it("auto sizes only the requested axes and fits fixed frames with bounded search", () => {
    for (const sizing of ["content", "width", "height"] as const) {
      const result = layoutText(input({ textLayout: { ...defaultTextLayout, sizing, wrap: true } }), measure);
      expect(result.width).toBe(sizing === "height" ? 30 : 50);
      expect(result.height).toBe(sizing === "width" ? 100 : sizing === "height" ? 24 : 12);
    }
    let calls = 0;
    const result = layoutText(input({ text: "abcdefghij", height: 10, textLayout: { ...defaultTextLayout, fit: true } }), (text, size) => { calls++; return measure(text, size); });
    expect(result.fontSize).toBeCloseTo(3, 3);
    expect(result.overflow).toBe(false);
    expect(calls).toBeLessThan(1000);
    expect(layoutText(input({ text: "abc", width: 1, height: 1, textLayout: { ...defaultTextLayout, fit: true } }), measure).overflow).toBe(true);
  });
  it("applies leading, paragraph spacing, glyph spacing, scale and baseline", () => {
    const result = layoutText(input({ text: "a b\nc", width: 100, typography: typography({ lineHeight: 20, paragraphSpacing: 5, letterSpacing: 2, wordSpacing: 3, horizontalScale: 2, verticalScale: 1.5, baselineShift: 1 }) }), measure);
    expect(result.lines[0].width).toBe(74);
    expect(result.lines[0].glyphs.map((glyph) => glyph.x)).toEqual([0, 24, 54]);
    expect(result.lines.map((line) => line.y)).toEqual([10.5, 48]);
    expect(result.contentHeight).toBe(67.5);
  });
  it("aligns centered, right and justified lines without justifying paragraph endings", () => {
    expect(layoutText(input({ text: "a", typography: typography({ align: "center" }) }), measure).lines[0].x).toBe(10);
    expect(layoutText(input({ text: "a", typography: typography({ align: "right" }) }), measure).lines[0].x).toBe(20);
    const result = layoutText(input({ text: "a b cc", width: 40, typography: typography({ align: "justify" }), textLayout: { ...defaultTextLayout, wrap: true } }), measure);
    expect(result.lines[0].width).toBe(40);
    expect(result.lines[0].glyphs[2].x).toBe(30);
    expect(result.lines[1].width).toBe(20);
  });
  it("bounds negative tracking and word spacing without hidden negative glyph positions", () => {
    const source = input({ text: "abc", typography: typography({ letterSpacing: -100 }), textLayout: { ...defaultTextLayout, sizing: "content" } });
    const result = layoutText(source, measure);
    expect(result.width).toBe(190);
    expect(result.lines[0].glyphs.map((glyph) => glyph.x)).toEqual([180, 90, 0]);
    expect(result.overflow).toBe(false);
    expect(layoutText({ ...source, textLayout: { ...defaultTextLayout }, width: 30 }, measure).overflow).toBe(true);
    const words = layoutText(input({ text: "a b", typography: typography({ wordSpacing: -100 }), textLayout: { ...defaultTextLayout, sizing: "content" } }), measure);
    expect(words.width).toBe(100);
    expect(words.lines[0].glyphs.every((glyph) => glyph.x >= 0 && glyph.x + 10 <= words.width)).toBe(true);
  });
  it("does not export decoration when neither text paint can draw", () => {
    const layer = { ...newLayer("text", "t", { x: 0, y: 0 }, "none", "#0000ff", 0), typography: typography({ decoration: "underline" }) };
    expect(svgExport({ ...blankDocument(), layers: [layer] }, measure)).not.toMatch(/<rect[^>]+fill="#0000ff"/);
  });

  it("formats the selected font and rejects malformed native typography", () => {
    expect(textFont(20, typography({ fontFamily: "Times New Roman", fontWeight: 700, fontStyle: "italic" }))).toBe('italic 700 20px Tinos, "Times New Roman"');
    const layer = { ...newLayer("text", "t", { x: 0, y: 0 }), typography: typography({}), textLayout: { ...defaultTextLayout } };
    const doc = { ...blankDocument(), layers: [layer] };
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    for (const patch of [{ typography: null }, { typography: {} }, { typography: typography({ fontWeight: 450 }) }, { typography: { ...typography({}), unexpected: true } }, { textLayout: { ...defaultTextLayout, fit: true, sizing: "content" } }, { kind: "rectangle" }]) {
      expect(() => parseDocument(JSON.stringify({ ...doc, layers: [{ ...layer, ...patch }] }))).toThrow();
    }
    expect(() => parseDocument(JSON.stringify({ ...doc, version: 1 }))).toThrow();
  });
  it("exports the same glyph layout, selected font, decoration and explicit clip", () => {
    const layer = { ...newLayer("text", "t", { x: 0, y: 0 }, "#000000", "none"), text: "ab cd", fontSize: 10, width: 30, height: 30, typography: typography({ fontFamily: "Georgia", decoration: "underline" }), textLayout: { ...defaultTextLayout, wrap: true } };
    const svg = svgExport({ ...blankDocument(), layers: [layer] }, measure);
    expect(svg).toContain('clip-path="url(#text-frame-0)"');
    expect(svg).toContain('font-family="Georgia"');
    expect(svg).toContain('<tspan x="0" y="20">c</tspan>');
    expect(svg).toContain('width="20" height="1"');
  });
});
