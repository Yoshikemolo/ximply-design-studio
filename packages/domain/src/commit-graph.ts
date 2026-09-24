/**
 * The vertical history graph of change control (FEAT-0031, SC-0126): each commit gets a lane,
 * and each row says which lanes pass through it, which come into its node from above and which
 * leave it downwards to its parents. Lanes never shift sideways; a freed lane is reused.
 */
export interface GraphCommit { sha: string; parents: string[] }
export interface GraphRow {
  sha: string;
  /** The lane of the commit's node. */
  lane: number;
  /** Lanes that cross the row without touching the node. */
  passes: number[];
  /** Lanes that come down into the node: the node's own lane and those of other children. */
  incoming: number[];
  /** Lanes that go down from the node to its parents, first parent first. */
  outgoing: number[];
}
export interface CommitGraph { rows: GraphRow[]; lanes: number }

/** Lays out commits given children before parents, as `git log --topo-order` lists them. */
export function layoutGraph(commits: readonly GraphCommit[]): CommitGraph {
  const known = new Set(commits.map((commit) => commit.sha));
  // Each slot holds the commit that lane is waiting for, or null when it is free.
  const slots: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let width = 0;
  const free = () => {
    const index = slots.indexOf(null);
    if (index >= 0) return index;
    slots.push(null);
    return slots.length - 1;
  };
  for (const commit of commits) {
    const waiting = slots.flatMap((sha, index) => (sha === commit.sha ? [index] : []));
    const lane = waiting.length ? waiting[0] : free();
    const incoming = waiting.length ? waiting : [];
    for (const index of waiting) slots[index] = null;
    const passes = slots.flatMap((sha, index) => (sha !== null && index !== lane ? [index] : []));
    const outgoing: number[] = [];
    // Parents outside the listed history (a shortened log) end at the node.
    commit.parents.filter((parent) => known.has(parent)).forEach((parent, order) => {
      // The first parent continues the commit's own lane down to it, even when another lane
      // waits for the same parent, so two branches meet at their common commit; a merge's
      // other parents join a lane already waiting for them.
      if (order === 0 && slots[lane] === null) { slots[lane] = parent; outgoing.push(lane); return; }
      const existing = slots.indexOf(parent);
      if (existing >= 0) { outgoing.push(existing); return; }
      const target = free();
      slots[target] = parent;
      outgoing.push(target);
    });
    width = Math.max(width, slots.length, lane + 1);
    rows.push({ sha: commit.sha, lane, passes, incoming, outgoing });
    while (slots.length && slots[slots.length - 1] === null) slots.pop();
  }
  return { rows, lanes: width };
}
