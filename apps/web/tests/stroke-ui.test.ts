// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { newLayer, Layer } from '../../../packages/domain/src/document';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';

const rectangle = (id: string, x: number): Layer => ({ ...newLayer('rectangle', id, { x, y: 100 }, '#12345680', '#abcdef40', 6), width: 80, height: 80 });
describe('shared stroke appearance and scoped style tools', () => {
  let app: AppComponent, editor: EditorService;
  beforeEach(() => {
    localStorage.clear(); editor = new EditorService();
    editor.document.update(doc => ({ ...doc, layers: [rectangle('a', 100), rectangle('b', 300)] }));
    editor.selectLayer('a');
    app = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(app, { editor, paintTarget: signal('stroke') });
  });

  it('applies join, cap and alignment to multiple objects without changing either paint alpha', () => {
    editor.selectLayer('b', true);
    app.setStrokeOption('alignment', 'inside'); app.setStrokeOption('join', 'bevel'); app.setStrokeOption('cap', 'square');
    for (const layer of editor.document().layers) {
      expect(layer.strokeStyle).toEqual({ alignment: 'inside', join: 'bevel', cap: 'square' });
      expect(layer.fill).toBe('#12345680'); expect(layer.stroke).toBe('#abcdef40'); expect(layer.strokeWidth).toBe(6);
    }
    editor.undo(); expect(editor.document().layers.every(layer => layer.strokeStyle?.cap === 'round')).toBe(true);
    expect(app.paintStrokeStyle().join).toBe('bevel');
  });

  it('prevents misleading inner or outer alignment on open-only objects, retaining cap and join controls', () => {
    const line: Layer = { ...newLayer('path', 'line', { x: 10, y: 10 }), points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    editor.document.update(doc => ({ ...doc, layers: [line] })); editor.selectLayer('line');
    expect(app.strokeAlignmentAvailable()).toBe(false);
    const before = JSON.stringify(editor.document()); app.setStrokeOption('alignment', 'outside'); expect(JSON.stringify(editor.document())).toBe(before);
    app.setStrokeOption('cap', 'butt'); expect(editor.selected()!.strokeStyle?.cap).toBe('butt');
    app.setStrokeOption('join', 'invalid'); expect(editor.selected()!.strokeStyle?.join).toBe('round');
    editor.setTool('paintBucket'); expect(app.strokeAlignmentAvailable()).toBe(true);
    app.setStrokeOption('alignment', 'outside'); expect(editor.strokeStyle().alignment).toBe('outside');
  });

  it('shows sampled defaults when a locked selected layer cannot receive the eyedropper style', () => {
    editor.document.update(doc => ({ ...doc, layers: doc.layers.map(layer => layer.id === 'b' ? { ...layer, fill: '#ee220040', stroke: 'none', strokeWidth: 12, strokeStyle: { alignment: 'outside', join: 'miter', cap: 'butt' } } : layer) }));
    editor.toggle('a', 'locked'); editor.setTool('eyedropper');
    expect(editor.sampleStyle({ x: 320, y: 120 })).toBe(true);
    expect(editor.selected()!.fill).toBe('#12345680');
    expect(app.paintColor('fill')).toBe('#ee220040'); expect(app.paintColor('stroke')).toBe('none');
    expect(app.paintWidth()).toBe(12); expect(app.paintStrokeStyle()).toEqual({ alignment: 'outside', join: 'miter', cap: 'butt' });
    editor.setTool('select'); expect(app.paintColor('fill')).toBe('#12345680');
  });

  it('uses the same transfer scope for sampler and bucket, preserving the unselected paint channel', () => {
    editor.document.update(doc => ({ ...doc, layers: doc.layers.map(layer => layer.id === 'b' ? { ...layer, fill: '#dd1100', stroke: '#ffee00', strokeWidth: 9, strokeStyle: { alignment: 'inside', join: 'bevel', cap: 'square' } } : layer) }));
    app.setStyleScope('stroke'); editor.setTool('eyedropper'); editor.sampleStyle({ x: 320, y: 120 });
    expect(editor.selected()!.fill).toBe('#12345680'); expect(editor.selected()!.stroke).toBe('#ffee00');
    expect(app.paintStrokeStyle().cap).toBe('square');
    app.setStyleScope('fill'); editor.fill.set('none'); editor.setTool('paintBucket'); editor.applyStyleAt({ x: 320, y: 120 });
    expect(editor.selected()!.fill).toBe('none'); expect(editor.selected()!.stroke).toBe('#ffee00'); expect(editor.selected()!.strokeWidth).toBe(9);
  });
});
