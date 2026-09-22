// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';
import { AppComponent } from '../src/app/app.component';
import { TOOL_FAMILIES } from '../src/app/tools';
import { newLayer } from '../../../packages/domain/src/document';

/** A component on a phone, with a canvas that fills the drawing at a zoom of 1. */
function phone() {
  const app = Object.create(AppComponent.prototype) as AppComponent;
  const editor = new EditorService(), preferences = new PreferencesService();
  editor.zoom.set(1);
  const doc = editor.document();
  const canvas = {
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: doc.width * editor.zoom(), height: doc.height * editor.zoom() }),
  };
  Object.assign(app, {
    editor, preferences,
    temporarySelect: signal(false), temporaryPan: signal(false), cursorPoint: signal(null),
    textEditing: signal(null), textDraft: signal(''), recording: signal(null), flyout: signal(null),
    settings: signal(false), about: signal(false), dialog: signal(false), spatial: signal(false),
    altHeld: signal(false), mobile: signal(true), mobileMenu: signal(false), toolsOpen: signal(false), panelsOpen: signal(false),
    touches: new Map(), pinchResidue: false, syntheticContext: false, swipeStart: null,
    canvas: { nativeElement: canvas },
    viewport: { nativeElement: { scrollLeft: 0, scrollTop: 0 } },
  });
  return { app, editor };
}
const touch = (type: string, id: number, x: number, y: number, target: EventTarget = document.body) =>
  ({ type, pointerType: 'touch', pointerId: id, clientX: x, clientY: y, isPrimary: id === 1, button: 0, target, preventDefault: () => undefined } as unknown as PointerEvent);

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('drawers on a phone', () => {
  it('open from the edge a finger swipes in from, and close with a swipe back', () => {
    const { app } = phone();
    app.touchStart(touch('pointerdown', 1, 5, 300));
    app.touchEnd(touch('pointerup', 1, 150, 305));
    expect(app.toolsOpen()).toBe(true);
    app.touchStart(touch('pointerdown', 1, 200, 300));
    app.touchEnd(touch('pointerup', 1, 60, 300));
    expect(app.toolsOpen()).toBe(false);
    app.touchStart(touch('pointerdown', 1, 396, 300));
    app.touchEnd(touch('pointerup', 1, 240, 300));
    expect(app.panelsOpen()).toBe(true);
  });

  it('close when a tool is chosen, so the canvas is free to draw on', () => {
    const { app } = phone();
    Object.assign(app, { commitText: () => undefined, families: TOOL_FAMILIES, familyChoices: signal({}) });
    app.openDrawer('tools');
    app.chooseTool('rectangle');
    expect(app.toolsOpen()).toBe(false);
  });
});

describe('the long press', () => {
  it('opens the context menu of what the finger rests on', () => {
    vi.useFakeTimers();
    const { app } = phone();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const menu = vi.fn();
    target.addEventListener('contextmenu', (event) => menu((event as MouseEvent).clientX, (event as MouseEvent).clientY));
    app.touchStart(touch('pointerdown', 1, 120, 140, target));
    vi.advanceTimersByTime(600);
    expect(menu).toHaveBeenCalledWith(120, 140);
    target.remove();
  });

  it('is not a long press once the finger moves or lifts', () => {
    vi.useFakeTimers();
    const { app } = phone();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const menu = vi.fn();
    target.addEventListener('contextmenu', menu);
    app.touchStart(touch('pointerdown', 1, 120, 140, target));
    app.touchMove(touch('pointermove', 1, 150, 140, target));
    vi.advanceTimersByTime(600);
    app.touchStart(touch('pointerdown', 1, 120, 140, target));
    app.touchEnd(touch('pointerup', 1, 120, 140, target));
    vi.advanceTimersByTime(600);
    expect(menu).not.toHaveBeenCalled();
    target.remove();
  });
});

describe('two fingers on the canvas', () => {
  it('zoom the canvas around themselves away from the selection', () => {
    const { app, editor } = phone();
    app.pointerDown(touch('pointerdown', 1, 100, 100));
    app.pointerDown(touch('pointerdown', 2, 200, 100));
    app.pointerMove(touch('pointermove', 2, 300, 100));
    expect(editor.zoom()).toBeCloseTo(2, 6);
    app.pointerUp(touch('pointerup', 2, 300, 100));
    app.pointerUp(touch('pointerup', 1, 100, 100));
    expect(editor.document().layers).toHaveLength(0);
  });

  it('scale in proportion and turn the selection they land on, as one step', () => {
    const { app, editor } = phone();
    const box = { ...newLayer('rectangle', 'box', { x: 100, y: 100 }), width: 100, height: 50, fill: '#000000' };
    editor.document.update((d) => ({ ...d, layers: [box] }));
    editor.selectedIds.set(['box']);
    editor.selectedId.set('box');
    editor.setTool('select');
    app.pointerDown(touch('pointerdown', 1, 120, 125));
    app.pointerDown(touch('pointerdown', 2, 180, 125));
    // The fingers spread to twice their distance and turn a quarter.
    app.pointerMove(touch('pointermove', 1, 150, 65));
    app.pointerMove(touch('pointermove', 2, 150, 185));
    const layer = editor.document().layers[0];
    expect(layer.width).toBeCloseTo(200, 6);
    expect(layer.height).toBeCloseTo(100, 6);
    expect(layer.rotation).toBeCloseTo(90, 6);
    app.pointerUp(touch('pointerup', 2, 150, 185));
    app.pointerUp(touch('pointerup', 1, 150, 65));
    editor.undo();
    expect(editor.document().layers[0].width).toBe(100);
  });
});

describe('the document list in the header', () => {
  const choose = (app: AppComponent, value: string) => {
    const select = document.createElement('select');
    for (const v of [value, 'keep']) { const option = document.createElement('option'); option.value = v; select.appendChild(option); }
    select.value = value;
    app.chooseDocument({ target: select } as unknown as Event);
    return select;
  };

  it('shows, creates and closes documents in place of the tabs', () => {
    const { app, editor } = phone();
    Object.assign(app, { commitText: () => undefined, fit: () => undefined, confirmation: signal(null) });
    const first = editor.tabs()[0].id;
    choose(app, 'new');
    expect(editor.tabs()).toHaveLength(2);
    const second = editor.tabs().find((tab) => tab.active)!.id;
    expect(second).not.toBe(first);
    choose(app, first);
    expect(editor.tabs().find((tab) => tab.active)!.id).toBe(first);
    choose(app, 'close');
    expect(editor.tabs().map((tab) => tab.id)).toEqual([second]);
  });

  it('sits in the header between the brand and the language, with the tab strip hidden on phones', () => {
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const header = html.slice(html.indexOf('<header class="menubar">'), html.indexOf('</header>'));
    expect(header.indexOf('class="brand"')).toBeLessThan(header.indexOf('mobile-documents'));
    expect(header.indexOf('mobile-documents')).toBeLessThan(header.indexOf('class="language"'));
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    const phoneStyles = styles.slice(styles.lastIndexOf('@media (max-width: 720px)'));
    expect(phoneStyles).toMatch(/\.document-tabs \{\s*display: none;/);
    expect(phoneStyles).toMatch(/\.mobile-documents \{\s*display: block;/);
  });
});

describe('the phone layout', () => {
  it('keeps the page at the size of the screen and the canvas touches for itself', () => {
    const index = readFileSync('apps/web/src/index.html', 'utf8');
    expect(index).toContain('user-scalable=no');
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    const phoneStyles = styles.slice(styles.lastIndexOf('@media (max-width: 720px)'));
    expect(phoneStyles).toContain('touch-action: none');
    expect(phoneStyles).toContain('overflow-x: hidden');
    expect(phoneStyles).toContain('.studio-shell > footer');
  });
});
