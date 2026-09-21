import { Layer, newLayer, Point } from './document';
import { Anchor, CurvePath, anchor, fitCurves } from './curves';
import { ImportLimits, IMPORT_LIMITS, ImportResult } from './svg-import';

/**
 * Reader for the ASCII group-code form of DXF. The file is untrusted data: it is read as
 * pairs of a numeric code and a value, nothing is resolved outside the file and every count
 * is capped. Entities the reader cannot represent are reported, never approximated.
 */
interface Entity {
  type: string;
  /** Group codes of the entity; repeated codes keep their order. */
  values: [number, string][];
}
const numbersOf = (entity: Entity, code: number): number[] =>
  entity.values.filter(([key]) => key === code).map(([, value]) => Number(value)).filter(Number.isFinite);
const numberOf = (entity: Entity, code: number, fallback = 0): number => numbersOf(entity, code)[0] ?? fallback;
const textOf = (entity: Entity, code: number): string => entity.values.find(([key]) => key === code)?.[1] ?? '';

/** The seven fixed colours of the AutoCAD index; the rest keep the drawing appearance. */
const INDEX_COLORS: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#000000',
};
/** Entities this reader represents; anything else in the entities section is reported. */
const SUPPORTED = ['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'POINT', 'TEXT', 'MTEXT'];

export function parseDxf(text: string, limits: ImportLimits = IMPORT_LIMITS): Entity[] {
  if (text.length > limits.maxCharacters) throw new Error('The drawing exceeds the import size limit.');
  const lines = text.split(/\r\n|\r|\n/);
  const entities: Entity[] = [];
  let current: Entity | null = null, inEntities = false;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    const value = lines[index + 1].trim();
    if (!Number.isFinite(code)) continue;
    if (code === 0) {
      if (value === 'SECTION') { current = null; continue; }
      if (value === 'ENDSEC') { inEntities = false; current = null; continue; }
      if (!inEntities) continue;
      if (value === 'SEQEND') { current = null; continue; }
      if (value === 'VERTEX' && current?.type === 'POLYLINE') continue;
      if (entities.length >= limits.maxElements) throw new Error('The drawing exceeds the import element limit.');
      current = { type: value, values: [] };
      entities.push(current);
      continue;
    }
    if (code === 2 && value === 'ENTITIES') { inEntities = true; continue; }
    if (current) current.values.push([code, value]);
  }
  return entities.filter((entity) => entity.type !== 'VERTEX');
}
/** DXF measures upwards, the document downwards, so the drawing is mirrored once on import. */
const flip = (point: Point): Point => ({ x: point.x, y: -point.y });
const polyline = (points: Point[], closed: boolean): CurvePath[] =>
  points.length > 1 ? [{ closed, nodes: points.map((point) => anchor(flip(point))) }] : [];

/** An arc of an ellipse as cubic quarters, in the coordinates of the drawing. */
function arcCurve(centre: Point, rx: number, ry: number, from: number, to: number, rotation = 0): CurvePath {
  let sweep = to - from;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const closed = sweep >= 2 * Math.PI - 1e-9;
  const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 2)));
  const step = sweep / steps, alpha = (4 / 3) * Math.tan(step / 4);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const at = (angle: number): Point => ({
    x: centre.x + rx * Math.cos(angle) * cos - ry * Math.sin(angle) * sin,
    y: centre.y + rx * Math.cos(angle) * sin + ry * Math.sin(angle) * cos,
  });
  const derivative = (angle: number): Point => ({
    x: -rx * Math.sin(angle) * cos - ry * Math.cos(angle) * sin,
    y: -rx * Math.sin(angle) * sin + ry * Math.cos(angle) * cos,
  });
  const nodes: Anchor[] = [anchor(flip(at(from)))];
  for (let index = 0; index < steps; index++) {
    const start = from + step * index, end = start + step;
    const a = at(start), b = at(end), da = derivative(start), db = derivative(end);
    nodes[nodes.length - 1].outgoing = flip({ x: a.x + alpha * da.x, y: a.y + alpha * da.y });
    const next = anchor(flip(b));
    next.incoming = flip({ x: b.x - alpha * db.x, y: b.y - alpha * db.y });
    nodes.push(next);
  }
  if (closed && nodes.length > 1) {
    // A full turn meets itself: the last node carries the tangent of the first one.
    nodes[0].incoming = nodes[nodes.length - 1].incoming;
    nodes.pop();
  }
  return { nodes, closed };
}
function entityCurves(entity: Entity): CurvePath[] {
  const x = numbersOf(entity, 10), y = numbersOf(entity, 20);
  const point = (index = 0): Point => ({ x: x[index] ?? 0, y: y[index] ?? 0 });
  if (entity.type === 'LINE') return polyline([point(0), { x: numberOf(entity, 11), y: numberOf(entity, 21) }], false);
  if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
    const points = x.map((value, index) => ({ x: value, y: y[index] ?? 0 }));
    return polyline(points, (numberOf(entity, 70) & 1) === 1);
  }
  if (entity.type === 'CIRCLE') {
    const radius = numberOf(entity, 40);
    return radius > 0 ? [arcCurve(point(0), radius, radius, 0, 2 * Math.PI)] : [];
  }
  if (entity.type === 'ARC') {
    const radius = numberOf(entity, 40);
    const from = (numberOf(entity, 50) * Math.PI) / 180, to = (numberOf(entity, 51) * Math.PI) / 180;
    return radius > 0 ? [arcCurve(point(0), radius, radius, from, to === from ? to + 2 * Math.PI : to)] : [];
  }
  if (entity.type === 'ELLIPSE') {
    const major = { x: numberOf(entity, 11), y: numberOf(entity, 21) };
    const rx = Math.hypot(major.x, major.y), ratio = numberOf(entity, 40, 1);
    if (!(rx > 0) || !(ratio > 0)) return [];
    const from = numberOf(entity, 41), to = numberOf(entity, 42, 2 * Math.PI);
    return [arcCurve(point(0), rx, rx * ratio, from, to, Math.atan2(major.y, major.x))];
  }
  if (entity.type === 'POINT') {
    // A point has no extent; it becomes the shortest visible mark so it can be selected.
    const centre = point(0);
    return polyline([centre, { x: centre.x + 1, y: centre.y }], false);
  }
  return [];
}
/** Reads an ASCII DXF drawing into native layers, with its own group for the file. */
export function importDxf(text: string, options: { name?: string; limits?: ImportLimits } = {}): ImportResult {
  const limits = options.limits ?? IMPORT_LIMITS;
  const entities = parseDxf(text, limits);
  if (!entities.length) throw new Error('The file does not contain an ASCII DXF drawing.');
  const group = (options.name ?? 'Imported drawing').slice(0, 80);
  const layers: Layer[] = [];
  const skipped = new Set<string>();
  let nodes = 0;
  for (const entity of entities) {
    if (!SUPPORTED.includes(entity.type)) {
      skipped.add(entity.type.toLowerCase());
      continue;
    }
    if (numbersOf(entity, 42).some((bulge) => bulge !== 0)) skipped.add('polyline arcs');
    const stroke = INDEX_COLORS[numberOf(entity, 62, 7)] ?? '#000000';
    const name = (textOf(entity, 8) || entity.type).slice(0, 40);
    if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
      const layer = textEntity(entity, stroke, name);
      if (layer) layers.push(withGroup(layer, group, textOf(entity, 8)));
      continue;
    }
    const curves = entityCurves(entity);
    if (!curves.length) continue;
    nodes += curves.reduce((total, path) => total + path.nodes.length, 0);
    if (nodes > limits.maxNodes) throw new Error('The drawing exceeds the import node limit.');
    const layer = newLayer('path', crypto.randomUUID(), { x: 0, y: 0 });
    layer.name = name;
    // A drawing carries outlines, not filled artwork, so the shapes arrive stroked only.
    layer.fill = 'none';
    layer.stroke = stroke;
    layer.strokeWidth = 1;
    layers.push(withGroup(fitCurves(layer, curves), group, textOf(entity, 8)));
  }
  return { layers, skipped: [...skipped] };
}
function withGroup(layer: Layer, group: string, drawingLayer: string): Layer {
  layer.groupPath = drawingLayer ? [group, drawingLayer.slice(0, 40)] : [group];
  return layer;
}
function textEntity(entity: Entity, colour: string, name: string): Layer | null {
  const content = textOf(entity, 1).replace(/\\[A-Za-z][^;]*;/g, '').trim();
  if (!content) return null;
  const size = Math.max(1, numberOf(entity, 40, 10));
  const origin = flip({ x: numberOf(entity, 10), y: numberOf(entity, 20) });
  const layer = newLayer('text', crypto.randomUUID(), { x: origin.x, y: origin.y - size });
  layer.name = name;
  layer.text = content.slice(0, 2000);
  layer.fontSize = size;
  layer.width = Math.max(1, content.length * size * 0.5);
  layer.height = Math.max(1, size * 1.3);
  layer.fill = colour;
  layer.stroke = 'none';
  return layer;
}
