import { Layer, StudioDocument, defaultStrokeStyle } from './document';
import { CurvePath, worldPoint } from './curves';
import { brushOutline } from './brush-stroke';
import { ellipsePath, polyline } from './shapes';
import { materializeProcedural, projectionCurves, projectionDash } from './procedural';
import { GradientPaint, PatternDefinition, gradientGeometry, renderedStops } from './paint';
import { materializeEnvelopes } from './envelope';

/**
 * A small PDF writer for the documents this editor makes. It emits vector geometry, not a
 * picture of it: paths keep their curves, strokes keep their dashes and text keeps its
 * characters. The file is assembled here; the bytes of any raster image arrive ready.
 */
export interface PdfImage {
  /** JPEG bytes as a binary string, which the writer stores as a DCTDecode stream. */
  data: string;
  width: number;
  height: number;
}
export interface PdfPageSource {
  document: StudioDocument;
  /** JPEG bytes per image layer id, prepared by the caller, which owns the canvas. */
  images?: Record<string, PdfImage>;
}
export interface PdfResult {
  /** The file as a binary string; each character is one byte. */
  data: string;
  /** Content the writer could not represent, named once each. */
  skipped: string[];
}
const round = (value: number) => Number.parseFloat(value.toFixed(3)).toString();
/** PDF measures from the bottom left in points; the document measures from the top left in pixels. */
const POINTS_PER_PIXEL = 72 / 96;

interface Paint {
  colour: [number, number, number];
  alpha: number;
}
/** Native paints are six or eight hexadecimal digits, or none. */
function readPaint(value: string): Paint | null {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return null;
  const channel = (index: number) => Number.parseInt(value.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return { colour: [channel(0), channel(1), channel(2)], alpha: value.length === 9 ? channel(3) : 1 };
}
const colourOperator = (paint: Paint, stroke: boolean) =>
  `${paint.colour.map(round).join(' ')} ${stroke ? 'RG' : 'rg'}`;

/** World geometry of a layer, in document coordinates, as the writer draws it. */
function layerCurves(layer: Layer): CurvePath[] {
  const local = layer.curves
    ? layer.curves
    : layer.kind === 'rectangle'
      ? [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: layer.width, y: 0 }, { x: layer.width, y: layer.height }, { x: 0, y: layer.height }].map((point) => ({ point, incoming: point, outgoing: point, smooth: false })) }]
      : layer.kind === 'ellipse'
        ? [ellipsePath(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2)]
        : layer.kind === 'path'
          ? [polyline(layer.points)]
          : [];
  return local.map((path) => ({
    closed: path.closed,
    nodes: path.nodes.map((node) => ({
      point: worldPoint(layer, node.point),
      incoming: worldPoint(layer, node.incoming),
      outgoing: worldPoint(layer, node.outgoing),
      smooth: node.smooth,
    })),
  }));
}
/** The matrix that places an object's own coordinates on the page, as worldPoint does. */
function layerMatrix(layer: Layer): number[] {
  const o = worldPoint(layer, { x: 0, y: 0 }), x = worldPoint(layer, { x: 1, y: 0 }), y = worldPoint(layer, { x: 0, y: 1 });
  return [x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y];
}
/**
 * A gradient as a PDF shading in the object's own coordinates: axial or radial, its stops
 * as a stitched function of linear pieces and its ends extended, as the canvas paints it.
 */
export function gradientShading(paint: GradientPaint, width: number, height: number): { shading: string; transparent: boolean } {
  const g = gradientGeometry(paint, width, height);
  const stops = renderedStops(paint);
  if (stops[0].offset > 0) stops.unshift({ offset: 0, color: stops[0].color });
  if (stops[stops.length - 1].offset < 1) stops.push({ offset: 1, color: stops[stops.length - 1].color });
  const rgb = (color: string) => (readPaint(color)?.colour ?? [0, 0, 0]).map(round).join(' ');
  const pieces: string[] = [], bounds: number[] = [];
  for (let i = 1; i < stops.length; i++) {
    pieces.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[i - 1].color)}] /C1 [${rgb(stops[i].color)}] /N 1 >>`);
    if (i < stops.length - 1) bounds.push(stops[i].offset);
  }
  const fn = pieces.length === 1 ? pieces[0]
    : `<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.join(' ')}] /Bounds [${bounds.map(round).join(' ')}] /Encode [${pieces.map(() => '0 1').join(' ')}] >>`;
  const coords = paint.type === 'radial'
    ? [g.start.x, g.start.y, 0, g.start.x, g.start.y, g.radius]
    : [g.start.x, g.start.y, g.end.x, g.end.y];
  return {
    shading: `<< /ShadingType ${paint.type === 'radial' ? 3 : 2} /ColorSpace /DeviceRGB /Coords [${coords.map(round).join(' ')}] /Function ${fn} /Extend [true true] >>`,
    transparent: stops.some((stop) => (readPaint(stop.color)?.alpha ?? 1) < 1),
  };
}
/** The artwork of a pattern tile as operators, in the tile's own coordinates. */
function tileOperators(pattern: PatternDefinition, skipped: Set<string>): string {
  const parts: string[] = [];
  for (const layer of pattern.layers) {
    if (!layer.visible) continue;
    const fill = readPaint(layer.fill), stroke = readPaint(layer.stroke), curves = layerCurves(layer);
    if (!curves.length) continue;
    if ((fill && fill.alpha < 1) || (stroke && stroke.alpha < 1) || layer.opacity < 1) skipped.add('transparency inside patterns');
    if (fill && fill.alpha > 0) parts.push(`${colourOperator(fill, false)}\n${pathOperators(curves.map((path) => ({ ...path, closed: true })))}\nf*`);
    if (stroke && stroke.alpha > 0 && layer.strokeWidth > 0) parts.push(`${colourOperator(stroke, true)} ${round(layer.strokeWidth)} w\n${pathOperators(curves)}\nS`);
  }
  return parts.join('\n');
}
/** The path of a contour as PDF operators, in the coordinates the caller already placed. */
export function pathOperators(paths: CurvePath[]): string {
  return paths
    .filter((path) => path.nodes.length)
    .map((path) => {
      const first = path.nodes[0].point;
      let operators = `${round(first.x)} ${round(first.y)} m`;
      const count = path.closed ? path.nodes.length : path.nodes.length - 1;
      for (let index = 0; index < count; index++) {
        const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length];
        operators += ` ${round(a.outgoing.x)} ${round(a.outgoing.y)} ${round(b.incoming.x)} ${round(b.incoming.y)} ${round(b.point.x)} ${round(b.point.y)} c`;
      }
      return operators + (path.closed ? ' h' : '');
    })
    .join('\n');
}
/** Escapes the characters a PDF string cannot carry raw, and drops what WinAnsi cannot show. */
export function pdfText(value: string): { text: string; dropped: boolean } {
  let dropped = false;
  const text = [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code > 255) { dropped = true; return '?'; }
    if (character === '(' || character === ')' || character === '\\') return '\\' + character;
    if (code < 32) return ' ';
    return character;
  }).join('');
  return { text, dropped };
}
interface PageContent {
  content: string;
  images: { name: string; image: PdfImage }[];
  alphas: number[];
  /** Gradient shadings and pattern tiles the page paints with, named /Sh and /P in order. */
  shadings: string[];
  patterns: { id: string; body: string; stream: string }[];
  skipped: Set<string>;
}
/** Draws one document into a content stream, with the alpha states and images it needs. */
function pageContent(source: PdfPageSource): PageContent {
  const document = materializeEnvelopes(materializeProcedural(source.document));
  const images: { name: string; image: PdfImage }[] = [];
  const alphas: number[] = [];
  const shadings: string[] = [];
  const patterns: { id: string; body: string; stream: string }[] = [];
  const skipped = new Set<string>();
  const parts: string[] = [];
  const alphaName = (fill: number, stroke: number) => {
    const key = Math.round(fill * 1000) * 1000 + Math.round(stroke * 1000);
    if (!alphas.includes(key)) alphas.push(key);
    return `/GS${alphas.indexOf(key)} gs`;
  };
  const background = readPaint(document.background ?? '#ffffff');
  if (background && background.alpha > 0) {
    parts.push(`q ${colourOperator(background, false)} 0 0 ${round(document.width)} ${round(document.height)} re f Q`);
  }
  for (const layer of document.layers) {
    if (!layer.visible || layer.guide || layer.opacity === 0) continue;
    if (layer.blend && layer.blend !== 'source-over') skipped.add('blend modes');
    const fill = readPaint(layer.fill), stroke = readPaint(layer.stroke);
    const style = layer.strokeStyle ?? defaultStrokeStyle;
    if (layer.kind === 'image') {
      const image = source.images?.[layer.id];
      if (!image) { skipped.add('images'); continue; }
      const name = `/Im${images.length}`;
      images.push({ name, image });
      // The image space is the unit square, mapped onto the box of the layer.
      const centre = worldPoint(layer, { x: layer.width / 2, y: layer.height / 2 });
      const radians = (layer.rotation * Math.PI) / 180, cos = Math.cos(radians), sin = Math.sin(radians);
      const matrix = [layer.width * cos, layer.width * sin, layer.height * sin, -layer.height * cos,
        centre.x - (layer.width * cos + layer.height * sin) / 2, centre.y - (layer.width * sin - layer.height * cos) / 2];
      parts.push(`q ${alphaName(layer.opacity, layer.opacity)} ${matrix.map(round).join(' ')} cm ${name} Do Q`);
      continue;
    }
    if (layer.kind === 'text') {
      if (!fill) { skipped.add('text without a solid colour'); continue; }
      const { text, dropped } = pdfText(layer.text ?? '');
      if (dropped) skipped.add('characters outside the Latin range');
      if (!text) continue;
      const size = layer.fontSize || 16;
      const origin = worldPoint(layer, { x: 0, y: size });
      parts.push(`q ${alphaName(layer.opacity * fill.alpha, layer.opacity)} ${colourOperator(fill, false)} BT /F1 ${round(size)} Tf`
        // The page is flipped, so the text matrix flips back and the glyphs stand upright.
        + ` 1 0 0 -1 ${round(origin.x)} ${round(origin.y)} Tm (${text}) Tj ET Q`);
      skipped.add('text is drawn with the standard font');
      continue;
    }
    const curves = layerCurves(layer);
    if (!curves.length) continue;
    const projection = projectionCurves(layer);
    const drawn = curves.filter((_, index) => !projection[index]);
    const closed = drawn.filter((path) => path.closed), open = drawn.filter((path) => !path.closed);
    const width = Math.max(0, layer.strokeWidth);
    const dash = style.dash?.length ? `[${style.dash.map(round).join(' ')}] 0 d` : '[] 0 d';
    const caps = { butt: 0, round: 1, square: 2 }[style.cap] ?? 0;
    const joins = { miter: 0, round: 1, bevel: 2 }[style.join] ?? 0;
    const settings = `${round(width)} w ${caps} J ${joins} j ${dash}`;
    // Filling closes every contour it paints, so an open path is filled as it is drawn.
    const paint = layer.fillPaint;
    const pattern = paint?.kind === 'pattern' ? document.patterns?.find((entry) => entry.id === paint.patternId) : undefined;
    if (fill && fill.alpha > 0 && drawn.length && paint?.kind === 'gradient') {
      // The shape clips the page and the shading fills it in the object's own coordinates.
      const { shading, transparent } = gradientShading(paint, layer.width, layer.height);
      if (transparent) skipped.add('transparent gradient stops');
      shadings.push(shading);
      parts.push(`q ${alphaName(layer.opacity * fill.alpha, layer.opacity)}\n${pathOperators(drawn.map((path) => ({ ...path, closed: true })))}\nW* n ${layerMatrix(layer).map(round).join(' ')} cm /Sh${shadings.length - 1} sh Q`);
    } else if (fill && fill.alpha > 0 && drawn.length && pattern) {
      let index = patterns.findIndex((entry) => entry.id === pattern.id);
      if (index < 0) {
        // Pattern space is the page's own, so the tile is laid out from the document origin.
        const matrix = [POINTS_PER_PIXEL, 0, 0, -POINTS_PER_PIXEL, 0, document.height * POINTS_PER_PIXEL];
        const stream = tileOperators(pattern, skipped);
        patterns.push({ id: pattern.id, stream, body: `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 ${round(pattern.width)} ${round(pattern.height)}] /XStep ${round(pattern.width)} /YStep ${round(pattern.height)} /Resources << >> /Matrix [${matrix.map(round).join(' ')}]` });
        index = patterns.length - 1;
      }
      parts.push(`q ${alphaName(layer.opacity * fill.alpha, layer.opacity)} /Pattern cs /P${index} scn\n${pathOperators(drawn.map((path) => ({ ...path, closed: true })))}\nf* Q`);
    } else if (fill && fill.alpha > 0 && drawn.length) {
      parts.push(`q ${alphaName(layer.opacity * fill.alpha, layer.opacity)} ${colourOperator(fill, false)}\n${pathOperators(drawn.map((path) => ({ ...path, closed: true })))}\nf* Q`);
    }
    if (layer.brushStroke && layer.curves && stroke && stroke.alpha > 0 && width > 0) {
      // A brushed path is the area its nib sweeps, measured on the object and placed on the page.
      const rings = layer.curves
        .filter((_, index) => !projection[index])
        .flatMap((path) => brushOutline(path, layer.brushStroke!, width))
        .filter((ring) => ring.length > 2)
        .map((ring) => ring.map((point) => worldPoint(layer, point)));
      const operators = rings.map((ring) => `${round(ring[0].x)} ${round(ring[0].y)} m ${ring.slice(1).map((point) => `${round(point.x)} ${round(point.y)} l`).join(' ')} h`).join('\n');
      if (operators) parts.push(`q ${alphaName(layer.opacity * stroke.alpha, layer.opacity)} ${colourOperator(stroke, false)}\n${operators}\nf Q`);
    } else if (stroke && stroke.alpha > 0 && width > 0 && drawn.length) {
      if (style.alignment && style.alignment !== 'center') skipped.add('inside and outside strokes');
      parts.push(`q ${alphaName(layer.opacity, layer.opacity * stroke.alpha)} ${colourOperator(stroke, true)} ${settings}\n${pathOperators([...closed, ...open])}\nS Q`);
    }
    const projected = curves.filter((_, index) => projection[index]);
    if (projected.length && stroke && width > 0) {
      parts.push(`q ${alphaName(layer.opacity, layer.opacity * stroke.alpha)} ${colourOperator(stroke, true)} ${round(width)} w`
        + ` [${projectionDash(layer.strokeWidth).map(round).join(' ')}] 0 d\n${pathOperators(projected)}\nS Q`);
    }
  }
  // The page is written in document coordinates and flipped once into PDF space.
  const flip = `${round(POINTS_PER_PIXEL)} 0 0 ${round(-POINTS_PER_PIXEL)} 0 ${round(document.height * POINTS_PER_PIXEL)} cm`;
  return { content: `q ${flip}\n${parts.join('\n')}\nQ`, images, alphas, shadings, patterns, skipped };
}
/**
 * Writes the documents as one PDF file, one page each, with the page size the document
 * declares. The result is a binary string ready to be saved.
 */
export function pdfDocument(sources: PdfPageSource[]): PdfResult {
  if (!sources.length) throw new Error('A PDF needs at least one page.');
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const skipped = new Set<string>();
  const pagesId = 1;
  objects.push('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const source of sources) {
    const page = pageContent(source);
    for (const entry of page.skipped) skipped.add(entry);
    const contentId = add(`<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`);
    const imageIds = page.images.map(({ name, image }) => ({
      name,
      id: add(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
        + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n${image.data}\nendstream`),
    }));
    const alphaIds = page.alphas.map((key) => ({
      key,
      id: add(`<< /Type /ExtGState /ca ${round(Math.floor(key / 1000) / 1000)} /CA ${round((key % 1000) / 1000)} >>`),
    }));
    const shadingIds = page.shadings.map((body) => add(body));
    const patternIds = page.patterns.map((pattern) => add(`<< ${pattern.body} /Length ${pattern.stream.length} >>\nstream\n${pattern.stream}\nendstream`));
    const resources = `<< /Font << /F1 ${fontId} 0 R >>`
      + (shadingIds.length ? ` /Shading << ${shadingIds.map((id, index) => `/Sh${index} ${id} 0 R`).join(' ')} >>` : '')
      + (patternIds.length ? ` /Pattern << ${patternIds.map((id, index) => `/P${index} ${id} 0 R`).join(' ')} >>` : '')
      + (imageIds.length ? ` /XObject << ${imageIds.map((entry) => `${entry.name} ${entry.id} 0 R`).join(' ')} >>` : '')
      + (alphaIds.length ? ` /ExtGState << ${alphaIds.map((entry, index) => `/GS${index} ${entry.id} 0 R`).join(' ')} >>` : '')
      + ' >>';
    const width = source.document.width * POINTS_PER_PIXEL, height = source.document.height * POINTS_PER_PIXEL;
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${round(width)} ${round(height)}]`
      + ` /Resources ${resources} /Contents ${contentId} 0 R >>`));
  }
  objects[0] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let file = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return { data: file, skipped: [...skipped] };
}
