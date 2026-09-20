// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { AppComponent } from '../src/app/app.component';
import { snapDimensionPoint, snapDimensionOffset } from '../src/app/dimension-snapping';
import { dimensionGeometry } from '../../../packages/domain/src/dimensions';
import { fromPixels, measurementUnits } from '../../../packages/domain/src/measurements';
import { parseDocument, blankDocument, Layer } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());
const a = { x: 100, y: 100 }, b = { x: 300, y: 100 }, place = { x: 200, y: 60 };
const withDimension = () => { const e = new EditorService(); e.createDimension('linear', [a, b], place); return e; };

describe('metre unit', () => {
  it('offers metres and converts them from pixels at 96 per inch', () => {
    expect([...measurementUnits]).toEqual(['px', 'pt', 'mm', 'cm', 'm', 'in', 'ft']);
    expect(fromPixels(96 / 0.0254, 'm')).toBeCloseTo(1);
    expect(fromPixels(96, 'in')).toBeCloseTo(1);
  });

  it('formats a measured span in metres', () => {
    const e = withDimension();
    e.updateDimension({ format: { scale: 1, unit: 'm', decimals: 3, separator: '.' } });
    expect(dimensionGeometry(e.selected()!).text).toBe('0.053 m');
  });
});

describe('label placement', () => {
  it('moves the label to the start or the end of the dimension line', () => {
    const e = withDimension();
    const centred = dimensionGeometry(e.selected()!).labelPosition.x;
    e.updateDimension({ labelPlacement: 'start' });
    const start = dimensionGeometry(e.selected()!);
    expect(start.placement).toBe('outside');
    expect(start.labelPosition.x).toBeLessThan(a.x);
    e.updateDimension({ labelPlacement: 'end' });
    expect(dimensionGeometry(e.selected()!).labelPosition.x).toBeGreaterThan(b.x);
    e.updateDimension({ labelPlacement: 'center' });
    expect(dimensionGeometry(e.selected()!).labelPosition.x).toBeCloseTo(centred);
  });

  it('round trips the placement and rejects an unknown one', () => {
    const e = withDimension();
    e.updateDimension({ labelPlacement: 'end' });
    const doc = e.document();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    const broken = { ...blankDocument(), layers: doc.layers.map((l: Layer) => ({ ...l, dimension: { ...l.dimension!, labelPlacement: 'middle' } })) };
    expect(() => parseDocument(JSON.stringify(broken))).toThrow();
  });
});

describe('unified measurement format', () => {
  it('applies one scale and label format to every dimension as a single step', () => {
    const e = withDimension();
    e.createDimension('linear', [{ x: 100, y: 400 }, { x: 500, y: 400 }], { x: 300, y: 360 });
    e.selectLayer(e.document().layers[0].id);
    e.updateDimension({ format: { scale: 2, unit: 'cm', decimals: 1, separator: ',' } });
    const formats = () => e.document().layers.filter((l) => l.dimension).map((l) => l.dimension!.format);
    expect(formats()[1].scale).toBe(1);
    e.setUnifyDimensionFormat(true);
    expect(formats().every((format) => format.scale === 2 && format.unit === 'cm' && format.decimals === 1 && format.separator === ',')).toBe(true);
    e.undo();
    expect(formats()[1].scale).toBe(1);
  });

  it('keeps later format edits in step while the toggle is on', () => {
    const e = withDimension();
    e.createDimension('linear', [{ x: 100, y: 400 }, { x: 500, y: 400 }], { x: 300, y: 360 });
    e.setUnifyDimensionFormat(true);
    e.selectLayer(e.document().layers[0].id);
    e.updateDimension({ format: { scale: 5, unit: 'mm', decimals: 0, separator: '.' } });
    expect(e.document().layers.filter((l) => l.dimension).every((l) => l.dimension!.format.scale === 5)).toBe(true);
    e.setUnifyDimensionFormat(false);
    e.updateDimension({ format: { scale: 9, unit: 'mm', decimals: 0, separator: '.' } });
    const scales = e.document().layers.filter((l) => l.dimension).map((l) => l.dimension!.format.scale);
    expect(new Set(scales).size).toBe(2);
  });
});

describe('magnetism between dimensions', () => {
  it('snaps new anchors to the anchors and extension ends of existing dimensions', () => {
    const e = withDimension();
    const target = snapDimensionPoint(e.document().layers, { x: 103, y: 103 }, 10, true);
    expect(target?.kind).toBe('dimension');
    expect(target?.point).toEqual(a);
    expect(snapDimensionPoint(e.document().layers, { x: 160, y: 300 }, 10, true)).toBeNull();
  });

  it('aligns a parallel dimension with the offset line of an existing one', () => {
    const e = withDimension();
    const line = dimensionGeometry(e.selected()!).lines.find((l) => !l.extension)!;
    const aligned = snapDimensionOffset(e.document().layers, [{ x: 400, y: 100 }, { x: 600, y: 100 }], { x: 500, y: line.a.y + 5 }, 10);
    expect(aligned?.y).toBeCloseTo(line.a.y);
    expect(snapDimensionOffset(e.document().layers, [{ x: 400, y: 100 }, { x: 600, y: 100 }], { x: 500, y: line.a.y + 40 }, 10)).toBeNull();
    // A dimension at another angle never shares the offset line.
    expect(snapDimensionOffset(e.document().layers, [{ x: 400, y: 100 }, { x: 400, y: 300 }], { x: 420, y: line.a.y }, 10)).toBeNull();
  });

  it('respects the magnetism switch when placing the offset', () => {
    const e = withDimension();
    const line = dimensionGeometry(e.selected()!).lines.find((l) => !l.extension)!;
    const anchors = [{ x: 400, y: 100 }, { x: 600, y: 100 }];
    expect(e.dimensionOffsetPoint(anchors, { x: 500, y: line.a.y + 5 }).y).toBeCloseTo(line.a.y);
    e.dimensionsSnap.set(false);
    expect(e.dimensionOffsetPoint(anchors, { x: 500, y: line.a.y + 5 }).y).toBe(line.a.y + 5);
  });
});

describe('extension colour control', () => {
  it('shows a usable hexadecimal for the swatch and keeps alpha when picking', () => {
    const e = withDimension();
    const app = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(app, { editor: e });
    expect(app.colorValue('#112233')).toBe('#112233');
    expect(app.colorValue('#11223344')).toBe('#112233');
    expect(app.colorValue('none')).toBe('#000000');
    e.updateDimension({ extension: { ...e.selected()!.dimension!.extension, stroke: '#11223344' } });
    app.setDimensionExtensionColor({ target: { value: '#aabbcc' } } as unknown as Event);
    expect(e.selected()!.dimension!.extension.stroke).toBe('#aabbcc44');
    e.updateDimension({ extension: { ...e.selected()!.dimension!.extension, stroke: 'none' } });
    app.setDimensionExtensionColor({ target: { value: '#445566' } } as unknown as Event);
    expect(e.selected()!.dimension!.extension.stroke).toBe('#445566');
  });
});
