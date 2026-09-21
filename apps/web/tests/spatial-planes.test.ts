import { describe, expect, it } from 'vitest';
import { Layer, newLayer } from '../../../packages/domain/src/document';
import { spatialPlanes } from '../src/app/spatial';

const layer = (name: string, groupPath?: string[]): Layer => ({
  ...newLayer('rect', name, { x: 0, y: 0 }),
  name,
  groupPath,
});

describe('spatial planes', () => {
  it('puts every element of a group on the same plane', () => {
    const planes = spatialPlanes([
      layer('a', ['g1']),
      layer('b', ['g1', 'inner']),
      layer('c'),
      layer('d', ['g2']),
    ]);
    expect(planes.map((plane) => plane.map((item) => item.name))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ]);
  });

  it('keeps a group together even when another layer sits between its elements', () => {
    const planes = spatialPlanes([layer('a', ['g1']), layer('b'), layer('c', ['g1'])]);
    expect(planes.map((plane) => plane.map((item) => item.name))).toEqual([['a', 'c'], ['b']]);
  });

  it('gives each loose layer its own plane', () => {
    expect(spatialPlanes([layer('a'), layer('b')]).length).toBe(2);
  });
});
