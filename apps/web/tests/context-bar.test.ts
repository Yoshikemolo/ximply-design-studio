// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PreferencesService } from '../src/app/preferences.service';

beforeEach(() => localStorage.clear());
describe('the context bar', () => {
  it('shows by default and is hidden or shown from View > Layout, remembered', () => {
    const preferences = new PreferencesService();
    expect(preferences.layoutBlocks().contextBar).toBe(true);
    expect(preferences.toggleLayoutBlock('contextBar')).toBe(true);
    expect(new PreferencesService().layoutBlocks().contextBar).toBe(false);
  });

  it('is drawn only while its block is on, and is listed in View > Layout', () => {
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    expect(html).toMatch(/@if \(preferences\.layoutBlocks\(\)\.contextBar\) \{\s*<div class="contextbar">/);
    expect(readFileSync('apps/web/src/app/app.component.ts', 'utf8')).toContain('{ id: "contextBar", label: "Context bar" }');
  });
});
