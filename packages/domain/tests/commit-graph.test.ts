import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../src/commit-graph';

const c = (sha: string, ...parents: string[]) => ({ sha, parents });

describe('history graph lanes (FEAT-0031, SC-0126)', () => {
  it('keeps a straight history in one lane', () => {
    const graph = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(graph.lanes).toBe(1);
    expect(graph.rows.map((row) => [row.lane, row.incoming, row.outgoing])).toEqual([[0, [], [0]], [0, [0], [0]], [0, [0], []]]);
  });

  it('forks a lane for a branch and joins it at the merge', () => {
    // m merges f (feature) into d (main); both come from b.
    const graph = layoutGraph([c('m', 'd', 'f'), c('f', 'e'), c('d', 'b'), c('e', 'b'), c('b', 'a'), c('a')]);
    const row = Object.fromEntries(graph.rows.map((item) => [item.sha, item]));
    expect(graph.lanes).toBe(2);
    expect(row['m']).toMatchObject({ lane: 0, outgoing: [0, 1] });
    expect(row['f']).toMatchObject({ lane: 1, incoming: [1], passes: [0] });
    expect(row['d']).toMatchObject({ lane: 0, passes: [1] });
    expect(row['e']).toMatchObject({ lane: 1, outgoing: [1] });
    // Both lanes wait for b; they meet at its node, and the second lane is freed.
    expect(row['b']).toMatchObject({ lane: 0, incoming: [0, 1], passes: [], outgoing: [0] });
  });

  it('gives each branch tip its own lane and reuses freed lanes', () => {
    const graph = layoutGraph([c('x', 'a'), c('y', 'a'), c('a'), c('z')]);
    expect(graph.rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
    expect(graph.rows[2].incoming).toEqual([0, 1]);
    expect(graph.lanes).toBe(2);
  });

  it('ends lanes at parents a shortened history does not list', () => {
    const graph = layoutGraph([c('b', 'a')]);
    expect(graph.rows[0].outgoing).toEqual([]);
  });

  it('never lets a passing lane cross the node of another', () => {
    const graph = layoutGraph([c('m', 'd', 'f'), c('f', 'e'), c('d', 'b'), c('e', 'b'), c('b', 'a'), c('a')]);
    for (const row of graph.rows) expect(row.passes).not.toContain(row.lane);
  });
});
