import { Layer, newLayer, Point } from './document';
import { Anchor, CurvePath, anchor, fitCurves } from './curves';
import { ImportLimits, IMPORT_LIMITS, ImportResult, Matrix } from './svg-import';

/**
 * Reader for the drawing of a PDF page, which is also what an Illustrator file carries.
 * The bytes are untrusted data: the reader walks the objects it can see, never follows a
 * reference outside the file, executes nothing and stops at explicit limits. Streams are
 * decompressed by the caller, which owns that part of the platform.
 */
export interface PdfStreamRef {
  /** Byte range of the stream data inside the file. */
  start: number;
  end: number;
  /** Filter named by the object, when it names one. */
  filter: string;
}
export interface PdfObjectRef {
  id: number;
  dict: string;
  stream?: PdfStreamRef;
}
export interface PdfPageRef {
  /** Page box in points: left, bottom, right, top. */
  mediaBox: [number, number, number, number];
  contents: number[];
}
const DECIMAL = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const decoder = (bytes: Uint8Array, from: number, to: number) => {
  let text = '';
  for (let index = from; index < Math.min(to, bytes.length); index++) text += String.fromCharCode(bytes[index]);
  return text;
};
/** Every indirect object of the file, found by scanning rather than by trusting the table. */
export function pdfObjects(bytes: Uint8Array, limits: ImportLimits = IMPORT_LIMITS): Map<number, PdfObjectRef> {
  if (bytes.length > limits.maxCharacters) throw new Error('The drawing exceeds the import size limit.');
  const header = decoder(bytes, 0, 1024);
  if (!header.startsWith('%PDF-')) throw new Error('The file is not a PDF or Illustrator drawing.');
  const objects = new Map<number, PdfObjectRef>();
  const text = decoder(bytes, 0, bytes.length);
  for (const match of text.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
    const id = Number(match[1]);
    if (!Number.isFinite(id) || objects.size > limits.maxElements) continue;
    const from = match.index + match[0].length;
    const streamAt = text.indexOf('stream', from);
    const endAt = text.indexOf('endobj', from);
    const dictEnd = streamAt >= 0 && (endAt < 0 || streamAt < endAt) ? streamAt : endAt < 0 ? from : endAt;
    const dict = text.slice(from, dictEnd);
    let stream: PdfStreamRef | undefined;
    if (streamAt >= 0 && (endAt < 0 || streamAt < endAt)) {
      // The data begins after the end of line that follows the keyword.
      let start = streamAt + 'stream'.length;
      if (text[start] === '\r') start++;
      if (text[start] === '\n') start++;
      const declared = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1] ?? '');
      const end = Number.isFinite(declared) && declared > 0
        ? start + declared
        : Math.max(start, text.indexOf('endstream', start));
      stream = { start, end, filter: /\/Filter\s*\/(\w+)/.exec(dict)?.[1] ?? '' };
    }
    objects.set(id, { id, dict, stream });
  }
  if (!objects.size) throw new Error('The file carries no readable objects.');
  return objects;
}
/** The first page of the file, with the box it declares and the streams that draw it. */
export function pdfFirstPage(objects: Map<number, PdfObjectRef>): PdfPageRef {
  for (const object of objects.values()) {
    if (!/\/Type\s*\/Page[^s]/.test(object.dict + ' ')) continue;
    const box = /\/MediaBox\s*\[([^\]]*)\]/.exec(object.dict)?.[1] ?? '0 0 612 792';
    const numbers = box.trim().split(/\s+/).map(Number).filter(Number.isFinite);
    const mediaBox: [number, number, number, number] = numbers.length === 4
      ? [numbers[0], numbers[1], numbers[2], numbers[3]]
      : [0, 0, 612, 792];
    const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(object.dict);
    const many = /\/Contents\s*\[([^\]]*)\]/.exec(object.dict);
    const contents = single
      ? [Number(single[1])]
      : many
        ? [...many[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]))
        : [];
    if (contents.length) return { mediaBox, contents };
  }
  throw new Error('The file has no page this editor can read.');
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const hex2 = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0');
/** Colour operands become a native paint: one component is grey, three are RGB, four are CMYK. */
export function pdfColour(components: number[]): string {
  if (components.length === 1) return '#' + hex2(components[0]).repeat(3);
  if (components.length === 3) return '#' + components.map(hex2).join('');
  if (components.length === 4) {
    const [c, m, y, k] = components;
    return '#' + [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)].map(hex2).join('');
  }
  return '#000000';
}
interface GraphicsState {
  ctm: Matrix;
  fill: string;
  stroke: string;
  width: number;
  dash: number[];
}
/** One token of a content stream: a number, a name, a delimiter block or an operator. */
function* tokens(content: string): Generator<string> {
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (character === '%') { while (index < content.length && content[index] !== '\n') index++; continue; }
    if (/\s/.test(character)) { index++; continue; }
    if (character === '(') {
      let depth = 1, start = index++;
      while (index < content.length && depth) {
        if (content[index] === '\\') index++;
        else if (content[index] === '(') depth++;
        else if (content[index] === ')') depth--;
        index++;
      }
      yield content.slice(start, index);
      continue;
    }
    if (character === '<' && content[index + 1] === '<') { yield '<<'; index += 2; continue; }
    if (character === '>' && content[index + 1] === '>') { yield '>>'; index += 2; continue; }
    if (character === '<') { const end = content.indexOf('>', index); yield content.slice(index, end + 1); index = end + 1; continue; }
    if (character === '[' || character === ']') { yield character; index++; continue; }
    let end = index;
    while (end < content.length && !/[\s()<>[\]/%]/.test(content[end])) end++;
    if (character === '/') { end = index + 1; while (end < content.length && !/[\s()<>[\]/%]/.test(content[end])) end++; }
    if (end === index) end++;
    yield content.slice(index, end);
    index = end;
  }
}
/**
 * Reads the drawing of a page into native layers. Coordinates arrive in points measured
 * from the bottom left and leave in pixels measured from the top left, which is how this
 * editor holds a document.
 */
export function pdfArtwork(content: string, page: PdfPageRef, options: { name?: string; limits?: ImportLimits } = {}): ImportResult {
  const limits = options.limits ?? IMPORT_LIMITS;
  const [left, bottom, right, top] = page.mediaBox;
  const width = Math.abs(right - left), height = Math.abs(top - bottom);
  const perPoint = 96 / 72;
  // The page is turned upright and measured in pixels once, for every path it carries.
  const base: Matrix = [perPoint, 0, 0, -perPoint, -left * perPoint, (bottom + height) * perPoint];
  const group = (options.name ?? 'Imported drawing').slice(0, 80);
  const layers: Layer[] = [];
  const skipped = new Set<string>();
  let state: GraphicsState = { ctm: base, fill: '#000000', stroke: '#000000', width: 1, dash: [] };
  const stack: GraphicsState[] = [];
  const operands: string[] = [];
  let paths: CurvePath[] = [];
  let nodes: Anchor[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let nodeCount = 0;
  let inText = false;
  const numbers = (count: number) => operands.slice(-count).map(Number).map((value) => (Number.isFinite(value) ? value : 0));
  const place = (point: Point) => apply(state.ctm, point);
  const flush = (closed = false) => {
    if (nodes.length > 1) paths.push({ nodes, closed });
    nodes = [];
  };
  const moveTo = (point: Point) => {
    flush();
    current = point;
    start = point;
    nodes = [anchor(place(point))];
  };
  const lineTo = (point: Point) => {
    if (!nodes.length) nodes = [anchor(place(current))];
    nodes.push(anchor(place(point)));
    current = point;
  };
  const curveTo = (c1: Point, c2: Point, end: Point) => {
    if (!nodes.length) nodes = [anchor(place(current))];
    nodes[nodes.length - 1].outgoing = place(c1);
    const next = anchor(place(end));
    next.incoming = place(c2);
    nodes.push(next);
    current = end;
  };
  const build = (contours: CurvePath[], fill: boolean, stroke: boolean) => {
    nodeCount += contours.reduce((total, path) => total + path.nodes.length, 0);
    if (nodeCount > limits.maxNodes) throw new Error('The drawing exceeds the import node limit.');
    if (layers.length >= limits.maxElements) throw new Error('The drawing exceeds the import element limit.');
    const layer = newLayer('path', crypto.randomUUID(), { x: 0, y: 0 });
    layer.name = 'Path';
    layer.fill = fill ? state.fill : 'none';
    layer.stroke = stroke ? state.stroke : 'none';
    layer.strokeWidth = stroke ? Math.max(0.1, state.width * scaleOf(state.ctm)) : 0;
    if (stroke && state.dash.length) layer.strokeStyle = { cap: 'butt', join: 'miter', alignment: 'center', dash: state.dash.map((value) => value * scaleOf(state.ctm)) };
    layer.groupPath = [group];
    layers.push(fitCurves(layer, contours));
  };
  const paint = (fill: boolean, stroke: boolean) => {
    flush();
    if (paths.length && (fill || stroke)) {
      // Filling closes every subpath, which is what the page means and what the editor
      // needs to paint them; a stroke keeps the contour open as it was drawn.
      const open = paths.some((path) => !path.closed);
      if (fill && stroke && open) {
        build(paths.map((path) => ({ ...path, closed: true })), true, false);
        build(paths, false, true);
      } else {
        build(fill ? paths.map((path) => ({ ...path, closed: true })) : paths, fill, stroke);
      }
    }
    paths = [];
  };
  for (const token of tokens(content)) {
    if (DECIMAL.test(token) || token.startsWith('/') || token === '[' || token === ']' || token.startsWith('(') || token.startsWith('<')) {
      operands.push(token);
      if (operands.length > 64) operands.shift();
      continue;
    }
    switch (token) {
      case 'q': stack.push({ ...state, ctm: [...state.ctm] as Matrix, dash: [...state.dash] }); break;
      case 'Q': state = stack.pop() ?? state; break;
      case 'cm': state = { ...state, ctm: multiply(state.ctm, numbers(6) as Matrix) }; break;
      case 'w': state = { ...state, width: numbers(1)[0] }; break;
      case 'd': {
        const values = operands.slice(operands.lastIndexOf('[') + 1, operands.lastIndexOf(']')).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
        state = { ...state, dash: values.filter((value) => value > 0).length ? values : [] };
        break;
      }
      case 'm': moveTo({ x: numbers(2)[0], y: numbers(2)[1] }); break;
      case 'l': lineTo({ x: numbers(2)[0], y: numbers(2)[1] }); break;
      case 'c': { const [x1, y1, x2, y2, x3, y3] = numbers(6); curveTo({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }); break; }
      case 'v': { const [x2, y2, x3, y3] = numbers(4); curveTo(current, { x: x2, y: y2 }, { x: x3, y: y3 }); break; }
      case 'y': { const [x1, y1, x3, y3] = numbers(4); curveTo({ x: x1, y: y1 }, { x: x3, y: y3 }, { x: x3, y: y3 }); break; }
      case 'h': { if (nodes.length > 1) { flush(true); current = start; } break; }
      case 're': {
        const [x, y, w, h] = numbers(4);
        flush();
        nodes = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map((point) => anchor(place(point)));
        flush(true);
        current = { x, y };
        start = current;
        break;
      }
      case 'g': state = { ...state, fill: pdfColour(numbers(1)) }; break;
      case 'G': state = { ...state, stroke: pdfColour(numbers(1)) }; break;
      case 'rg': state = { ...state, fill: pdfColour(numbers(3)) }; break;
      case 'RG': state = { ...state, stroke: pdfColour(numbers(3)) }; break;
      case 'k': state = { ...state, fill: pdfColour(numbers(4)) }; break;
      case 'K': state = { ...state, stroke: pdfColour(numbers(4)) }; break;
      case 'sc': case 'scn': case 'SC': case 'SCN': {
        // The components of a colour space the reader does not resolve are read by their count.
        const values: number[] = [];
        for (let index = operands.length - 1; index >= 0 && DECIMAL.test(operands[index]); index--) values.unshift(Number(operands[index]));
        if (!values.length) { skipped.add('patterns'); break; }
        const paint = pdfColour(values.slice(-4));
        state = token === 'sc' || token === 'scn' ? { ...state, fill: paint } : { ...state, stroke: paint };
        break;
      }
      case 'f': case 'F': case 'f*': paint(true, false); break;
      case 'S': case 's': paint(false, true); break;
      case 'B': case 'B*': case 'b': case 'b*': paint(true, true); break;
      case 'n': flush(); paths = []; break;
      case 'W': case 'W*': skipped.add('clipping paths'); break;
      case 'BT': inText = true; skipped.add('text'); break;
      case 'ET': inText = false; break;
      case 'Do': skipped.add('placed objects'); break;
      case 'BI': skipped.add('inline images'); break;
      case 'sh': skipped.add('gradients'); break;
      default: break;
    }
    if (!inText || token === 'ET') operands.length = 0;
  }
  if (!layers.length) throw new Error('The drawing has no content this editor can place.');
  return { layers, size: { width: width * perPoint, height: height * perPoint }, skipped: [...skipped] };
}
