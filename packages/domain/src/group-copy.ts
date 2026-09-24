import { Layer } from "./document";

/**
 * How copies relate to the groups of their originals, as Illustrator does it (owner request
 * of 2026-09-24). A copy keeps the groups that were selected whole, under new identities, so a
 * copied group is a group again; it leaves every group it was only a member of. Paste in Front
 * and Paste in Back put the copies inside the groups of the object they are pasted at, when
 * that object is a member of a group rather than a whole group.
 */

/** Whether every member of a group is in the selection, so the group itself is selected. */
function wholeGroup(all: readonly Layer[], selected: ReadonlySet<string>, group: string): boolean {
  return all.every((layer) => !layer.groupPath?.includes(group) || selected.has(layer.id));
}

/** Where a layer's path splits: groups before it hold the selection, groups from it are selected whole. */
function split(all: readonly Layer[], selected: ReadonlySet<string>, layer: Layer): number {
  const path = layer.groupPath ?? [];
  const index = path.findIndex((group) => wholeGroup(all, selected, group));
  return index < 0 ? path.length : index;
}

/** The groups a copy of the layer keeps: those selected whole, outermost first. */
export function ownedPath(all: readonly Layer[], selected: ReadonlySet<string>, layer: Layer): string[] {
  return (layer.groupPath ?? []).slice(split(all, selected, layer));
}

/** The groups the selected layer lives inside without being selected whole. */
export function contextPath(all: readonly Layer[], selected: ReadonlySet<string>, layer: Layer): string[] {
  return (layer.groupPath ?? []).slice(0, split(all, selected, layer));
}

/**
 * The copies of layers under new identities: each keeps only its owned groups, renamed
 * consistently so layers of one group stay together, after an optional prefix of groups the
 * copies are placed into. Returns the copies and the renaming of the groups.
 */
export function detachedCopies(all: readonly Layer[], layers: readonly Layer[], makeId: () => string, prefix: readonly string[] = [],
  selected: ReadonlySet<string> = new Set(layers.map((layer) => layer.id))): { copies: Layer[]; groups: Map<string, string> } {
  const groups = new Map<string, string>();
  const copies = layers.map((layer) => {
    const owned = ownedPath(all, selected, layer).map((group) => {
      if (!groups.has(group)) groups.set(group, makeId());
      return groups.get(group)!;
    });
    const path = [...prefix, ...owned];
    const copy: Layer = { ...structuredClone(layer), id: makeId(), regroupPath: undefined };
    if (path.length) copy.groupPath = path;
    else delete copy.groupPath;
    return copy;
  });
  return { copies, groups };
}

/**
 * The layers as they sit in the clipboard: each keeps its owned groups under their old
 * identities, which every paste renames again, so two pastes make two separate groups.
 */
export function clipboardLayers(all: readonly Layer[], layers: readonly Layer[]): Layer[] {
  const selected = new Set(layers.map((layer) => layer.id));
  return layers.map((layer) => {
    const copy: Layer = structuredClone(layer);
    const owned = ownedPath(all, selected, layer);
    if (owned.length) copy.groupPath = owned;
    else delete copy.groupPath;
    delete copy.regroupPath;
    return copy;
  });
}

/**
 * The index just above the outermost group holding a layer, or just above the layer when it is
 * in no group: where an object that must not join those groups goes to sit above it.
 */
export function aboveOutermostGroup(all: readonly Layer[], index: number): number {
  const outer = all[index]?.groupPath?.[0];
  if (!outer) return index + 1;
  let last = index;
  all.forEach((layer, at) => { if (layer.groupPath?.includes(outer)) last = Math.max(last, at); });
  return last + 1;
}
