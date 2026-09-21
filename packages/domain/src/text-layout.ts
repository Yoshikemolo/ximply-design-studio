/// <reference path="./hyphen.d.ts" />
import { hyphenateSync as hyphenateEnglish } from "hyphen/en-us";
import { hyphenateSync as hyphenateSpanish } from "hyphen/es";

export const FONT_FAMILIES = ["sans-serif", "serif", "monospace", "Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS"] as const;
export interface TextTypography {
  fontFamily: typeof FONT_FAMILIES[number];
  fontWeight: number;
  fontStyle: "normal" | "italic";
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  paragraphSpacing: number;
  horizontalScale: number;
  verticalScale: number;
  baselineShift: number;
  align: "left" | "center" | "right" | "justify";
  decoration: "none" | "underline" | "line-through";
  language: "en" | "es";
}
export interface TextLayoutOptions {
  sizing: "fixed" | "content" | "width" | "height";
  wrap: boolean;
  hyphenate: boolean;
  fit: boolean;
}
export const defaultTypography: Readonly<TextTypography> = {
  fontFamily: "sans-serif", fontWeight: 400, fontStyle: "normal", lineHeight: 0,
  letterSpacing: 0, wordSpacing: 0, paragraphSpacing: 0,
  horizontalScale: 1, verticalScale: 1, baselineShift: 0,
  align: "left", decoration: "none", language: "en",
};
export const defaultTextLayout: Readonly<TextLayoutOptions> = { sizing: "fixed", wrap: false, hyphenate: false, fit: false };
export type TextMeasurement = (text: string, fontSize: number, typography: TextTypography) => number;
export interface TextInput {
  text: string; fontSize: number; width: number; height: number;
  textLayout?: TextLayoutOptions; typography?: TextTypography;
}
export interface LayoutLine {
  text: string; x: number; y: number; width: number;
  glyphs: { text: string; x: number }[];
}
export interface TextLayoutResult {
  lines: LayoutLine[]; fontSize: number; width: number; height: number;
  contentWidth: number; contentHeight: number; overflow: boolean;
  typography: TextTypography;
}

/** Deterministic fallback for headless callers; visual exports should inject font metrics. */
export const approximateTextMeasurement: TextMeasurement = (text, size) => Array.from(text).length * size * 0.6;
/**
 * Faces the studio carries with it, so text looks the same on every machine and the
 * outlines of a text come from the very file that drew it. Each one has the metrics of
 * the family it stands for, so a document written before them keeps its lines.
 */
export const BUNDLED_FACES = {
  Arimo: { file: "arimo", stands: ["sans-serif", "Arial", "Verdana", "Trebuchet MS"] },
  Tinos: { file: "tinos", stands: ["serif", "Times New Roman", "Georgia"] },
  Cousine: { file: "cousine", stands: ["monospace", "Courier New"] },
} as const;
export type BundledFace = keyof typeof BUNDLED_FACES;
/** The carried face that draws a family, and whether it has the metrics of that family. */
export function bundledFace(family: string): { face: BundledFace; exact: boolean } {
  for (const [face, entry] of Object.entries(BUNDLED_FACES) as [BundledFace, { stands: readonly string[] }][]) {
    if (entry.stands.includes(family)) {
      return { face, exact: !["Georgia", "Verdana", "Trebuchet MS"].includes(family) };
    }
  }
  return { face: "Arimo", exact: false };
}
/** Name of the font file for a face at a weight and a style. */
export function faceFile(face: BundledFace, weight: number, style: string): string {
  return `${BUNDLED_FACES[face].file}-${weight >= 600 ? 700 : 400}-${style === "italic" ? "italic" : "normal"}.woff`;
}
export function textFont(size: number, typography: TextTypography): string {
  const family = typography.fontFamily.includes(" ") ? `"${typography.fontFamily}"` : typography.fontFamily;
  // The carried face is asked for first, so what is drawn is what will be outlined.
  return `${typography.fontStyle} ${typography.fontWeight} ${size}px ${bundledFace(typography.fontFamily).face}, ${family}`;
}
const visibleText = (text: string) => text.replace(/\u00ad/g, "");

/** Bounded layout of the native 2,000-character text payload, without mutating source text. */
export function layoutText(input: TextInput, measure: TextMeasurement = approximateTextMeasurement): TextLayoutResult {
  const typography = { ...defaultTypography, ...input.typography };
  const options = { ...defaultTextLayout, ...input.textLayout };
  const autoWidth = options.sizing === "content" || options.sizing === "width";
  const autoHeight = options.sizing === "content" || options.sizing === "height";
  const frameWidth = Math.max(1, input.width), frameHeight = Math.max(1, input.height);
  const source = input.text.slice(0, 2000).replace(/\r\n?/g, "\n");
  const paragraphs = (options.hyphenate
    ? (typography.language === "es" ? hyphenateSpanish(source) : hyphenateEnglish(source))
    : source).split("\n");
  const build = (fontSize: number): TextLayoutResult => {
    const metrics = new Map<string, number>();
    const measured = (text: string) => {
      if (!metrics.has(text)) metrics.set(text, measure(text, fontSize, typography));
      return metrics.get(text)!;
    };
    const geometry = (raw: string, extraSpace = 0) => {
      let prefix = "", spaces = 0;
      const glyphs = Array.from(visibleText(raw)).map((char, index) => {
        const x = (measured(prefix + char) - measured(char) + index * typography.letterSpacing + spaces * typography.wordSpacing) * typography.horizontalScale + spaces * extraSpace;
        prefix += char;
        if (char === " ") spaces++;
        return { text: char, x, width: measured(char) * typography.horizontalScale };
      });
      const left = Math.min(0, ...glyphs.map((glyph) => glyph.x));
      const right = Math.max(0, ...glyphs.map((glyph) => glyph.x + glyph.width));
      return { width: right - left, glyphs: glyphs.map((glyph) => ({ text: glyph.text, x: glyph.x - left })) };
    };
    const widths = new Map<string, number>();
    const widthOf = (raw: string) => {
      if (!widths.has(raw)) widths.set(raw, geometry(raw).width);
      return widths.get(raw)!;
    };
    const wrapped: { text: string; paragraphEnd: boolean }[] = [];
    for (const paragraph of paragraphs) {
      if (!options.wrap || autoWidth || !paragraph) {
        wrapped.push({ text: visibleText(paragraph), paragraphEnd: true });
        continue;
      }
      let remaining = Array.from(options.hyphenate ? paragraph : visibleText(paragraph));
      while (remaining.length) {
        const full = remaining.join("");
        if (widthOf(full) <= frameWidth) {
          wrapped.push({ text: visibleText(full), paragraphEnd: true });
          break;
        }
        let low = 1, high = remaining.length, count = 1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (widthOf(remaining.slice(0, middle).join("")) <= frameWidth) { count = middle; low = middle + 1; }
          else high = middle - 1;
        }
        let boundary = 0, hyphen = false;
        for (let index = 1; index <= count && index < remaining.length; index++) {
          if (/\s/.test(remaining[index])) { boundary = index; hyphen = false; }
          if (remaining[index - 1] === "\u00ad" && options.hyphenate && widthOf(remaining.slice(0, index).join("") + "-") <= frameWidth) {
            boundary = index; hyphen = true;
          }
        }
        const split = boundary || count;
        wrapped.push({ text: visibleText(remaining.slice(0, split).join("")).trimEnd() + (hyphen ? "-" : ""), paragraphEnd: false });
        remaining = remaining.slice(split);
        while (remaining.length && (/\s/.test(remaining[0]) || remaining[0] === "\u00ad")) remaining.shift();
        if (!remaining.length) wrapped[wrapped.length - 1].paragraphEnd = true;
      }
    }
    const contentWidth = Math.max(0, ...wrapped.map((line) => widthOf(line.text)));
    const width = autoWidth ? Math.min(16384, Math.max(1, contentWidth)) : frameWidth;
    const leading = (typography.lineHeight || fontSize * 1.2) * typography.verticalScale;
    let top = 0;
    const lines = wrapped.map((line, index) => {
      const naturalWidth = widthOf(line.text);
      const spaces = Array.from(line.text).filter((char) => char === " ").length;
      const justify = typography.align === "justify" && !line.paragraphEnd && spaces > 0;
      const extraSpace = justify ? Math.max(0, width - naturalWidth) / spaces : 0;
      const positioned = geometry(line.text, extraSpace);
      const lineWidth = positioned.width;
      const x = typography.align === "center" ? (width - lineWidth) / 2 : typography.align === "right" ? width - lineWidth : 0;
      const glyphs = positioned.glyphs.map((glyph) => ({ text: glyph.text, x: x + glyph.x }));
      const y = top + (fontSize * 0.8 - typography.baselineShift) * typography.verticalScale;
      top += leading;
      if (line.paragraphEnd && index < wrapped.length - 1) top += typography.paragraphSpacing * typography.verticalScale;
      return { text: line.text, x, y, width: lineWidth, glyphs };
    });
    const contentHeight = Math.max(top, ...lines.map((line) => line.y + fontSize * 0.2 * typography.verticalScale), 0);
    const height = autoHeight ? Math.min(16384, Math.max(1, contentHeight)) : frameHeight;
    const overflow = lines.some((line) => line.width > width + 0.001) || contentWidth > width + 0.001 || contentHeight > height + 0.001 || lines.some((line) => line.y - fontSize * 0.8 * typography.verticalScale < -0.001);
    return { lines, fontSize, width, height, contentWidth, contentHeight, overflow, typography };
  };
  let result = build(input.fontSize);
  if (options.fit && options.sizing === "fixed" && result.overflow) {
    let low = 1, high = input.fontSize;
    result = build(low);
    for (let iteration = 0; iteration < 18; iteration++) {
      const size = (low + high) / 2, candidate = build(size);
      if (candidate.overflow) high = size;
      else { low = size; result = candidate; }
    }
  }
  return result;
}
