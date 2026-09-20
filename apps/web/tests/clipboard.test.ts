// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';
import { defaultShortcuts } from '../../../packages/domain/src/shortcuts';

const square = (id: string, x: number) => ({ ...newLayer('rectangle', id, { x, y: 50 }), width: 40, height: 40 });
function withThree() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((document) => ({ ...document, layers: [square('back', 0), square('middle', 100), square('front', 200)] }));
  return e;
}
const ids = (e: EditorService) => e.document().layers.map((layer) => layer.id);

beforeEach(() => localStorage.clear());
describe('clipboard', () => {
  it('pastes in front of and behind the selection at the same coordinates', () => {
    const e = withThree();
    e.selectLayer('back');
    expect(e.copySelection()).toBe(true);
    e.selectLayer('middle');
    expect(e.paste('front')).toBe(true);
    // The copy keeps the coordinates of the original and sits right above the selected object.
    const pasted = e.selectedLayers()[0];
    expect([pasted.x, pasted.y]).toEqual([0, 50]);
    expect(ids(e)).toEqual(['back', 'middle', pasted.id, 'front']);
    e.selectLayer('middle');
    expect(e.paste('back')).toBe(true);
    expect(ids(e)[1]).toBe(e.selectedLayers()[0].id);
    expect(e.selectedLayers()[0].x).toBe(0);
  });

  it('offsets a plain paste and leaves the original where it was', () => {
    const e = withThree();
    e.selectLayer('front');
    e.copySelection();
    e.paste();
    const pasted = e.selectedLayers()[0];
    expect([pasted.x, pasted.y]).toEqual([220, 70]);
    expect(ids(e).at(-1)).toBe(pasted.id);
    expect(e.document().layers.find((layer) => layer.id === 'front')!.x).toBe(200);
  });

  it('cuts to the clipboard and restores everything with one undo', () => {
    const e = withThree();
    e.selectLayer('middle');
    expect(e.cutSelection()).toBe(true);
    expect(ids(e)).toEqual(['back', 'front']);
    expect(e.canPaste()).toBe(true);
    e.paste('front');
    expect(e.document().layers).toHaveLength(3);
    e.undo();
    expect(ids(e)).toEqual(['back', 'front']);
    e.undo();
    expect(ids(e)).toEqual(['back', 'middle', 'front']);
  });

  it('does nothing without a copy or a selection', () => {
    const e = withThree();
    expect(e.canPaste()).toBe(false);
    expect(e.paste('front')).toBe(false);
    expect(e.copySelection()).toBe(false);
    expect(e.cutSelection()).toBe(false);
    expect(ids(e)).toEqual(['back', 'middle', 'front']);
  });
});

describe('bounding box', () => {
  it('is shown by default and toggles on demand', () => {
    const e = withThree();
    expect(e.boundingBoxVisible()).toBe(true);
    e.toggleBoundingBox();
    expect(e.boundingBoxVisible()).toBe(false);
    expect(e.status()).toContain('hidden');
    e.toggleBoundingBox();
    expect(e.boundingBoxVisible()).toBe(true);
  });
});

describe('editing shortcuts', () => {
  it('binds the clipboard, duplication and the bounding box to their keys', () => {
    const shortcuts = defaultShortcuts();
    expect(shortcuts['copy']).toEqual(['Mod+C']);
    expect(shortcuts['cut']).toEqual(['Mod+X']);
    expect(shortcuts['paste']).toEqual(['Mod+V']);
    expect(shortcuts['pasteInFront']).toEqual(['Mod+F']);
    expect(shortcuts['pasteInBack']).toEqual(['Mod+B']);
    expect(shortcuts['duplicate']).toEqual(['Mod+D']);
    expect(shortcuts['toggleBoundingBox']).toEqual(['Mod+Shift+B']);
  });

  it('offers every one of them on the selected objects in the context menu', () => {
    const e = withThree();
    e.selectLayer('middle');
    e.copySelection();
    const target = e.contextForLayer('middle')!;
    const entries = e.contextActions(target).filter((entry) => entry.enabled).map((entry) => entry.id);
    for (const action of ['copy', 'cut', 'paste', 'pasteInFront', 'pasteInBack', 'duplicate', 'toggleBoundingBox']) {
      expect(entries).toContain(action);
    }
    expect(e.runContextAction(target, 'pasteInFront')).toBe(true);
    expect(e.document().layers).toHaveLength(4);
    expect(e.runContextAction(e.contextForLayer('middle')!, 'toggleBoundingBox')).toBe(true);
    expect(e.boundingBoxVisible()).toBe(false);
  });
});
