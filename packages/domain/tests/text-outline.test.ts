import { describe, expect, it } from 'vitest';
import { anchor, CurvePath } from '../src/curves';
import { approximateTextMeasurement, defaultTypography, layoutText } from '../src/text-layout';
import { textOutlines } from '../src/text-outline';

/** A stand-in for the font: every glyph is the square it advances over. */
const boxes: { text: string; x: number; y: number; size: number }[] = [];
const glyphs = (text: string, size: number, x: number, y: number): CurvePath[] => {
  boxes.push({ text, x, y, size });
  return [{ closed: true, nodes: [{ x, y: y - size }, { x: x + size, y: y - size }, { x: x + size, y }, { x, y }].map(anchor) }];
};
const layout = (overrides: Partial<Parameters<typeof layoutText>[0]> = {}, typography = {}) =>
  layoutText({ text: 'ab\ncd', fontSize: 20, width: 400, height: 200, typography: { ...defaultTypography, ...typography }, ...overrides }, approximateTextMeasurement);

describe('text outlines', () => {
  it('places one shape per glyph, line by line', () => {
    boxes.length = 0;
    const result = textOutlines(layout(), glyphs);
    // Four glyphs over two lines, each one a closed shape.
    expect(boxes.map((box) => box.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(result).toHaveLength(4);
    expect(result.every((path) => path.closed)).toBe(true);
    // The second line sits below the first one.
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  });

  it('scales the shapes as the text is scaled, from the unscaled place', () => {
    boxes.length = 0;
    const result = textOutlines(layout({}, { horizontalScale: 2, verticalScale: 0.5 }), glyphs);
    const wide = result[0].nodes.map((node) => node.point.x);
    const flat = result[0].nodes.map((node) => node.point.y);
    // A glyph of twenty units becomes forty across and ten down.
    expect(Math.max(...wide) - Math.min(...wide)).toBeCloseTo(40, 6);
    expect(Math.max(...flat) - Math.min(...flat)).toBeCloseTo(10, 6);
  });

  it('adds the bar of an underline or a strikethrough', () => {
    const plain = textOutlines(layout(), glyphs);
    const underlined = textOutlines(layout({}, { decoration: 'underline' }), glyphs);
    const struck = textOutlines(layout({}, { decoration: 'line-through' }), glyphs);
    // One bar per line of text, on top of the glyphs.
    expect(underlined).toHaveLength(plain.length + 2);
    expect(struck).toHaveLength(plain.length + 2);
    const bar = underlined[underlined.length - 1].nodes.map((node) => node.point.y);
    const strike = struck[struck.length - 1].nodes.map((node) => node.point.y);
    // The underline sits below the baseline and the strikethrough above it.
    expect(Math.min(...bar)).toBeGreaterThan(Math.min(...strike));
  });
});
