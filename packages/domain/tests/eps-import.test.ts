import { describe, expect, it } from 'vitest';
import { epsArtwork, epsBody, epsBoundingBox, epsPostScript } from '../src/eps-import';

const POINTS = 96 / 72;
const eps = (body: string, box = '%%BoundingBox: 0 0 300 150') => [
  '%!PS-Adobe-3.0 EPSF-3.0', box, '%%Creator: a drawing program', '%%EndComments',
  '%%BeginProlog', '/l /lineto ld /c /curveto ld', '%%EndProlog', '%%BeginSetup', '%%EndSetup',
  body, 'showpage', '%%EOF',
].join('\n');
const bytes = (text: string) => Uint8Array.from([...text].map((character) => character.charCodeAt(0) & 0xff));

describe('eps reader', () => {
  it('reads the box and leaves the prolog out of the drawing', () => {
    const text = eps('10 10 m 110 10 l f');
    expect(epsBoundingBox(text)).toEqual([0, 0, 300, 150]);
    // The words a program defines for itself are not part of what it draws.
    expect(epsBody(text)).not.toContain('/lineto');
    expect(epsBody(text)).toContain('10 10 m');
    const hires = eps('10 10 m 110 10 l f', '%%BoundingBox: 0 0 300 150\n%%HiResBoundingBox: 0.5 0.25 300.75 150.5');
    expect(epsBoundingBox(hires)).toEqual([0.5, 0.25, 300.75, 150.5]);
  });

  it('reads paths with the names of the language and the aliases of a drawing program', () => {
    const result = epsArtwork(eps([
      '0 0 1 setrgbcolor',
      '10 10 moveto 110 10 lineto 110 60 lineto closepath fill',
      '1 0 0 0 create_cmyk_color set_solid_fill 2 setlinewidth',
      '20 20 m 120 20 L 120 70 C 120 70 120 70 @c F',
    ].join('\n')));
    expect(result.layers).toHaveLength(2);
    const [blue, cyan] = result.layers;
    // The language and the aliases draw the same triangle, in the colours each one sets.
    expect(blue.fill).toBe('#0000ff');
    expect(cyan.fill).toBe('#00ffff');
    expect(blue.curves![0].closed).toBe(true);
    expect(Math.round(blue.width)).toBe(Math.round(100 * POINTS));
    // The page is turned upright: a point ten above the bottom lands ten above the edge.
    expect(Math.round(blue.y + blue.height)).toBe(Math.round((150 - 10) * POINTS));
    expect(result.size).toEqual({ width: 300 * POINTS, height: 150 * POINTS });
  });

  it('keeps the stroke of a stroked path open and its width in document pixels', () => {
    const result = epsArtwork(eps('0 setgray 4 setlinewidth 10 10 m 110 10 l 110 60 l S'));
    const [line] = result.layers;
    expect(line.fill).toBe('none');
    expect(line.stroke).toBe('#000000');
    expect(line.strokeWidth).toBeCloseTo(4 * POINTS, 6);
    expect(line.curves![0].closed).toBe(false);
  });

  it('follows the transformations of the drawing', () => {
    const plain = epsArtwork(eps('0 0 m 50 0 l 50 50 l f'));
    const moved = epsArtwork(eps('gsave 100 20 translate 0 0 m 50 0 l 50 50 l f grestore'));
    expect(Math.round(moved.layers[0].x - plain.layers[0].x)).toBe(Math.round(100 * POINTS));
    const scaled = epsArtwork(eps('2 2 scale 0 0 m 50 0 l 50 50 l f'));
    expect(Math.round(scaled.layers[0].width)).toBe(Math.round(2 * plain.layers[0].width));
  });

  it('reports what it cannot draw and refuses what is not PostScript', () => {
    const result = epsArtwork(eps('10 10 m 110 10 l f (Hello) show newpath 0 0 m 10 10 l clip'));
    expect(result.skipped.sort()).toEqual(['clipping paths', 'text']);
    expect(() => epsArtwork('not a drawing')).toThrow(/encapsulated PostScript/);
    expect(() => epsArtwork(eps('gsave grestore'))).toThrow(/no content/);
  });

  it('takes the PostScript out of a file that carries a preview', () => {
    const script = eps('10 10 m 110 10 l f');
    const header = new Uint8Array(30 + script.length);
    header.set([0xc5, 0xd0, 0xd3, 0xc6], 0);
    const number = (at: number, value: number) => {
      for (let index = 0; index < 4; index++) header[at + index] = (value >> (index * 8)) & 0xff;
    };
    number(4, 30);
    number(8, script.length);
    header.set(bytes(script), 30);
    expect(epsPostScript(header).startsWith('%!PS-Adobe')).toBe(true);
    // A plain file is read as it is.
    expect(epsPostScript(bytes(script)).startsWith('%!PS-Adobe')).toBe(true);
  });
});
