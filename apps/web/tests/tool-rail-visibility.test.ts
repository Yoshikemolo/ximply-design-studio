// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PreferencesService } from '../src/app/preferences.service';

describe('tool column visibility', () => {
  it('shows the tool column until the owner hides it, and remembers the choice', () => {
    localStorage.clear();
    const preferences = new PreferencesService();
    expect(preferences.layoutBlocks().tools).toBe(true);
    expect(preferences.toggleLayoutBlock('tools')).toBe(true);
    expect(preferences.layoutBlocks().tools).toBe(false);
    expect(new PreferencesService().layoutBlocks().tools).toBe(false);
  });

  it('offers the tool column in the layout menu and gives the canvas its place', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    // The hidden column stays in the page as a drawer its edge handle opens.
    expect(template).toContain('@if (toolsDrawer()) {');
    expect(template).toContain('[class.no-tools]="!preferences.layoutBlocks().tools"');
    const component = readFileSync('apps/web/src/app/app.component.ts', 'utf8');
    expect(component).toContain('{ id: "tools", label: "Tools" }');
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    expect(styles).toContain('.workspace.no-tools {');
  });
});
