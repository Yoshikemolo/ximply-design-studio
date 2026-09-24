import { describe, expect, it } from 'vitest';
import { aboveOutermostGroup, clipboardLayers, contextPath, detachedCopies, ownedPath } from '../src/group-copy';
import { newLayer, type Layer } from '../src/document';

const layer = (id: string, groupPath?: string[]): Layer => ({ ...newLayer('rectangle', id, { x: 0, y: 0 }), ...(groupPath ? { groupPath } : {}) });
// outside, then group O holding a, and group I (inside O) holding b and c, then d on its own.
const all = [layer('outside'), layer('a', ['O']), layer('b', ['O', 'I']), layer('c', ['O', 'I']), layer('d')];
const ids = (...names: string[]) => new Set(names);
let counter = 0;
const makeId = () => `new-${++counter}`;

describe('groups a copy keeps (Illustrator behaviour, owner request of 2026-09-24)', () => {
  it('keeps no group for a member selected alone, and names its groups as the context', () => {
    expect(ownedPath(all, ids('b'), all[2])).toEqual([]);
    expect(contextPath(all, ids('b'), all[2])).toEqual(['O', 'I']);
  });

  it('keeps an inner group selected whole, inside the outer group that holds it', () => {
    expect(ownedPath(all, ids('b', 'c'), all[2])).toEqual(['I']);
    expect(contextPath(all, ids('b', 'c'), all[2])).toEqual(['O']);
  });

  it('keeps the whole nesting when the outer group is selected whole', () => {
    const whole = ids('a', 'b', 'c');
    expect(ownedPath(all, whole, all[2])).toEqual(['O', 'I']);
    expect(ownedPath(all, whole, all[1])).toEqual(['O']);
    expect(contextPath(all, whole, all[2])).toEqual([]);
  });

  it('keeps nothing for layers in no group', () => {
    expect([ownedPath(all, ids('d'), all[4]), contextPath(all, ids('d'), all[4])]).toEqual([[], []]);
  });
});

describe('copies under new identities', () => {
  it('renames the kept groups consistently and gives every copy a new identity', () => {
    counter = 0;
    const { copies, groups } = detachedCopies(all, [all[2], all[3]], makeId);
    expect(copies.map((copy) => copy.groupPath)).toEqual([['new-1'], ['new-1']]);
    expect(copies.map((copy) => copy.id)).toEqual(['new-2', 'new-3']);
    expect(groups).toEqual(new Map([['I', 'new-1']]));
    expect(all[2].groupPath).toEqual(['O', 'I']);
  });

  it('leaves the group of a member copied alone, and joins the context when asked', () => {
    counter = 0;
    expect(detachedCopies(all, [all[2]], makeId).copies[0].groupPath).toBeUndefined();
    expect(detachedCopies(all, [all[2]], makeId, ['O', 'I']).copies[0].groupPath).toEqual(['O', 'I']);
  });

  it('keeps the groups selected whole in the clipboard under their old names', () => {
    const kept = clipboardLayers(all, [all[1], all[2], all[3]]);
    expect(kept.map((item) => item.groupPath)).toEqual([['O'], ['O', 'I'], ['O', 'I']]);
    const single = clipboardLayers(all, [all[2]]);
    expect(single[0].groupPath).toBeUndefined();
    expect(single[0].regroupPath).toBeUndefined();
  });
});

describe('placing above a selection without joining its groups', () => {
  it('goes above the outermost group holding the layer', () => {
    expect(aboveOutermostGroup(all, 2)).toBe(4);
    expect(aboveOutermostGroup(all, 0)).toBe(1);
    expect(aboveOutermostGroup(all, 4)).toBe(5);
  });
});
