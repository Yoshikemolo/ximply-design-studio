import { describe, expect, it } from 'vitest';
import { defaultShortcuts, matchShortcut, validateShortcuts } from '../src/shortcuts';

describe('numeric transform shortcuts', () => {
  it('opens displacement and rotation with platform modifier shortcuts', () => {
    const shortcuts = validateShortcuts(defaultShortcuts());
    expect(matchShortcut(shortcuts, { key: 'M', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe('displacement');
    expect(matchShortcut(shortcuts, { key: 'R', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe('rotation');
    expect(shortcuts.regroup).toEqual([]);
  });
  it('migrates previous shortcut settings with defaults when available', () => {
    const previous = defaultShortcuts(); delete previous.displacement; delete previous.rotation; delete previous.regroup;
    const migrated = validateShortcuts(previous);
    expect(migrated.displacement).toEqual(['Mod+Shift+M']);
    expect(migrated.rotation).toEqual(['Mod+Shift+R']);
    expect(migrated.regroup).toEqual([]);
  });
  it('preserves occupied user bindings and leaves colliding new defaults unassigned', () => {
    const previous = defaultShortcuts(); delete previous.displacement; delete previous.rotation; delete previous.regroup;
    previous.rotateCW = ['Ctrl+Shift+R']; previous.alignLeft = ['Ctrl+Shift+M'];
    const migrated = validateShortcuts(previous);
    expect(migrated.rotation).toEqual([]); expect(migrated.displacement).toEqual([]);
    expect(migrated.rotateCW).toEqual(['Mod+Shift+R']); expect(migrated.alignLeft).toEqual(['Mod+Shift+M']);
    expect(() => validateShortcuts({ ...migrated, rotation: ['Mod+Shift+M'] })).toThrow('Shortcut collision');
  });
});
