// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { Layer, newLayer } from '../../../packages/domain/src/document';
import { BlendEasing } from '../../../packages/domain/src/object-blend';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';

const rectangle = (id: string, x: number, groupPath?: string[]): Layer => ({ ...newLayer('rectangle', id, { x, y: 100 }), width: 40, height: 40, ...(groupPath ? { groupPath } : {}) });
const input = (value: string | number) => ({ target: { value: String(value) } }) as unknown as Event;
describe('editable object blend UI routing', () => {
  let app: AppComponent, editor: EditorService;
  beforeEach(() => {
    localStorage.clear(); editor = new EditorService();
    editor.document.update(doc => ({ ...doc, layers: [rectangle('back', 100), rectangle('front', 400)] }));
    editor.selectLayer('front'); editor.selectLayer('back', true);
    app = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(app, { editor, preferences: new PreferencesService(), flyout: signal(null), blendSteps: signal(5), blendEasing: signal<BlendEasing>('linear'), blendEasings: [{ id: 'linear' }, { id: 'ease-in' }, { id: 'ease-out' }, { id: 'ease-in-out' }] });
  });

  it('creates a blend from stacking order, updates linked settings, and exposes the actual active values', () => {
    app.preferences.setMeasurement('distanceUnit', 'in'); app.preferences.setMeasurement('fontUnit', 'pt');
    app.setBlendSteps(input(1)); expect(app.commandEnabled('makeBlend')).toBe(true);
    app.runCommand('makeBlend');
    const blend = editor.selectedBlend()!;
    expect(blend.backIds).toEqual(['back']); expect(blend.frontIds).toEqual(['front']);
    expect(app.blendStepCount()).toBe(1); expect(app.commandEnabled('makeBlend')).toBe(false);
    expect(editor.document().layers.find(layer => layer.id === blend.stepIds[0][0])!.x).toBe(250);
    app.setBlendEasing(input('ease-in'));
    expect(app.currentBlendEasing()).toBe('ease-in');
    expect(editor.document().layers.find(layer => layer.id === blend.stepIds[0][0])!.x).toBe(175);
    const before = JSON.stringify(editor.document()); app.setBlendEasing(input('invalid')); app.setBlendSteps(input(NaN));
    expect(JSON.stringify(editor.document())).toBe(before);
  });

  it('limits grouped intermediate steps using remaining layer capacity, excluding endpoint objects', () => {
    const endpoints = [rectangle('back-a', 10, ['back-group']), rectangle('back-b', 50, ['back-group']), rectangle('front-a', 200, ['front-group']), rectangle('front-b', 240, ['front-group'])];
    const others = Array.from({ length: 144 }, (_, index) => rectangle('other-' + index, 800));
    editor.document.update(doc => ({ ...doc, layers: [...endpoints, ...others] }));
    editor.selectLayer('back-a'); editor.selectLayer('front-a', true);
    expect(app.blendStepLimit()).toBe(1); expect(app.blendStepCount()).toBe(1);
    app.setBlendSteps(input(100)); app.runCommand('makeBlend');
    expect(editor.document().layers).toHaveLength(150); expect(editor.selectedBlend()!.stepIds).toHaveLength(1);
    expect(editor.selectedBlend()!.stepIds[0]).toHaveLength(2); expect(app.blendStepLimit()).toBe(1);
  });

  it('lets endpoint edits regenerate live steps and expands before individual intermediate editing', () => {
    app.setBlendSteps(input(1)); app.runCommand('makeBlend');
    const id = editor.selectedBlend()!.stepIds[0][0];
    expect(app.isGeneratedBlendLayer(id)).toBe(true);
    editor.selectBlendEndpoint('back'); expect(editor.selectedIds()).toEqual(['back']);
    editor.updateLayer({ x: 120 }); expect(editor.document().layers.find(layer => layer.id === id)!.x).toBe(260);
    expect(app.commandEnabled('expandBlend')).toBe(true); app.runCommand('expandBlend');
    expect(app.isGeneratedBlendLayer(id)).toBe(false); expect(editor.document().layers).toHaveLength(3);
    editor.selectLayerExact(id); editor.updateLayer({ x: 333 });
    expect(editor.document().layers.find(layer => layer.id === id)!.x).toBe(333);
  });

  it('releases only intermediates, preserving endpoint geometry and making the operation undoable', () => {
    app.runCommand('makeBlend'); expect(editor.document().layers).toHaveLength(7);
    app.runCommand('releaseBlend'); expect(editor.document().layers.map(layer => layer.id)).toEqual(['back', 'front']);
    expect(editor.document().layers.map(layer => layer.x)).toEqual([100, 400]);
    expect(app.commandEnabled('releaseBlend')).toBe(false);
    editor.undo(); expect(editor.document().layers).toHaveLength(7); expect(editor.document().blends).toHaveLength(1);
  });

  it('disables incompatible selections and locked blend edits without changing document or defaults', () => {
    editor.selectLayerExact('back'); expect(app.commandEnabled('makeBlend')).toBe(false);
    app.runCommand('makeBlend'); expect(editor.document().blends).toBeUndefined();
    editor.selectLayerExact('front', true); app.runCommand('makeBlend');
    editor.toggle('back', 'locked'); expect(app.blendIsLocked()).toBe(true);
    const before = JSON.stringify(editor.document());
    app.setBlendSteps(input(2)); app.setBlendEasing(input('ease-out')); app.runCommand('expandBlend'); app.runCommand('releaseBlend');
    expect(JSON.stringify(editor.document())).toBe(before); expect(app.blendSteps()).toBe(5);
    expect(app.commandEnabled('expandBlend')).toBe(false);
  });
});
