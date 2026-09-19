import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '../src/sample';
import { parseDocument, svgExport } from '../src/document';
import { flatten } from '../src/curves';

describe('editable branded sample document',()=>{
  it('round-trips native geometry within the artboard and preview limits',()=>{
    const document=createSampleDocument();
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
    expect(document.layers.length).toBeGreaterThan(30);
    expect(document.layers.length).toBeLessThanOrEqual(150);
    expect(new Set(document.layers.map(layer=>layer.id)).size).toBe(document.layers.length);
    for(const layer of document.layers){
      expect(layer.x).toBeGreaterThanOrEqual(0);
      expect(layer.y).toBeGreaterThanOrEqual(0);
      expect(layer.x+layer.width).toBeLessThanOrEqual(document.width);
      expect(layer.y+layer.height).toBeLessThanOrEqual(document.height);
      expect(layer.kind).not.toBe('image');
      expect(layer.source).toBe('');
      expect(layer.groupPath?.length).toBe(1);
      for(const path of layer.curves??[])for(const point of flatten(path)){
        expect(point.x+layer.x).toBeGreaterThanOrEqual(0);
        expect(point.y+layer.y).toBeGreaterThanOrEqual(0);
        expect(point.x+layer.x).toBeLessThanOrEqual(document.width);
        expect(point.y+layer.y).toBeLessThanOrEqual(document.height);
      }
    }
  });

  it('preserves the brand mark as distinct editable cubic paths in native and SVG output',()=>{
    const document=createSampleDocument();
    const upper=document.layers.find(layer=>layer.id==='Brand-X-upper')!;
    const lower=document.layers.find(layer=>layer.id==='Brand-X-lower')!;
    expect(upper.kind).toBe('path');
    expect(lower.kind).toBe('path');
    expect(upper.curves?.[0].closed).toBe(true);
    // Independent coordinates from the checked-in brand mark at a scale of three.
    expect(upper.curves?.[0].nodes[0].point.x).toBeCloseTo(149.0205,4);
    expect(upper.curves?.[0].nodes[0].outgoing.y).toBeCloseTo(158.9694,4);
    expect(lower.curves?.[0].nodes[0].point.y).toBeCloseTo(143.3571,4);
    expect(upper.curves?.[0].nodes.length).toBeGreaterThan(20);
    const svg=svgExport(document);
    expect(svg).toContain(' C ');
    expect(svg).toContain('Design Studio');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('data:');
  });

  it('creates deterministic independent documents without shared editable state',()=>{
    const first=createSampleDocument(),second=createSampleDocument();
    expect(first).toEqual(second);
    first.layers.find(layer=>layer.id==='Brand-X-upper')!.curves![0].nodes[0].point.x=0;
    expect(second.layers.find(layer=>layer.id==='Brand-X-upper')!.curves![0].nodes[0].point.x).toBeCloseTo(149.0205,4);
    expect(createSampleDocument()).toEqual(second);
  });
});
