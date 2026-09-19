// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { newLayer } from '../../../packages/domain/src/document';
import { TOOLS, TOOL_FAMILIES } from '../src/app/tools';
let app: AppComponent, editor: EditorService;
beforeEach(() => {
 localStorage.clear(); editor = new EditorService();
 editor.document.update(doc => ({ ...doc, layers: [{ ...newLayer('rectangle','a',{x:100,y:100}),width:50,height:20 }] })); editor.selectLayer('a');
 app = Object.create(AppComponent.prototype) as AppComponent;
 Object.assign(app, { editor, preferences:new PreferencesService(), transformDialog:signal(null), flyout:signal(null), textEditing:signal(null), textDraft:signal('') });
});
it('converts numeric displacement from the selected display unit and applies one undoable edit', () => {
 app.preferences.setMeasurement('distanceUnit','in'); app.openTransformDialog('displacement'); app.transformX=1;app.transformY=-0.5;app.applyNumericTransform();
 expect(editor.selected()!.x).toBe(196);expect(editor.selected()!.y).toBe(52);expect(app.transformDialog()).toBeNull(); editor.undo(); expect(editor.selected()!.x).toBe(100);
});
it('keeps invalid transforms open and preserves document and history', () => {
 app.openTransformDialog('rotation');const before=JSON.stringify(editor.document());app.numericAngle=NaN;app.applyNumericTransform();
 expect(JSON.stringify(editor.document())).toBe(before);expect(app.transformDialog()).toBe('rotation');expect(editor.status()).toContain('cannot be applied');
});
it('isolates modal Escape from editor actions and exposes smart dimension as default subtool', () => {
 app.openTransformDialog('displacement'); app.key(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));expect(app.transformDialog()).toBeNull();
 const family=TOOL_FAMILIES.find(f=>f.id==='dimensions')!;expect(family.tools).toEqual(['dimensionSmart','dimensionLinear','dimensionAngular']);expect(TOOLS.filter(t=>family.tools.includes(t.id))).toHaveLength(3);
});
it('persists independent dimension visibility, locks, magnetism and radius', () => {
 app.preferences.setMeasurement('dimensionsVisible',false);app.preferences.setMeasurement('dimensionsLocked',true);app.preferences.setMeasurement('dimensionsSnap',false);app.preferences.setMeasurement('dimensionSnapRadius',16);app.preferences.toggleLayoutBlock('dimensions');
 const restored=new PreferencesService();expect(restored.dimensionsVisible()).toBe(false);expect(restored.dimensionsLocked()).toBe(true);expect(restored.dimensionsSnap()).toBe(false);expect(restored.dimensionSnapRadius()).toBe(16);expect(restored.layoutBlocks().dimensions).toBe(false);
});
