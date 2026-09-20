import { describe, expect, it } from 'vitest';
import { flatten } from '../src/curves';
import { importLength, importPaint, importSvg, parsePathData, parseTransform, parseXml } from '../src/svg-import';

const svg = (body: string, attributes = 'width="200" height="100"') =>
  `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
const box = (layer: { x: number; y: number; width: number; height: number }) =>
  ({ x: Math.round(layer.x), y: Math.round(layer.y), width: Math.round(layer.width), height: Math.round(layer.height) });

describe('svg import', () => {
  it('reads the basic shapes with the geometry they declare', () => {
    const result = importSvg(svg(`
      <rect x="10" y="20" width="60" height="40" fill="#ff0000"/>
      <circle cx="100" cy="50" r="25" fill="none" stroke="blue" stroke-width="4"/>
      <line x1="0" y1="0" x2="30" y2="40"/>
      <polygon points="0,0 10,0 10,10"/>`));
    expect(result.size).toEqual({ width: 200, height: 100 });
    expect(result.layers).toHaveLength(4);
    const [rectangle, circle, line, polygon] = result.layers;
    expect(box(rectangle)).toEqual({ x: 10, y: 20, width: 60, height: 40 });
    expect(rectangle.fill).toBe('#ff0000');
    expect(rectangle.curves![0].closed).toBe(true);
    // A circle of radius 25 around (100, 50) spans 75 to 125 in x.
    expect(box(circle)).toEqual({ x: 75, y: 25, width: 50, height: 50 });
    expect(circle.fill).toBe('none');
    expect(circle.stroke).toBe('#0000ff');
    expect(circle.strokeWidth).toBe(4);
    expect(box(line)).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    expect(line.curves![0].closed).toBe(false);
    expect(polygon.curves![0].nodes).toHaveLength(3);
    expect(polygon.curves![0].closed).toBe(true);
    // Every layer belongs to the group named after the import.
    expect(result.layers.every((layer) => layer.groupPath?.[0] === 'Imported drawing')).toBe(true);
  });

  it('composes transforms through groups and scales stroke widths with them', () => {
    const result = importSvg(svg(`
      <g transform="translate(100,50)" stroke="#123456" stroke-width="2">
        <g transform="scale(2)">
          <rect x="0" y="0" width="10" height="10"/>
        </g>
      </g>`));
    // Translated by (100, 50) and scaled by two: a 20 by 20 square at the translation.
    expect(box(result.layers[0])).toEqual({ x: 100, y: 50, width: 20, height: 20 });
    expect(result.layers[0].stroke).toBe('#123456');
    expect(result.layers[0].strokeWidth).toBe(4);
    const rotated = importSvg(svg('<rect x="0" y="0" width="10" height="10" transform="rotate(90 5 5)"/>'));
    // Rotating a square about its own centre returns the same box.
    expect(box(rotated.layers[0])).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('maps the viewBox onto the declared size', () => {
    const result = importSvg(svg('<rect x="0" y="0" width="100" height="100"/>', 'width="200" height="200" viewBox="0 0 100 100"'));
    expect(box(result.layers[0])).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    const shifted = importSvg(svg('<rect x="50" y="50" width="10" height="10"/>', 'width="100" height="100" viewBox="50 50 100 100"'));
    expect(box(shifted.layers[0])).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it('reads every path command, including arcs, as cubic geometry', () => {
    const [line] = parsePathData('M 0 0 L 10 0 20 0 Z');
    expect(line.closed).toBe(true);
    expect(line.nodes.map((node) => node.point.x)).toEqual([0, 10, 20]);
    const [relative] = parsePathData('m 5 5 h 10 v 10 z');
    expect(relative.nodes.map((node) => [node.point.x, node.point.y])).toEqual([[5, 5], [15, 5], [15, 15]]);
    const [curve] = parsePathData('M0,0 C0,10 10,10 10,0 S20,-10 20,0');
    // The smooth continuation mirrors the previous control point about the node,
    // so the outgoing control of (10, 0) is (10, -10) and the given one lands on the end.
    expect(curve.nodes).toHaveLength(3);
    expect(curve.nodes[1].outgoing).toEqual({ x: 10, y: -10 });
    expect(curve.nodes[2].incoming).toEqual({ x: 20, y: -10 });
    const [quadratic] = parsePathData('M0,0 Q10,10 20,0');
    // A quadratic apex at (10, 10) gives cubic controls two thirds of the way there.
    expect(quadratic.nodes[0].outgoing.x).toBeCloseTo(20 / 3, 9);
    expect(quadratic.nodes[0].outgoing.y).toBeCloseTo(20 / 3, 9);
    const [arc] = parsePathData('M0,0 A10,10 0 0 1 20,0');
    const points = flatten(arc, 32);
    const radii = points.map((point) => Math.hypot(point.x - 10, point.y - 0));
    // A half circle of radius ten keeps every sampled point at that radius from its centre.
    for (const radius of radii) expect(radius).toBeCloseTo(10, 1);
    // The positive sweep flag turns clockwise on screen, so the half circle passes over the ends.
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(-10, 1);
    const [under] = parsePathData('M0,0 A10,10 0 0 0 20,0');
    expect(Math.max(...flatten(under, 32).map((point) => point.y))).toBeCloseTo(10, 1);
  });

  it('normalizes colours and reports what it cannot represent', () => {
    expect(importPaint('#ABC', '#000000').paint).toBe('#aabbcc');
    expect(importPaint('rgb(255, 0, 0)', '#000000').paint).toBe('#ff0000');
    expect(importPaint('rgba(0, 0, 255, 0.5)', '#000000').paint).toBe('#0000ff80');
    expect(importPaint('transparent', '#000000').paint).toBe('none');
    expect(importPaint('url(#gradient)', '#111111')).toEqual({ paint: '#111111', skipped: 'gradients and patterns' });
    expect(importPaint(undefined, '#222222').paint).toBe('#222222');
    expect(importLength('10mm')).toBeCloseTo(37.795, 2);
    expect(importLength('12pt')).toBe(16);
    const result = importSvg(svg('<rect x="0" y="0" width="10" height="10" fill="url(#g)"/><use href="#a"/><image href="http://example.com/a.png"/>'));
    expect(result.skipped).toContain('gradients and patterns');
    expect(result.skipped).toContain('use');
    expect(result.skipped).toContain('image');
    expect(result.layers).toHaveLength(1);
  });

  it('reads text and the inline style, which wins over the attributes', () => {
    const result = importSvg(svg('<text x="10" y="30" font-size="20" fill="#0000ff" style="fill:#00ff00">Hello</text>'));
    const [layer] = result.layers;
    expect(layer.kind).toBe('text');
    expect(layer.text).toBe('Hello');
    expect(layer.fontSize).toBe(20);
    expect(layer.fill).toBe('#00ff00');
    // The baseline sits at y, so the frame starts one size above it.
    expect(layer.y).toBe(10);
  });

  it('treats the file as data: no declared entities, no scripts and bounded counts', () => {
    const attack = '<!DOCTYPE svg [<!ENTITY lol "lol">]><svg><rect width="10" height="10"/></svg>';
    expect(() => importSvg(attack)).toThrow(/document type/i);
    const scripted = importSvg(svg('<script>window.alert(1)</script><rect x="0" y="0" width="10" height="10" onclick="steal()"/>'));
    expect(scripted.skipped).toContain('scripts');
    expect(JSON.stringify(scripted.layers)).not.toContain('steal');
    expect(() => importSvg(svg('<rect width="1" height="1"/>'.repeat(20)), { limits: { maxCharacters: 1_000_000, maxElements: 5, maxNodes: 100 } })).toThrow(/element limit/i);
    expect(() => importSvg(svg('<rect x="0" y="0" width="10" height="10"/>'.repeat(20)), { limits: { maxCharacters: 1_000_000, maxElements: 100, maxNodes: 10 } })).toThrow(/node limit/i);
    expect(() => importSvg('not a drawing')).toThrow(/does not contain/i);
    expect(parseXml('<a b="1"><c/></a>').children[0].attributes).toEqual({ b: '1' });
  });

  it('keeps the group of the file and the identifiers of the drawing', () => {
    const result = importSvg(svg('<g id="walls"><rect id="north" x="0" y="0" width="10" height="10"/></g>'), { name: 'Plan.svg' });
    expect(result.layers[0].groupPath).toEqual(['Plan.svg', 'walls']);
    expect(result.layers[0].name).toBe('north');
  });

  it('parses the transform list in the order it is written', () => {
    // Translate then scale moves first: the point (1, 0) lands at (10 + 2, 0).
    expect(parseTransform('translate(10,0) scale(2)')).toEqual([2, 0, 0, 2, 10, 0]);
    expect(parseTransform('scale(2) translate(10,0)')).toEqual([2, 0, 0, 2, 20, 0]);
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
