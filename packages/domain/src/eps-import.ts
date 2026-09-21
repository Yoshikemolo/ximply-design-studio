import { Layer, newLayer, Point } from './document';
import { Anchor, CurvePath, anchor, fitCurves } from './curves';
import { ImportLimits, IMPORT_LIMITS, ImportResult, Matrix } from './svg-import';
import { pdfColour, pdfTokens } from './pdf-import';

/**
 * Reader for the drawing of an encapsulated PostScript file. A full PostScript machine is
 * not what this is: the reader follows the bounded vocabulary drawing programs write, the
 * names of the language and the short aliases Illustrator and CorelDRAW define for them,
 * and reports whatever it meets outside that vocabulary. Nothing in the file is executed.
 */
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const DECIMAL = /^[-+]?(\d+\.?\d*|\.\d+)$/;

/**
 * The PostScript of a file that may carry a preview. A binary encapsulated file begins
 * with a header that says where its PostScript starts and how long it is.
 */
export function epsPostScript(bytes: Uint8Array): string {
  const read = (from: number, to: number) => {
    let text = '';
    for (let index = from; index < Math.min(to, bytes.length); index++) text += String.fromCharCode(bytes[index]);
    return text;
  };
  if (bytes.length > 30 && bytes[0] === 0xc5 && bytes[1] === 0xd0 && bytes[2] === 0xd3 && bytes[3] === 0xc6) {
    const number = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
    const start = number(4), length = number(8);
    if (start > 0 && length > 0 && start + length <= bytes.length) return read(start, start + length);
  }
  return read(0, bytes.length);
}
/** The box the file declares, in points, at the best precision it offers. */
export function epsBoundingBox(text: string): [number, number, number, number] {
  const hires = /%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(text);
  const plain = /%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(text);
  const found = hires ?? plain;
  if (!found) return [0, 0, 612, 792];
  const numbers = found.slice(1, 5).map(Number);
  return numbers.every(Number.isFinite) && numbers[2] > numbers[0] && numbers[3] > numbers[1]
    ? [numbers[0], numbers[1], numbers[2], numbers[3]]
    : [0, 0, 612, 792];
}
/** The drawing of the file, without the prolog where a program defines its own words. */
export function epsBody(text: string): string {
  for (const marker of ['%%EndSetup', '%%EndProlog']) {
    const at = text.lastIndexOf(marker);
    if (at >= 0) return text.slice(at + marker.length);
  }
  return text;
}
interface GraphicsState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  width: number;
}
/** Names the reader understands, with the aliases drawing programs define for them. */
const MOVE = ['m', 'moveto'];
const LINE = ['l', 'L', 'lineto'];
const CURVE = ['c', 'C', 'curveto'];
const CLOSE = ['h', '@c', '@cp', 'closepath'];
const FILL = ['f', 'F', 'fill', 'eofill', '@f'];
const STROKE = ['S', 'stroke', '@s'];
const CLOSE_STROKE = ['@b', 'b'];
const CLOSE_FILL = ['@B'];
const SAVE = ['q', 'gsave', '@gs', '@sv'];
const RESTORE = ['Q', 'grestore', '@gr', '@rs'];
const IGNORED_REPORTS: Record<string, string> = {
  clip: 'clipping paths', eoclip: 'clipping paths', W: 'clipping paths',
  show: 'text', ashow: 'text', widthshow: 'text', awidthshow: 'text',
  image: 'images', colorimage: 'images', imagemask: 'images',
  shfill: 'gradients', setpattern: 'patterns', makepattern: 'patterns',
};

/**
 * Reads the drawing into native layers. PostScript measures from the bottom left in
 * points; a document measures from the top left in pixels, so the page is turned upright
 * and scaled once for every path it carries.
 */
export function epsArtwork(text: string, options: { name?: string; limits?: ImportLimits } = {}): ImportResult {
  const limits = options.limits ?? IMPORT_LIMITS;
  if (text.length > limits.maxCharacters) throw new Error('The drawing exceeds the import size limit.');
  if (!/%!PS-Adobe/.test(text.slice(0, 4096))) throw new Error('The file is not an encapsulated PostScript drawing.');
  const [left, bottom, right, top] = epsBoundingBox(text);
  const width = right - left, height = top - bottom;
  const perPoint = 96 / 72;
  const base: Matrix = [perPoint, 0, 0, -perPoint, -left * perPoint, (bottom + height) * perPoint];
  const group = (options.name ?? 'Imported drawing').slice(0, 80);
  const layers: Layer[] = [];
  const skipped = new Set<string>();
  let state: GraphicsState = { ctm: base, fill: '#000000', stroke: '#000000', width: 1 };
  const stack: GraphicsState[] = [];
  const operands: string[] = [];
  let paths: CurvePath[] = [];
  let nodes: Anchor[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let nodeCount = 0;
  const numbers = (count: number) => operands.slice(-count).map(Number).map((value) => (Number.isFinite(value) ? value : 0));
  const trailing = () => {
    const values: number[] = [];
    for (let index = operands.length - 1; index >= 0 && DECIMAL.test(operands[index]); index--) values.unshift(Number(operands[index]));
    return values;
  };
  const place = (point: Point) => apply(state.ctm, point);
  const flush = (closed = false) => {
    if (nodes.length > 1) paths.push({ nodes, closed });
    nodes = [];
  };
  const paint = (fill: boolean, stroke: boolean, closing = false) => {
    flush(closing);
    if (paths.length && (fill || stroke)) {
      nodeCount += paths.reduce((total, path) => total + path.nodes.length, 0);
      if (nodeCount > limits.maxNodes) throw new Error('The drawing exceeds the import node limit.');
      if (layers.length >= limits.maxElements) throw new Error('The drawing exceeds the import element limit.');
      const layer = newLayer('path', crypto.randomUUID(), { x: 0, y: 0 });
      layer.name = 'Path';
      // Filling closes every contour it paints, as it does in the language itself.
      const contours = fill ? paths.map((path) => ({ ...path, closed: true })) : paths;
      layer.fill = fill ? state.fill : 'none';
      layer.stroke = stroke ? state.stroke : 'none';
      layer.strokeWidth = stroke ? Math.max(0.1, state.width * scaleOf(state.ctm)) : 0;
      layer.groupPath = [group];
      layers.push(fitCurves(layer, contours));
    }
    paths = [];
  };
  for (const token of pdfTokens(epsBody(text))) {
    if (DECIMAL.test(token) || token.startsWith('/') || token.startsWith('(') || token.startsWith('<') || token === '[' || token === ']') {
      operands.push(token);
      if (operands.length > 64) operands.shift();
      continue;
    }
    if (MOVE.includes(token)) {
      flush();
      const [x, y] = numbers(2);
      current = { x, y };
      start = current;
      nodes = [anchor(place(current))];
    } else if (LINE.includes(token)) {
      const [x, y] = numbers(2);
      if (!nodes.length) nodes = [anchor(place(current))];
      current = { x, y };
      nodes.push(anchor(place(current)));
    } else if (CURVE.includes(token)) {
      const [x1, y1, x2, y2, x3, y3] = numbers(6);
      if (!nodes.length) nodes = [anchor(place(current))];
      nodes[nodes.length - 1].outgoing = place({ x: x1, y: y1 });
      const next = anchor(place({ x: x3, y: y3 }));
      next.incoming = place({ x: x2, y: y2 });
      nodes.push(next);
      current = { x: x3, y: y3 };
    } else if (CLOSE.includes(token)) {
      if (nodes.length > 1) flush(true);
      current = start;
    } else if (FILL.includes(token)) paint(true, false, true);
    else if (STROKE.includes(token)) paint(false, true);
    else if (CLOSE_STROKE.includes(token)) paint(false, true, true);
    else if (CLOSE_FILL.includes(token)) paint(true, true, true);
    else if (token === 'n' || token === 'newpath' || token === 'N') { flush(); paths = []; }
    else if (SAVE.includes(token)) stack.push({ ...state, ctm: [...state.ctm] as Matrix });
    else if (RESTORE.includes(token)) state = stack.pop() ?? state;
    else if (token === 'setlinewidth' || token === 'w') state = { ...state, width: numbers(1)[0] };
    else if (token === 'setgray') state = { ...state, fill: pdfColour(numbers(1)), stroke: pdfColour(numbers(1)) };
    else if (token === 'setrgbcolor' || token === 'create_rgb_color') state = { ...state, fill: pdfColour(numbers(3)), stroke: pdfColour(numbers(3)) };
    else if (token === 'setcmykcolor' || token === 'create_cmyk_color') state = { ...state, fill: pdfColour(numbers(4)), stroke: pdfColour(numbers(4)) };
    else if (token === 'set_solid_fill' || token === 'set_outline') {
      // The colour was built by the previous words; these only say where it goes.
    } else if (token === 'concat') {
      const values = trailing().slice(-6);
      if (values.length === 6) state = { ...state, ctm: multiply(state.ctm, values as Matrix) };
    } else if (token === 'translate') {
      const [x, y] = numbers(2);
      state = { ...state, ctm: multiply(state.ctm, [1, 0, 0, 1, x, y]) };
    } else if (token === 'scale') {
      const [x, y] = numbers(2);
      state = { ...state, ctm: multiply(state.ctm, [x || 1, 0, 0, y || 1, 0, 0]) };
    } else if (token === 'rotate') {
      const radians = (numbers(1)[0] * Math.PI) / 180;
      state = { ...state, ctm: multiply(state.ctm, [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]) };
    } else if (IGNORED_REPORTS[token]) skipped.add(IGNORED_REPORTS[token]);
    operands.length = 0;
  }
  if (!layers.length) throw new Error('The drawing has no content this editor can place.');
  return { layers, size: { width: width * perPoint, height: height * perPoint }, skipped: [...skipped] };
}
