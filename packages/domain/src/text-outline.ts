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
/**
 * The outlines of every glyph of a laid-out text, in the coordinates of its layer, with the
 * underline or the strikethrough as the bars they are drawn as.
 */
export function textOutlines(layout: TextLayoutResult, glyphs: GlyphPaths): CurvePath[] {
  const type = layout.typography;
  const horizontal = type.horizontalScale || 1, vertical = type.verticalScale || 1;
  const curves: CurvePath[] = [];
  for (const line of layout.lines) {
    for (const glyph of line.glyphs) {
      // The glyph is placed in the unscaled space and scaled with the text, as it is drawn.
      const paths = glyphs(glyph.text, layout.fontSize, glyph.x / horizontal, line.y / vertical);
      for (const path of paths) if (path.nodes.length > 1) curves.push(scalePath(path, horizontal, vertical));
    }
  }
  if (type.decoration !== 'none') {
    const thickness = Math.max(1, layout.fontSize / 16) * vertical;
    for (const line of layout.lines) {
      const offset = type.decoration === 'underline' ? layout.fontSize * 0.12 : -layout.fontSize * 0.3;
      curves.push(rectangle(line.x, line.y + offset * vertical, line.width, thickness));
    }
  }
  return curves;
}
