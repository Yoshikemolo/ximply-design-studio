import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_FAMILIES } from '../src/app/tools';

describe('the tools column', () => {
  it('shows every family of tools, each once', () => {
    const source = readFileSync('apps/web/src/app/app.component.ts', 'utf8');
    const sections = source.slice(source.indexOf('readonly toolbarSections'), source.indexOf('].map((section)', source.indexOf('readonly toolbarSections')));
    const listed = [...sections.matchAll(/families: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]));
    for (const family of TOOL_FAMILIES) expect(listed, family.id).toContain(family.id);
    expect(new Set(listed).size).toBe(listed.length);
  });
});
