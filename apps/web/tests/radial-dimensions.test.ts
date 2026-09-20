// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { dimensionGeometry, DIAMETER_SYMBOL, RADIUS_SYMBOL } from '../../../packages/domain/src/dimensions';
import { parseDocument, blankDocument, Layer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const centre = { x: 300, y: 300 }, edge = { x: 400, y: 300 }, place = { x: 360, y: 300 };
function radial(kind: 'radius' | 'diameter', patch: Record<string, unknown> = {}) {
  localStorage.clear();
  const e = new EditorService();
  e.createDimension(kind, [centre, edge], place);
  if (Object.keys(patch).length) e.updateDimension(patch);
  return e;
}
const lines = (layer: Layer) => dimensionGeometry(layer).lines.filter((line) => !line.extension);

describe('radius and diameter dimensions', () => {
  it('measures the radius from the centre to the arc with one arrow and an R prefix', () => {
    const e = radial('radius', { format: { scale: 1, unit: 'px', decimals: 0, separator: '.' } });
    const geometry = dimensionGeometry(e.selected()!);
    expect(geometry.value).toBe(100);
    expect(geometry.text.startsWith(RADIUS_SYMBOL)).toBe(true);
    expect(geometry.ends).toHaveLength(1);
    expect(geometry.ends[0].point).toEqual(edge);
    expect(geometry.ends[0].direction.x).toBeCloseTo(1);
  });

  it('measures the diameter through the centre with two opposed arrows and its symbol', () => {
    const e = radial('diameter', { format: { scale: 1, unit: 'px', decimals: 0, separator: '.' } });
    const geometry = dimensionGeometry(e.selected()!);
    expect(geometry.value).toBe(200);
    expect(geometry.text.startsWith(DIAMETER_SYMBOL)).toBe(true);
    expect(geometry.ends.map((end) => end.point)).toEqual([{ x: 200, y: 300 }, { x: 400, y: 300 }]);
    expect(geometry.ends.map((end) => Math.round(end.direction.x))).toEqual([-1, 1]);
  });

  it('breaks the line around the label when it fits and moves it outside when it does not', () => {
    const wide = radial('diameter', { format: { scale: 1, unit: 'px', decimals: 0, separator: '.' } });
    expect(dimensionGeometry(wide.selected()!).placement).toBe('inside');
    expect(lines(wide.selected()!)).toHaveLength(2);
    const tight = new EditorService();
    tight.createDimension('radius', [centre, { x: 315, y: 300 }], { x: 310, y: 300 });
    const geometry = dimensionGeometry(tight.selected()!);
    expect(geometry.placement).toBe('outside');
    expect(geometry.labelPosition.x).toBeGreaterThan(315);
  });

  it('draws a centre mark only when it is switched on', () => {
    const plain = radial('radius');
    expect(dimensionGeometry(plain.selected()!).lines.filter((line) => line.extension)).toHaveLength(0);
    const marked = radial('radius', { centerMark: true });
    const marks = dimensionGeometry(marked.selected()!).lines.filter((line) => line.extension);
    expect(marks).toHaveLength(2);
    expect(marks[0].a.y).toBeCloseTo(centre.y);
    expect(marks[1].a.x).toBeCloseTo(centre.x);
  });

  it('places two anchors and the label with three clicks', () => {
    const e = new EditorService();
    e.setTool('dimensionDiameter');
    for (const point of [centre, edge, place]) { e.start(point); e.end(); }
    expect(e.selected()?.dimension?.kind).toBe('diameter');
    expect(e.selected()?.dimension?.anchors).toHaveLength(2);
    expect(e.dimensionDraft()).toBeNull();
  });

  it('round trips the new kinds and rejects wrong anchor counts', () => {
    const e = radial('radius', { centerMark: true });
    const document = e.document();
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
    const broken = { ...blankDocument(), layers: document.layers.map((layer) => ({ ...layer, dimension: { ...layer.dimension!, anchors: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] } })) };
    expect(() => parseDocument(JSON.stringify(broken))).toThrow();
  });
});
