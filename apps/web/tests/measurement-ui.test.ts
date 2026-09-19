// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';

const input = (value: number | string) => ({ target: { value: String(value) } }) as unknown as Event;
describe('paint and measurement UI interactions', () => {
  let component: AppComponent;
  let editor: EditorService;
  let preferences: PreferencesService;
  let capture: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    editor = new EditorService();
    preferences = new PreferencesService();
    component = Object.create(AppComponent.prototype) as AppComponent;
    capture = document.createElement('div');
    capture.setPointerCapture = vi.fn();
    capture.hasPointerCapture = vi.fn(() => true);
    capture.releasePointerCapture = vi.fn();
    Object.assign(component, { editor, preferences, paintTarget: signal('fill'), paintPicker: signal(null), draggingGuideId: signal(null), commitText: vi.fn(), canvas: { nativeElement: { getBoundingClientRect: () => ({ left: 100, top: 200, width: 640, height: 400 }) } } });
    editor.document.update(doc => ({ ...doc, width: 1280, height: 800 }));
  });
  const pointer = (x: number, y: number, element: HTMLElement, id = 1) => ({ button: 0, clientX: x, clientY: y, pointerId: id, currentTarget: element, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as PointerEvent;
  const rectangle = () => { editor.tool.set('rectangle'); editor.start({ x: 10, y: 20 }); editor.move({ x: 110, y: 120 }); editor.end(); return editor.selected()!.id; };

  it('keeps fill alpha independent from stroke and object opacity, preserving alpha on RGB changes', () => {
    rectangle();
    editor.setPaint('stroke', '#ff000040');
    component.setPaintOpacity(50);
    expect(editor.selected()!.fill.slice(-2)).toBe('80');
    expect(editor.selected()!.stroke).toBe('#ff000040');
    expect(editor.selected()!.opacity).toBe(1);
    component.setPaintBaseColor('#00ff00');
    expect(editor.selected()!.fill).toBe('#00ff0080');
    component.paintTarget.set('stroke');
    component.setPaintOpacity(0);
    expect(editor.selected()!.stroke).toBe('#ff000000');
    expect(editor.selected()!.fill).toBe('#00ff0080');
    editor.setPaint('stroke', 'none');
    expect(component.paintOpacity()).toBe(0);
    component.setPaintBaseColor('#ffffff');
    expect(editor.selected()!.stroke).toBe('#ffffff');
  });

  it('routes the same active paint changes to a multiple selection and previews the selected object', () => {
    const first = rectangle(); const second = rectangle();
    editor.selectLayer(first, true);
    component.setPaintBaseColor('#123456');
    expect(editor.document().layers.every(layer => layer.fill === '#123456')).toBe(true);
    component.paintTarget.set('stroke'); component.setPaintOpacity(25);
    expect(editor.document().layers.every(layer => layer.stroke.endsWith('40'))).toBe(true);
    expect(component.paintColor('fill')).toBe('#123456');
    expect(editor.selectedIds()).toContain(second);
  });

  it('dismisses the shared picker only outside it and keeps measurement controls independent', () => {
    component.paintPicker.set({ x: 20, y: 20 });
    const panel = document.createElement('section'); panel.className = 'paint-popover';
    const field = document.createElement('input'); panel.append(field);
    component.dismissPaint({ target: field } as unknown as PointerEvent); expect(component.paintPicker()).not.toBeNull();
    component.dismissPaint({ target: document.createElement('div') } as unknown as PointerEvent); expect(component.paintPicker()).toBeNull();
    component.toggleAid('rulers'); component.toggleSnap('grid'); component.setSnapRadius('guides', 12);
    expect(preferences.rulersVisible()).toBe(true); expect(preferences.guidesVisible()).toBe(true); expect(preferences.gridVisible()).toBe(false);
    expect(preferences.snapGrid()).toBe(true); expect(preferences.snapRulers()).toBe(false); expect(preferences.guideSnapRadius()).toBe(12);
  });

  it('converts all dimensional edits using the selected unit, leaving font units independent', () => {
    rectangle(); preferences.setMeasurement('distanceUnit', 'in'); preferences.setMeasurement('fontUnit', 'pt');
    component.patchNumber('width', input(2)); component.patchNumber('x', input(-.5)); component.patchNumber('fontSize', input(18)); component.setPaintWidth(input(.125));
    expect(editor.selected()!.width).toBe(192); expect(editor.selected()!.x).toBe(-48);
    expect(editor.selected()!.fontSize).toBe(24); expect(editor.selected()!.strokeWidth).toBe(12);
    expect(component.displayDistance(96)).toBe(1); expect(component.displayFontSize(24)).toBe(18);
    const before = JSON.stringify(editor.document()); component.setUnit('distanceUnit', input('mm')); expect(JSON.stringify(editor.document())).toBe(before);
    component.setUnit('fontUnit', input('invalid')); expect(preferences.fontUnit()).toBe('pt');
  });

  it('creates and moves guides in document coordinates after zoom/scroll, deleting only on outside release', () => {
    component.startGuide(pointer(200, 175, capture), 'vertical');
    component.moveGuide(pointer(250, 250, capture));
    expect(editor.document().layers[0].x).toBe(300);
    component.finishGuide(pointer(250, 250, capture));
    const id = editor.document().layers[0].id;
    component.startGuide(pointer(250, 250, capture), 'vertical', id);
    component.finishGuide(pointer(99, 250, capture));
    expect(editor.document().layers).toHaveLength(0);
    editor.undo(); expect(editor.document().layers[0].x).toBe(300);
    expect(capture.releasePointerCapture).toHaveBeenCalledTimes(2);
  });

  it('snaps guide drags to other guides while excluding itself and ignores unrelated pointers', () => {
    const first = editor.beginGuideDrag('vertical', 200)!; editor.endGuideDrag(true);
    const second = editor.beginGuideDrag('vertical', 300)!; editor.endGuideDrag(true);
    editor.snapConfig.set({ zoom: 1, rulers: { enabled: false, visible: false, step: 100, radius: 8 }, grid: { enabled: false, visible: false, step: 20, radius: 8 }, guides: { enabled: true, visible: true, radius: 8, items: [] } });
    component.startGuide(pointer(200, 250, capture), 'vertical', first);
    component.moveGuide(pointer(202, 250, capture, 2)); expect(editor.document().layers[0].x).toBe(200);
    component.moveGuide(pointer(203, 250, capture)); expect(editor.document().layers[0].x).toBe(206);
    component.finishGuide(pointer(248, 250, capture)); expect(editor.document().layers[0].x).toBe(300);
    expect(editor.document().layers[1].id).toBe(second);
  });

  it('protects hidden and locked guides and cancels unfinished horizontal guide creation', () => {
    const id = editor.beginGuideDrag('vertical', 200)!; editor.endGuideDrag(true);
    editor.toggle(id, 'locked'); component.startGuide(pointer(200, 250, capture), 'vertical', id); expect(capture.setPointerCapture).not.toHaveBeenCalled();
    editor.toggle(id, 'locked'); editor.toggle(id, 'visible'); component.startGuide(pointer(200, 250, capture), 'vertical', id); expect(capture.setPointerCapture).not.toHaveBeenCalled();
    expect(component.visibleGuides()).toHaveLength(0);
    component.startGuide(pointer(200, 250, capture), 'horizontal'); expect(editor.document().layers[1].y).toBe(100);
    component.cancelGuide(); expect(editor.document().layers).toHaveLength(1);
  });

  it('maps reversed layer list drop positions back to document z-order and permits undo', () => {
    const first = rectangle(), second = rectangle(), third = rectangle();
    const transfer = new DataTransfer(); transfer.setData('text/x-xds-layer', first);
    Object.assign(capture, { getBoundingClientRect: () => ({ top: 20, height: 40 }) });
    component.dropLayer({ preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: transfer, currentTarget: capture, clientY: 25 } as unknown as DragEvent, third);
    expect(editor.document().layers.map(layer => layer.id)).toEqual([second, third, first]);
    editor.undo(); expect(editor.document().layers.map(layer => layer.id)).toEqual([first, second, third]);
  });
});
