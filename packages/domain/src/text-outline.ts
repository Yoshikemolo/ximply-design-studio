import { CurvePath, anchor } from './curves';
import type { TextLayoutResult } from './text-layout';

/**
 * Places the outlines of a text as the drawing places its glyphs, so what is converted is
 * what was on the screen. The shapes of the glyphs come from the font file, which the shell
 * reads; this module only says where each one goes and what the decoration adds.
 */
export type GlyphPaths = (text: string, size: number, x: number, y: number) => CurvePath[];

const scalePath = (path: CurvePath, x: number, y: number): CurvePath => ({
  closed: path.closed,
  nodes: path.nodes.map((node) => ({
    point: { x: node.point.x * x, y: node.point.y * y },
    incoming: { x: node.incoming.x * x, y: node.incoming.y * y },
    outgoing: { x: node.outgoing.x * x, y: node.outgoing.y * y },
    smooth: node.smooth,
  })),
});
const rectangle = (x: number, y: number, width: number, height: number): CurvePath => ({
  closed: true,
  nodes: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }].map((point) => anchor(point)),
});
/** A letter with the contours it is made of: its outline and the holes inside it. */
export interface OutlinedGlyph {
  text: string;
  curves: CurvePath[];
}
/** The letters of one word, which the editor keeps together. */
export interface OutlinedWord {
  text: string;
  glyphs: OutlinedGlyph[];
}
export interface OutlinedText {
  words: OutlinedWord[];
  /** The bar of an underline or a strikethrough, one per line of text. */
  decoration: CurvePath[];
}
/**
 * The outlines of a laid-out text, letter by letter and word by word, in the coordinates
 * of its layer. A letter carries every contour it is made of, so its holes travel with it;
 * a word ends where a space or a line does.
 */
export function textOutlineGroups(layout: TextLayoutResult, glyphs: GlyphPaths): OutlinedText {
  const type = layout.typography;
  const horizontal = type.horizontalScale || 1, vertical = type.verticalScale || 1;
  const words: OutlinedWord[] = [];
  for (const line of layout.lines) {
    let word: OutlinedWord | null = null;
    for (const glyph of line.glyphs) {
      if (/^\s+$/.test(glyph.text)) { word = null; continue; }
      // The glyph is placed in the unscaled space and scaled with the text, as it is drawn.
      const paths = glyphs(glyph.text, layout.fontSize, glyph.x / horizontal, line.y / vertical)
        .filter((path) => path.nodes.length > 1)
        .map((path) => scalePath(path, horizontal, vertical));
      if (!paths.length) continue;
      if (!word) { word = { text: '', glyphs: [] }; words.push(word); }
      word.text += glyph.text;
      word.glyphs.push({ text: glyph.text, curves: paths });
    }
  }
  const decoration: CurvePath[] = [];
  if (type.decoration !== 'none') {
    const thickness = Math.max(1, layout.fontSize / 16) * vertical;
    for (const line of layout.lines) {
      const offset = type.decoration === 'underline' ? layout.fontSize * 0.12 : -layout.fontSize * 0.3;
      decoration.push(rectangle(line.x, line.y + offset * vertical, line.width, thickness));
    }
  }
  return { words, decoration };
}
/** Every contour of a text, flattened, for a caller that wants one shape. */
export function textOutlines(layout: TextLayoutResult, glyphs: GlyphPaths): CurvePath[] {
  const outlined = textOutlineGroups(layout, glyphs);
  return [...outlined.words.flatMap((word) => word.glyphs.flatMap((glyph) => glyph.curves)), ...outlined.decoration];
}
