// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { AppComponent } from '../src/app/app.component';
import { TOOL_FAMILIES } from '../src/app/tools';

/** A component on a wide screen, where the tools and the panels are columns. */
function desktop() {
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    editor: new EditorService(), preferences: new PreferencesService(), mobile: signal(false), mobileMenu: signal(false),
    toolsOpen: signal(false), panelsOpen: signal(false), panels: signal(true), swipeStart: null, textEditing: signal(null),
    commitText: () => undefined, families: TOOL_FAMILIES, familyChoices: signal({}), flyout: signal(null),
  });
  return app;
}
const touch = (type: string, x: number) => ({ type, pointerType: 'touch', pointerId: 1, clientX: x, clientY: 300, button: 0, target: document.body } as unknown as PointerEvent);

beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true }); });
afterEach(() => vi.unstubAllGlobals());

describe('hidden columns on a wide screen', () => {
  it('are no drawers while they are shown', () => {
    const app = desktop();
    expect([app.toolsDrawer(), app.panelsDrawer()]).toEqual([false, false]);
  });

  it('become drawers that their edge handle or a swipe from their edge slides in, and that stay open like a column', () => {
    const app = desktop();
    app.preferences.toggleLayoutBlock('tools');
    app.panels.set(false);
    expect([app.toolsDrawer(), app.panelsDrawer()]).toEqual([true, true]);
    app.touchStart(touch('pointerdown', 1296));
    app.touchEnd(touch('pointerup', 1140));
    expect([app.toolsOpen(), app.panelsOpen()]).toEqual([false, true]);
    app.toggleDrawer('tools');
    expect([app.toolsOpen(), app.panelsOpen()]).toEqual([true, true]);
    // Choosing a tool leaves the drawer open, as the column of panels stays.
    app.chooseTool('rectangle');
    expect(app.toolsOpen()).toBe(true);
    // The handle closes its own drawer again.
    app.toggleDrawer('tools');
    expect([app.toolsOpen(), app.panelsOpen()]).toEqual([false, true]);
    app.closeDrawers();
    expect(app.panelsOpen()).toBe(false);
  });

  it('draw no backdrop, so the canvas stays usable, and keep the handle on the edge of the open drawer', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    expect(template).toContain('@if ((mobile() && (toolsOpen() || panelsOpen())) || mobileMenu()) {');
    expect(template).toContain('[class.open]="toolsOpen() && !mobile()"');
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    expect(styles).toContain('.drawer-handle.left.open { left: var(--tools-width); z-index: 56; }');
    expect(styles).toContain('.drawer-handle.right.open { right: var(--panels-width); z-index: 56; }');
  });

  it('do not open from a swipe on the side of a column that is shown', () => {
    const app = desktop();
    app.panels.set(false);
    app.touchStart(touch('pointerdown', 4));
    app.touchEnd(touch('pointerup', 150));
    expect(app.toolsOpen()).toBe(false);
  });

  it('keep their place in the page, narrow the column to nothing and slide out to their side', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    expect(template).toContain('<aside class="toolrail" [class.drawer-open]="toolsOpen() && toolsDrawer()"');
    expect(template).toContain('<aside class="inspector" [class.drawer-open]="panelsOpen() && panelsDrawer()"');
    expect(template).not.toContain('@if (panels()) {');
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    expect(styles).toMatch(/\.workspace\.no-tools\.no-panels \{\s*grid-template-columns: 0px minmax\(0, 1fr\) 0px;/);
    expect(styles).toMatch(/\.workspace\.no-tools > \.toolrail \{[^}]*transform: translateX\(-105%\);/);
    expect(styles).toMatch(/\.workspace\.no-panels > \.inspector \{[^}]*transform: translateX\(105%\);/);
    expect(styles).toMatch(/transition: grid-template-columns 0\.22s ease;/);
  });
});
