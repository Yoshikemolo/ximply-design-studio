import type { Layer, Point, StudioDocument } from './document';
import { newLayer } from './document';
import { ellipsePath, polyline } from './shapes';
import { fromPixels, toPixels, Unit } from './measurements';

/** Document limits of the native format; a page outside them cannot be stored. */
export const PAGE_MINIMUM = 16;
export const PAGE_MAXIMUM = 8192;
export type PageCategory = 'paper' | 'screen' | 'animation';
export interface PageFormat {
  id: string;
  label: string;
  category: PageCategory;
  /** Physical formats carry their size in millimetres; pixel formats carry device pixels. */
  width: number;
  height: number;
  unit: Unit;
}
/** Paper sizes follow ISO 216 (DIN A); pixel formats are common display and delivery sizes. */
export const PAGE_FORMATS: PageFormat[] = [
  { id: 'a6', label: 'A6', category: 'paper', width: 105, height: 148, unit: 'mm' },
  { id: 'a5', label: 'A5', category: 'paper', width: 148, height: 210, unit: 'mm' },
  { id: 'a4', label: 'A4', category: 'paper', width: 210, height: 297, unit: 'mm' },
  { id: 'a3', label: 'A3', category: 'paper', width: 297, height: 420, unit: 'mm' },
  { id: 'a2', label: 'A2', category: 'paper', width: 420, height: 594, unit: 'mm' },
  { id: 'a1', label: 'A1', category: 'paper', width: 594, height: 841, unit: 'mm' },
  { id: 'a0', label: 'A0', category: 'paper', width: 841, height: 1189, unit: 'mm' },
  { id: 'letter', label: 'Letter', category: 'paper', width: 215.9, height: 279.4, unit: 'mm' },
  { id: 'screen-hd', label: '1280 x 720', category: 'screen', width: 1280, height: 720, unit: 'px' },
  { id: 'screen-wxga', label: '1366 x 768', category: 'screen', width: 1366, height: 768, unit: 'px' },
  { id: 'screen-fhd', label: '1920 x 1080', category: 'screen', width: 1920, height: 1080, unit: 'px' },
  { id: 'screen-qhd', label: '2560 x 1440', category: 'screen', width: 2560, height: 1440, unit: 'px' },
  { id: 'screen-uhd', label: '3840 x 2160', category: 'screen', width: 3840, height: 2160, unit: 'px' },
  { id: 'anim-hd', label: 'HD 1080p', category: 'animation', width: 1920, height: 1080, unit: 'px' },
  { id: 'anim-2k', label: 'DCI 2K flat', category: 'animation', width: 1998, height: 1080, unit: 'px' },
  { id: 'anim-square', label: 'Square 1080', category: 'animation', width: 1080, height: 1080, unit: 'px' },
  { id: 'anim-vertical', label: 'Vertical 1080 x 1920', category: 'animation', width: 1080, height: 1920, unit: 'px' },
  { id: 'anim-pal', label: 'PAL 720 x 576', category: 'animation', width: 720, height: 576, unit: 'px' },
];
/** Output resolutions in dots per inch; pixel formats keep their own size. */
export const PAGE_RESOLUTIONS = [72, 96, 150, 200, 300, 600];
export type PageOrientation = 'portrait' | 'landscape';
export interface PageSize { width: number; height: number }

/** Document pixels for a format: physical sizes are rendered at the chosen resolution. */
export function pageSize(format: PageFormat, resolution: number, orientation: PageOrientation): PageSize {
  const physical = format.unit !== 'px';
  const scale = physical ? resolution / 96 : 1;
  const width = Math.round(toPixels(format.width, format.unit) * scale);
  const height = Math.round(toPixels(format.height, format.unit) * scale);
  const portrait = width <= height;
  return orientation === 'portrait' === portrait ? { width, height } : { width: height, height: width };
}
export function pageSizeFits(size: PageSize): boolean {
  return [size.width, size.height].every(value => Number.isFinite(value) && value >= PAGE_MINIMUM && value <= PAGE_MAXIMUM);
}

export interface MarginGuides {
  top: number;
  right: number;
  bottom: number;
  left: number;
  edges: boolean;
  centerX: boolean;
  centerY: boolean;
}
export const defaultMarginGuides: MarginGuides = { top: 0, right: 0, bottom: 0, left: 0, edges: false, centerX: false, centerY: false };
export const MARGIN_GUIDE_PREFIX = 'Margin guide';
/** Positions of the margin guides of a page, in document pixels. */
export function marginGuidePositions(size: PageSize, margins: MarginGuides): { axis: 'vertical' | 'horizontal'; position: number; name: string }[] {
  const left = margins.left, right = size.width - margins.right, top = margins.top, bottom = size.height - margins.bottom;
  if (right <= left || bottom <= top) return [];
  const guides: { axis: 'vertical' | 'horizontal'; position: number; name: string }[] = [];
  if (margins.edges) guides.push(
    { axis: 'vertical', position: left, name: `${MARGIN_GUIDE_PREFIX} left` },
    { axis: 'vertical', position: right, name: `${MARGIN_GUIDE_PREFIX} right` },
    { axis: 'horizontal', position: top, name: `${MARGIN_GUIDE_PREFIX} top` },
    { axis: 'horizontal', position: bottom, name: `${MARGIN_GUIDE_PREFIX} bottom` },
  );
  if (margins.centerX) guides.push({ axis: 'vertical', position: (left + right) / 2, name: `${MARGIN_GUIDE_PREFIX} centre vertical` });
  if (margins.centerY) guides.push({ axis: 'horizontal', position: (top + bottom) / 2, name: `${MARGIN_GUIDE_PREFIX} centre horizontal` });
  return guides;
}
/** Guide distances shown beside the controls, in the unit the rulers use. */
export function marginDistances(size: PageSize, margins: MarginGuides, unit: Unit): Record<string, number> {
  return Object.fromEntries(marginGuidePositions(size, margins).map(guide => [guide.name, Number(fromPixels(guide.axis === 'vertical' ? guide.position : guide.position, unit).toFixed(3))]));
}

export type RegistrationMarks = 'none' | 'file2' | 'file4' | 'file6' | 'file8' | 'animation';
export const REGISTRATION_MARKS: RegistrationMarks[] = ['none', 'file2', 'file4', 'file6', 'file8', 'animation'];
export const REGISTRATION_LAYER_NAME = 'Registration marks';
const mm = (value: number) => toPixels(value, 'mm');
/** Filing holes sit along the left edge; the animation bar is an ACME peg strip centred on the top edge. */
export function registrationGeometry(kind: RegistrationMarks, size: PageSize): { holes: { center: Point; radius: number }[]; slots: { x: number; y: number; width: number; height: number }[] } {
  if (kind === 'none') return { holes: [], slots: [] };
  if (kind === 'animation') {
    const y = mm(10), slot = { width: mm(12.7), height: mm(6.35) }, offset = mm(101.6);
    return {
      holes: [{ center: { x: size.width / 2, y }, radius: mm(3.175) }],
      slots: [-1, 1].map(side => ({ x: size.width / 2 + side * offset - slot.width / 2, y: y - slot.height / 2, width: slot.width, height: slot.height })),
    };
  }
  const count = Number(kind.slice(4)), spacing = mm(80), radius = mm(3), x = mm(12);
  const centre = size.height / 2, first = centre - ((count - 1) * spacing) / 2;
  return { holes: Array.from({ length: count }, (_, index) => ({ center: { x, y: first + index * spacing }, radius })), slots: [] };
}
/** Whether every mark of a pattern fits inside the page. */
export function registrationFits(kind: RegistrationMarks, size: PageSize): boolean {
  const { holes, slots } = registrationGeometry(kind, size);
  return holes.every(hole => hole.center.x - hole.radius >= 0 && hole.center.y - hole.radius >= 0 && hole.center.x + hole.radius <= size.width && hole.center.y + hole.radius <= size.height)
    && slots.every(slot => slot.x >= 0 && slot.y >= 0 && slot.x + slot.width <= size.width && slot.y + slot.height <= size.height);
}
/** A locked layer holding the marks; it is regenerated whenever the page changes. */
export function registrationLayer(kind: RegistrationMarks, size: PageSize, id: string, stroke = '#1f2933'): Layer | null {
  const { holes, slots } = registrationGeometry(kind, size);
  if (!holes.length && !slots.length) return null;
  const curves = [
    ...holes.map(hole => ellipsePath(hole.center.x, hole.center.y, hole.radius, hole.radius)),
    ...slots.map(slot => polyline([
      { x: slot.x, y: slot.y }, { x: slot.x + slot.width, y: slot.y },
      { x: slot.x + slot.width, y: slot.y + slot.height }, { x: slot.x, y: slot.y + slot.height },
    ], true)),
  ];
  return {
    ...newLayer('path', id, { x: 0, y: 0 }, 'none', stroke, 1),
    name: REGISTRATION_LAYER_NAME,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
    locked: true,
    curves,
    points: [],
  };
}

export interface PageEdges { top: number; right: number; bottom: number; left: number }
/** Grows or shrinks the page on each edge and moves the artwork with it. */
export function resizePage(document: StudioDocument, edges: PageEdges): StudioDocument {
  const width = Math.round(document.width + edges.left + edges.right);
  const height = Math.round(document.height + edges.top + edges.bottom);
  if (!pageSizeFits({ width, height })) throw new Error('The page would fall outside the supported document size.');
  return {
    ...document,
    width,
    height,
    layers: document.layers.map(layer => ({ ...layer, x: layer.x + edges.left, y: layer.y + edges.top })),
  };
}
