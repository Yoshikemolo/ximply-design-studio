import { Layer, newLayer, Point } from './document';
import { Anchor, CurvePath, anchor, fitCurves } from './curves';

/**
 * Bounded reader for imported SVG drawings. The text is untrusted data: nothing is
 * executed, no entity is expanded, no external reference is resolved and every count is
 * capped before any layer exists. What cannot be represented is reported, never guessed.
 */
export interface ImportLimits {
  maxCharacters: number;
  maxElements: number;
  maxNodes: number;
}
export const IMPORT_LIMITS: ImportLimits = { maxCharacters: 20_000_000, maxElements: 4000, maxNodes: 20_000 };
export interface ImportResult {
  layers: Layer[];
  /** Size the drawing declares, when it declares one. */
  size?: { width: number; height: number };
  /** Content the reader could not represent, named once each. */
  skipped: string[];
}
interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}
/** Affine transform as the six numbers of the SVG matrix. */
export type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
/** Average scale of a transform, used for stroke widths, which are not points. */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Only the five predefined entities and numeric references; a declared entity is never expanded. */
function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body.toLowerCase()] ?? '';
  });
}
/**
 * Minimal XML reader: elements, attributes and text. Comments, processing instructions
 * and CDATA are skipped, and a document type declaration is refused outright, which is
 * what keeps declared entities out of the reader.
 */
export function parseXml(text: string, limits: ImportLimits = IMPORT_LIMITS): XmlNode {
  if (text.length > limits.maxCharacters) throw new Error('The drawing exceeds the import size limit.');
  if (/<!DOCTYPE/i.test(text)) throw new Error('A document type declaration is not accepted in an imported drawing.');
  const root: XmlNode = { name: '#root', attributes: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let index = 0, elements = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) break;
    if (open > index) {
      const value = unescapeXml(text.slice(index, open)).trim();
      if (value) stack[stack.length - 1].text += (stack[stack.length - 1].text ? ' ' : '') + value;
    }
    if (text.startsWith('<!--', open)) { index = skipTo(text, open, '-->'); continue; }
    if (text.startsWith('<![CDATA[', open)) { index = skipTo(text, open, ']]>'); continue; }
    if (text.startsWith('<?', open)) { index = skipTo(text, open, '?>'); continue; }
    const close = text.indexOf('>', open);
    if (close < 0) throw new Error('The drawing is not well formed.');
    const body = text.slice(open + 1, close).trim();
    index = close + 1;
    if (body.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (++elements > limits.maxElements) throw new Error('The drawing exceeds the import element limit.');
    const selfClosing = body.endsWith('/');
    const source = selfClosing ? body.slice(0, -1) : body;
    const name = (source.match(/^[^\s/>]+/)?.[0] ?? '').replace(/^.*:/, '').toLowerCase();
    const node: XmlNode = { name, attributes: attributesOf(source), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}
function skipTo(text: string, from: number, terminator: string): number {
  const end = text.indexOf(terminator, from);
  return end < 0 ? text.length : end + terminator.length;
}
function attributesOf(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    result[match[1].replace(/^.*:/, '').toLowerCase()] = unescapeXml(match[3] ?? match[4] ?? '');
  }
  return result;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff',
  fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  olive: '#808000', navy: '#000080', purple: '#800080', teal: '#008080', orange: '#ffa500',
  brown: '#a52a2a', pink: '#ffc0cb', transparent: 'none',
};
const hex2 = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
/** Native paints are six or eight hexadecimal digits or none; anything else is reported. */
export function importPaint(value: string | undefined, fallback: string): { paint: string; skipped?: string } {
  const source = (value ?? '').trim().toLowerCase();
  if (!source) return { paint: fallback };
  if (source === 'none') return { paint: 'none' };
  if (/^#[0-9a-f]{6}$/.test(source) || /^#[0-9a-f]{8}$/.test(source)) return { paint: source };
  if (/^#[0-9a-f]{3}$/.test(source)) return { paint: '#' + [...source.slice(1)].map((digit) => digit + digit).join('') };
  const rgb = source.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? hex2(parts[3] * 255) : '';
      return { paint: '#' + parts.slice(0, 3).map(hex2).join('') + (alpha === 'ff' ? '' : alpha) };
    }
  }
  if (NAMED_COLORS[source]) return { paint: NAMED_COLORS[source] };
  return { paint: fallback, skipped: source.startsWith('url(') ? 'gradients and patterns' : 'unsupported colours' };
}
/** Lengths carry optional units; only the absolute ones are meaningful without a viewport. */
const UNITS: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };
export function importLength(value: string | undefined, fallback = 0): number {
  const match = (value ?? '').trim().match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallback;
  const unit = match[2].toLowerCase();
  if (!unit || unit === '%') return amount;
  return unit in UNITS ? amount * UNITS[unit] : fallback;
}
export function parseTransform(value: string | undefined): Matrix {
  let matrix: Matrix = IDENTITY;
  for (const match of (value ?? '').matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)) {
    const numbers = match[2].split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const name = match[1].toLowerCase();
    if (name === 'matrix' && numbers.length === 6) matrix = multiply(matrix, numbers as Matrix);
    else if (name === 'translate') matrix = multiply(matrix, [1, 0, 0, 1, numbers[0] ?? 0, numbers[1] ?? 0]);
    else if (name === 'scale') matrix = multiply(matrix, [numbers[0] ?? 1, 0, 0, numbers[1] ?? numbers[0] ?? 1, 0, 0]);
    else if (name === 'rotate' && numbers.length) {
      const radians = (numbers[0] * Math.PI) / 180, cos = Math.cos(radians), sin = Math.sin(radians);
      const around: Matrix = [cos, sin, -sin, cos, 0, 0];
      matrix = numbers.length >= 3
        ? multiply(multiply(multiply(matrix, [1, 0, 0, 1, numbers[1], numbers[2]]), around), [1, 0, 0, 1, -numbers[1], -numbers[2]])
        : multiply(matrix, around);
    } else if (name === 'skewx' && numbers.length) matrix = multiply(matrix, [1, 0, Math.tan((numbers[0] * Math.PI) / 180), 1, 0, 0]);
    else if (name === 'skewy' && numbers.length) matrix = multiply(matrix, [1, Math.tan((numbers[0] * Math.PI) / 180), 0, 1, 0, 0]);
  }
  return matrix;
}

/** One cubic segment appended to the path being read. */
function pushCubic(nodes: Anchor[], control1: Point, control2: Point, end: Point) {
  const last = nodes[nodes.length - 1];
  last.outgoing = { ...control1 };
  const next = anchor(end);
  next.incoming = { ...control2 };
  nodes.push(next);
}
/** Elliptical arc of the path grammar, converted to at most four cubic segments. */
function arcTo(nodes: Anchor[], from: Point, rx: number, ry: number, rotation: number, large: boolean, sweep: boolean, to: Point) {
  if (!rx || !ry) { pushCubic(nodes, from, to, to); return; }
  const radians = (rotation * Math.PI) / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = (from.x - to.x) / 2, dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  let radiusX = Math.abs(rx), radiusY = Math.abs(ry);
  const excess = (x1 * x1) / (radiusX * radiusX) + (y1 * y1) / (radiusY * radiusY);
  if (excess > 1) { radiusX *= Math.sqrt(excess); radiusY *= Math.sqrt(excess); }
  const denominator = radiusX * radiusX * y1 * y1 + radiusY * radiusY * x1 * x1;
  const factor = Math.sqrt(Math.max(0, (radiusX * radiusX * radiusY * radiusY - denominator) / denominator)) * (large === sweep ? -1 : 1);
  const cx1 = (factor * radiusX * y1) / radiusY, cy1 = (-factor * radiusY * x1) / radiusX;
  const centre = { x: cos * cx1 - sin * cy1 + (from.x + to.x) / 2, y: sin * cx1 + cos * cy1 + (from.y + to.y) / 2 };
  const angleOf = (x: number, y: number) => Math.atan2((y - cy1) / radiusY, (x - cx1) / radiusX);
  const start = angleOf(x1, y1);
  let sweepAngle = angleOf(-x1, -y1) - start;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const step = sweepAngle / steps, alpha = (4 / 3) * Math.tan(step / 4);
  let angle = start, current = { ...from };
  for (let index = 0; index < steps; index++) {
    const next = angle + step;
    const onEllipse = (value: number): Point => ({
      x: centre.x + radiusX * Math.cos(value) * cos - radiusY * Math.sin(value) * sin,
      y: centre.y + radiusX * Math.cos(value) * sin + radiusY * Math.sin(value) * cos,
    });
    const derivative = (value: number): Point => ({
      x: -radiusX * Math.sin(value) * cos - radiusY * Math.cos(value) * sin,
      y: -radiusX * Math.sin(value) * sin + radiusY * Math.cos(value) * cos,
    });
    const end = onEllipse(next), d0 = derivative(angle), d1 = derivative(next);
    pushCubic(nodes, { x: current.x + alpha * d0.x, y: current.y + alpha * d0.y }, { x: end.x - alpha * d1.x, y: end.y - alpha * d1.y }, end);
    current = end;
    angle = next;
  }
}
/** Reads the d attribute into cubic paths, in the coordinates the attribute declares. */
export function parsePathData(data: string): CurvePath[] {
  const tokens = data.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gi) ?? [];
  const paths: CurvePath[] = [];
  let nodes: Anchor[] = [], closed = false;
  let current: Point = { x: 0, y: 0 }, start: Point = { x: 0, y: 0 }, previousControl: Point | null = null;
  let command = '', index = 0;
  const flush = () => {
    if (nodes.length > 1) paths.push({ nodes, closed });
    nodes = [];
    closed = false;
  };
  const number = () => Number(tokens[index++]);
  const point = (relative: boolean): Point => {
    const x = number(), y = number();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) command = tokens[index++];
    else if (!command) break;
    const relative = command === command.toLowerCase(), key = command.toUpperCase();
    if (key === 'M') {
      flush();
      current = point(relative);
      start = { ...current };
      nodes = [anchor(current)];
      previousControl = null;
      command = relative ? 'l' : 'L';
      continue;
    }
    if (!nodes.length) nodes = [anchor(current)];
    if (key === 'Z') {
      if (nodes.length > 1) closed = true;
      current = { ...start };
      flush();
      previousControl = null;
      continue;
    }
    let end: Point;
    if (key === 'L') end = point(relative);
    else if (key === 'H') { const x = number(); end = { x: relative ? current.x + x : x, y: current.y }; }
    else if (key === 'V') { const y = number(); end = { x: current.x, y: relative ? current.y + y : y }; }
    else if (key === 'C' || key === 'S' || key === 'Q' || key === 'T') {
      const first: Point = key === 'C' || key === 'Q' ? point(relative)
        : previousControl && 'ST'.includes(key)
          ? { x: 2 * current.x - previousControl.x, y: 2 * current.y - previousControl.y }
          : { ...current };
      const second: Point = key === 'C' || key === 'S' ? point(relative) : first;
      end = point(relative);
      if (key === 'Q' || key === 'T') {
        // A quadratic is one cubic with both controls two thirds of the way to the apex.
        pushCubic(nodes,
          { x: current.x + (2 / 3) * (first.x - current.x), y: current.y + (2 / 3) * (first.y - current.y) },
          { x: end.x + (2 / 3) * (first.x - end.x), y: end.y + (2 / 3) * (first.y - end.y) }, end);
        previousControl = first;
        current = end;
        continue;
      }
      pushCubic(nodes, first, second, end);
      previousControl = second;
      current = end;
      continue;
    } else if (key === 'A') {
      const rx = number(), ry = number(), rotation = number(), large = number() !== 0, sweep = number() !== 0;
      end = point(relative);
      arcTo(nodes, current, rx, ry, rotation, large, sweep, end);
      previousControl = null;
      current = end;
      continue;
    } else break;
    pushCubic(nodes, current, end, end);
    previousControl = null;
    current = end;
  }
  flush();
  return paths;
}

const ELLIPSE_KAPPA = 0.5522847498307936;
/** A closed ellipse as four cubic quarters, the same construction the shape tools use. */
function ellipseCurves(cx: number, cy: number, rx: number, ry: number): CurvePath[] {
  const points: Point[] = [{ x: cx + rx, y: cy }, { x: cx, y: cy + ry }, { x: cx - rx, y: cy }, { x: cx, y: cy - ry }];
  const tangents: Point[] = [{ x: 0, y: ry * ELLIPSE_KAPPA }, { x: -rx * ELLIPSE_KAPPA, y: 0 }, { x: 0, y: -ry * ELLIPSE_KAPPA }, { x: rx * ELLIPSE_KAPPA, y: 0 }];
  return [{
    closed: true,
    nodes: points.map((point, index) => ({
      point: { ...point },
      outgoing: { x: point.x + tangents[index].x, y: point.y + tangents[index].y },
      incoming: { x: point.x - tangents[index].x, y: point.y - tangents[index].y },
      smooth: true,
    })),
  }];
}
const polygonCurves = (points: Point[], closed: boolean): CurvePath[] =>
  points.length > 1 ? [{ closed, nodes: points.map((point) => anchor(point)) }] : [];
function pointList(value: string | undefined): Point[] {
  const numbers = (value ?? '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
  return points;
}
/** The inline style attribute, which overrides presentation attributes of the same element. */
function inlineStyle(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const declaration of (value ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) result[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
  }
  return result;
}
interface Appearance {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}
const ROOT_APPEARANCE: Appearance = { fill: '#000000', stroke: 'none', strokeWidth: 1, opacity: 1 };
/** The shapes a drawing is made of; everything else is reported as skipped. */
const SHAPES = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text'];
const CONTAINERS = ['svg', 'g', 'a', 'switch'];
const IGNORED = ['defs', 'style', 'title', 'desc', 'metadata', 'clippath', 'mask', 'filter', 'lineargradient', 'radialgradient', 'pattern', 'symbol', 'script'];

/** Reads an SVG drawing into native layers, with its own group for the file. */
export function importSvg(text: string, options: { name?: string; limits?: ImportLimits } = {}): ImportResult {
  const limits = options.limits ?? IMPORT_LIMITS;
  const root = parseXml(text, limits).children.find((node) => node.name === 'svg');
  if (!root) throw new Error('The file does not contain an SVG drawing.');
  const declared = { width: importLength(root.attributes['width'], 0), height: importLength(root.attributes['height'], 0) };
  const viewBox = (root.attributes['viewbox'] ?? '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
  let base: Matrix = IDENTITY;
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    // The viewBox maps onto the declared size; without a size the drawing keeps its own units.
    const scaleX = declared.width ? declared.width / viewBox[2] : 1, scaleY = declared.height ? declared.height / viewBox[3] : 1;
    const scale = Math.min(scaleX, scaleY);
    base = [scale, 0, 0, scale, -viewBox[0] * scale, -viewBox[1] * scale];
  }
  const size = declared.width > 0 && declared.height > 0 ? declared
    : viewBox.length === 4 ? { width: viewBox[2], height: viewBox[3] } : undefined;
  const group = (options.name ?? 'Imported drawing').slice(0, 80);
  const state = { layers: [] as Layer[], skipped: new Set<string>(), nodes: 0, limits, group };
  for (const child of root.children) readNode(child, base, ROOT_APPEARANCE, state, []);
  return { layers: state.layers, size, skipped: [...state.skipped] };
}
interface ReaderState {
  layers: Layer[];
  skipped: Set<string>;
  nodes: number;
  limits: ImportLimits;
  group: string;
}
function readNode(node: XmlNode, parent: Matrix, inherited: Appearance, state: ReaderState, path: string[]) {
  if (IGNORED.includes(node.name)) {
    if (node.name !== 'defs' && node.name !== 'style' && node.name !== 'title' && node.name !== 'desc' && node.name !== 'metadata') {
      state.skipped.add(node.name === 'script' ? 'scripts' : node.name);
    }
    return;
  }
  const style = inlineStyle(node.attributes['style']);
  const read = (key: string) => style[key] ?? node.attributes[key];
  const fill = importPaint(read('fill'), inherited.fill);
  const stroke = importPaint(read('stroke'), inherited.stroke);
  for (const reported of [fill.skipped, stroke.skipped]) if (reported) state.skipped.add(reported);
  const matrix = multiply(parent, parseTransform(node.attributes['transform']));
  const appearance: Appearance = {
    fill: fill.paint,
    stroke: stroke.paint,
    strokeWidth: read('stroke-width') === undefined ? inherited.strokeWidth : importLength(read('stroke-width'), inherited.strokeWidth),
    opacity: read('opacity') === undefined ? inherited.opacity : Math.max(0, Math.min(1, Number(read('opacity')) || 0)),
  };
  if (CONTAINERS.includes(node.name)) {
    const named = node.attributes['id'] ? [...path, node.attributes['id'].slice(0, 40)] : path;
    for (const child of node.children) readNode(child, matrix, appearance, state, named);
    return;
  }
  if (!SHAPES.includes(node.name)) {
    state.skipped.add(node.name);
    return;
  }
  const layer = shapeLayer(node, matrix, appearance, state);
  if (!layer) return;
  layer.groupPath = [state.group, ...path].slice(0, 16);
  state.layers.push(layer);
}
function shapeLayer(node: XmlNode, matrix: Matrix, appearance: Appearance, state: ReaderState): Layer | null {
  const attribute = (key: string, fallback = 0) => importLength(node.attributes[key], fallback);
  let curves: CurvePath[] = [];
  if (node.name === 'rect') {
    const x = attribute('x'), y = attribute('y'), width = attribute('width'), height = attribute('height');
    if (!(width > 0 && height > 0)) return null;
    if (attribute('rx') || attribute('ry')) state.skipped.add('rounded corners');
    curves = polygonCurves([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], true);
  } else if (node.name === 'circle' || node.name === 'ellipse') {
    const rx = node.name === 'circle' ? attribute('r') : attribute('rx');
    const ry = node.name === 'circle' ? attribute('r') : attribute('ry');
    if (!(rx > 0 && ry > 0)) return null;
    curves = ellipseCurves(attribute('cx'), attribute('cy'), rx, ry);
  } else if (node.name === 'line') {
    curves = polygonCurves([{ x: attribute('x1'), y: attribute('y1') }, { x: attribute('x2'), y: attribute('y2') }], false);
  } else if (node.name === 'polyline' || node.name === 'polygon') {
    curves = polygonCurves(pointList(node.attributes['points']), node.name === 'polygon');
  } else if (node.name === 'path') {
    curves = parsePathData(node.attributes['d'] ?? '');
  } else if (node.name === 'text') {
    return textLayer(node, matrix, appearance, state);
  }
  if (!curves.length) return null;
  // A filled shape is painted as a closed contour, which is what the drawing means even
  // when the path was left open; a shape that is only stroked keeps its ends apart.
  if (appearance.fill !== 'none' && curves.some((path) => !path.closed) && node.name === 'path') {
    curves = curves.map((path) => ({ ...path, closed: true }));
  }
  const nodes = curves.reduce((total, path) => total + path.nodes.length, 0);
  state.nodes += nodes;
  if (state.nodes > state.limits.maxNodes) throw new Error('The drawing exceeds the import node limit.');
  const placed = curves.map((path) => ({
    closed: path.closed,
    nodes: path.nodes.map((item) => ({
      point: apply(matrix, item.point),
      incoming: apply(matrix, item.incoming),
      outgoing: apply(matrix, item.outgoing),
      smooth: item.smooth,
    })),
  }));
  const layer = newLayer('path', crypto.randomUUID(), { x: 0, y: 0 });
  layer.name = (node.attributes['id'] ?? node.name).slice(0, 80);
  layer.fill = appearance.fill;
  layer.stroke = appearance.stroke;
  layer.strokeWidth = Math.max(0, appearance.strokeWidth * scaleOf(matrix));
  layer.opacity = appearance.opacity;
  return fitCurves(layer, placed);
}
function textLayer(node: XmlNode, matrix: Matrix, appearance: Appearance, state: ReaderState): Layer | null {
  const content = [node.text, ...node.children.map((child) => child.text)].filter(Boolean).join(' ').trim();
  if (!content) return null;
  if (node.children.some((child) => child.name === 'textpath')) state.skipped.add('text on a path');
  const style = inlineStyle(node.attributes['style']);
  const size = Math.max(1, importLength(style['font-size'] ?? node.attributes['font-size'], 16) * scaleOf(matrix));
  const origin = apply(matrix, { x: importLength(node.attributes['x'], 0), y: importLength(node.attributes['y'], 0) });
  const layer = newLayer('text', crypto.randomUUID(), { x: origin.x, y: origin.y - size });
  layer.name = content.slice(0, 40);
  layer.text = content.slice(0, 2000);
  layer.fontSize = size;
  layer.width = Math.max(1, content.length * size * 0.5);
  layer.height = Math.max(1, size * 1.3);
  layer.fill = appearance.fill === 'none' ? '#000000' : appearance.fill;
  layer.stroke = 'none';
  layer.opacity = appearance.opacity;
  return layer;
}
