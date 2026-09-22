// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer } from '../../../packages/domain/src/document';
import { defaultShortcuts, matchShortcut } from '../../../packages/domain/src/shortcuts';

beforeEach(() => localStorage.clear());
const box = (id: string, x: number, groupPath?: string[]) => ({ ...newLayer('rectangle', id, { x, y: 100 }), width: 100, height: 100, fill: '#000000', groupPath });
function editor(...layers: ReturnType<typeof box>[]) {
  const e = new EditorService();
  e.document.update((d) => ({ ...d, layers }));
  return e;
}
const select = (e: EditorService, ...ids: string[]) => { e.selectedIds.set(ids); e.selectedId.set(ids.at(-1)!); };
const state = (e: EditorService) => e.document().layers.map((l) => [l.id, l.locked, l.visible]);

describe('Object > Lock and Object > Hide', () => {
  it('use the keys Illustrator gives them, on any keyboard layout', () => {
    const map = defaultShortcuts();
    expect(map['lockSelection']).toEqual(['Mod+2']);
    expect(map['unlockAll']).toEqual(['Mod+Alt+2']);
    expect(map['hideSelection']).toEqual(['Mod+3']);
    expect(map['showAll']).toEqual(['Mod+Alt+3']);
    expect(map['lockOthers']).toEqual(['Mod+Alt+Shift+2']);
    expect(map['hideOthers']).toEqual(['Mod+Alt+Shift+3']);
    // Ctrl+Alt+3 types a character of its own on some layouts; the key is read by its place.
    const altGr = { key: '#', code: 'Digit3', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, getModifierState: (k: string) => k === 'AltGraph' };
    expect(matchShortcut(map, altGr)).toBe('showAll');
    const shifted = { key: '"', code: 'Digit2', ctrlKey: true, metaKey: false, altKey: true, shiftKey: true };
    expect(matchShortcut(map, shifted)).toBe('lockOthers');
  });

  it('lock the selection and take it out of the selection', () => {
    const e = editor(box('a', 0), box('b', 300));
    select(e, 'a');
    expect(e.lockOrHide('locked', 'selection')).toBe(1);
    expect(state(e)).toEqual([['a', true, true], ['b', false, true]]);
    expect(e.selectedIds()).toEqual([]);
  });

  it('unlock everything and select what was unlocked', () => {
    const e = editor(box('a', 0), box('b', 300), box('c', 600));
    select(e, 'a', 'b');
    e.lockOrHide('locked', 'selection');
    expect(e.unlockOrShowAll('locked')).toBe(2);
    expect(e.selectedIds()).toEqual(['a', 'b']);
    expect(e.document().layers.every((l) => !l.locked)).toBe(true);
  });

  it('hide the selection, and show everything again selected', () => {
    const e = editor(box('a', 0), box('b', 300));
    select(e, 'b');
    e.lockOrHide('hidden', 'selection');
    expect(state(e)).toEqual([['a', false, true], ['b', false, false]]);
    expect(e.unlockOrShowAll('hidden')).toBe(1);
    expect(e.selectedIds()).toEqual(['b']);
  });

  it('reach only the artwork above the selection that overlaps it', () => {
    const e = editor(box('below', 50), box('chosen', 0), box('over', 50), box('apart', 900));
    select(e, 'chosen');
    expect(e.lockOrHide('hidden', 'above')).toBe(1);
    expect(state(e).filter(([, , visible]) => !visible).map(([id]) => id)).toEqual(['over']);
  });

  it('reach everything outside the top-level groups of the selection as Other Layers', () => {
    const e = editor(box('a', 0, ['g']), box('b', 200, ['g']), box('c', 400), box('d', 600, ['h']));
    select(e, 'a');
    expect(e.lockOrHide('locked', 'others')).toBe(2);
    expect(state(e).filter(([, locked]) => locked).map(([id]) => id)).toEqual(['c', 'd']);
  });

  it('is one step that undo takes back', () => {
    const e = editor(box('a', 0));
    select(e, 'a');
    e.lockOrHide('hidden', 'selection');
    e.undo();
    expect(e.document().layers[0].visible).toBe(true);
  });
});
