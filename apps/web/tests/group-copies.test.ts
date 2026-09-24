// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorService } from '../src/app/editor.service';
import { newLayer, type Layer } from '../../../packages/domain/src/document';

// Copies and their groups, after Illustrator (owner request of 2026-09-24, SC-0149).
const square = (id: string, x: number, groupPath?: string[]): Layer =>
  ({ ...newLayer('rectangle', id, { x, y: 50 }), width: 30, height: 30, ...(groupPath ? { groupPath } : {}) });
function editor() {
  localStorage.clear();
  const e = new EditorService();
  e.document.update((d) => ({ ...d, layers: [square('back', 0), square('a', 50, ['G']), square('b', 100, ['G']), square('front', 150)] }));
  return e;
}
const select = (e: EditorService, ...ids: string[]) => { e.selectedIds.set(ids); e.selectedId.set(ids[0]); };
const order = (e: EditorService) => e.document().layers.map((layer) => layer.id);
const byId = (e: EditorService, id: string) => e.document().layers.find((layer) => layer.id === id)!;

beforeEach(() => localStorage.clear());

describe('copies leave the groups their originals were members of', () => {
  it('pastes a member copied alone outside its group, at the front', () => {
    const e = editor();
    select(e, 'a'); e.copySelection();
    select(e, 'a'); e.paste();
    const copy = e.selectedLayers()[0];
    expect(copy.groupPath).toBeUndefined();
    expect(order(e).at(-1)).toBe(copy.id);
  });

  it('pastes in front of or behind a member of a group inside that group', () => {
    const e = editor();
    select(e, 'front'); e.copySelection();
    select(e, 'a'); e.paste('front');
    const front = e.selectedLayers()[0];
    expect(front.groupPath).toEqual(['G']);
    expect(order(e).indexOf(front.id)).toBe(order(e).indexOf('a') + 1);
    select(e, 'b'); e.paste('back');
    const behind = e.selectedLayers()[0];
    expect(behind.groupPath).toEqual(['G']);
    expect(order(e).indexOf(behind.id)).toBe(order(e).indexOf('b') - 1);
  });

  it('pastes beside a whole group, not into it', () => {
    const e = editor();
    select(e, 'front'); e.copySelection();
    select(e, 'a', 'b'); e.paste('front');
    expect(e.selectedLayers()[0].groupPath).toBeUndefined();
  });

  it('keeps a copied group as a group of its own, new on every paste', () => {
    const e = editor();
    select(e, 'a', 'b'); e.copySelection();
    e.paste();
    const first = e.selectedLayers().map((layer) => layer.groupPath);
    e.paste();
    const second = e.selectedLayers().map((layer) => layer.groupPath);
    expect(first[0]).toHaveLength(1);
    expect(first[0]).toEqual(first[1]);
    expect(first[0]).not.toEqual(['G']);
    expect(second[0]).not.toEqual(first[0]);
    expect(byId(e, 'a').groupPath).toEqual(['G']);
  });

  it('duplicates a member alone without its group, and a whole group as a new group', () => {
    const e = editor();
    select(e, 'a'); e.duplicate();
    expect(e.selectedLayers()[0].groupPath).toBeUndefined();
    select(e, 'a', 'b'); e.duplicate();
    const copies = e.selectedLayers();
    expect(copies[0].groupPath).toEqual(copies[1].groupPath);
    expect(copies[0].groupPath).not.toEqual(['G']);
  });

  it('leaves the group when a transformation leaves a copy, as a drag with Alt does', () => {
    const e = editor();
    select(e, 'b');
    expect(e.affineSelection([1, 0, 0, 1], { copy: true, center: { x: 0, y: 0 } })).toBe(true);
    const copy = e.selectedLayers()[0];
    expect(copy.id).not.toBe('b');
    expect(copy.groupPath).toBeUndefined();
    expect(byId(e, 'b').groupPath).toEqual(['G']);
  });
});
