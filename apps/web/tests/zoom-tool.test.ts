// @vitest-environment happy-dom
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { PreferencesService } from '../src/app/preferences.service';

const pointer = (x: number, y: number, extra: Partial<PointerEvent> = {}) =>
  ({ button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: vi.fn(), ...extra }) as unknown as PointerEvent;
const key = (extra: Partial<KeyboardEvent>) => ({ code: '', key: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra }) as unknown as KeyboardEvent;

/** The component on a 800 by 600 view whose canvas starts at its top left corner. */
function component(tool: 'zoom' | 'select' | 'rectangle' = 'select') {
  const editor = new EditorService();
  editor.zoom.set(1);
  editor.setTool(tool);
  const viewport = { clientWidth: 800, clientHeight: 600, scrollLeft: 1000, scrollTop: 1000, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const doc = editor.document();
  const canvas = { setPointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0, width: doc.width * editor.zoom(), height: doc.height * editor.zoom() }) };
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    editor, preferences: new PreferencesService(),
    canvas: { nativeElement: canvas }, viewport: { nativeElement: viewport },
    commitText: vi.fn(), temporarySelect: signal(false), temporaryPan: signal(false), cursorPoint: signal(null), textEditing: signal(null),
    zoomArea: signal(null), zoomHold: signal(null), altHeld: signal(false), flyout: signal(null),
    touches: new Map(), pinchResidue: false, mobile: signal(false), spaceHeld: false,
  });
  return { app, editor, viewport };
}
const hold = (app: AppComponent, keys: { space: boolean; ctrl: boolean; alt?: boolean }) => {
  Object.assign(app, { spaceHeld: keys.space });
  (app as unknown as { updateZoomHold(e: KeyboardEvent): void }).updateZoomHold(key({ code: 'Space', ctrlKey: keys.ctrl, altKey: !!keys.alt }));
};
beforeEach(() => { localStorage.clear(); vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; }); });
afterEach(() => vi.unstubAllGlobals());

describe('the Zoom tool', () => {
  it('zooms in to the next preset and brings the point clicked to the centre', () => {
    const { app, editor, viewport } = component('zoom');
    app.pointerDown(pointer(100, 100));
    app.pointerUp(pointer(100, 100));
    expect(editor.zoom()).toBe(1.5);
    // The point clicked, (100, 100), is now at (150, 150) on the canvas; the view moves it to (400, 300).
    expect(viewport.scrollLeft).toBe(1000 + 150 - 400);
    expect(viewport.scrollTop).toBe(1000 + 150 - 300);
  });

  it('zooms out to the previous preset with Alt', () => {
    const { app, editor } = component('zoom');
    app.pointerDown(pointer(100, 100, { altKey: true }));
    app.pointerUp(pointer(100, 100, { altKey: true }));
    expect(editor.zoom()).toBe(0.6667);
  });

  it('zooms to the area of a drag, and Space moves the marquee instead of resizing it', () => {
    const { app } = component('zoom');
    app.pointerDown(pointer(100, 100));
    app.pointerMove(pointer(300, 250));
    expect(app.zoomArea()).toEqual({ x: 100, y: 100, width: 200, height: 150 });
    Object.assign(app, { spaceHeld: true });
    app.pointerMove(pointer(350, 270));
    expect(app.zoomArea()).toEqual({ x: 150, y: 120, width: 200, height: 150 });
  });

  it('shows the actual size on a double-click, and the Hand tool fits the page', () => {
    const { app, editor } = component('select');
    editor.zoom.set(0.5);
    app.openToolOptions('zoom');
    expect(editor.zoom()).toBe(1);
    app.openToolOptions('hand');
    expect(editor.zoom()).toBeLessThanOrEqual(1);
  });

  it('answers to a finger tap on a touch screen', () => {
    const { app, editor } = component('zoom');
    app.pointerDown(pointer(100, 100, { pointerType: 'touch' }));
    app.pointerUp(pointer(100, 100, { pointerType: 'touch' }));
    expect(editor.zoom()).toBe(1.5);
  });
});

describe('Ctrl+Space and Ctrl+Alt+Space', () => {
  it('hold the Zoom tool over the tool in use and give it back when released', () => {
    const { app, editor } = component('rectangle');
    hold(app, { space: true, ctrl: true });
    expect(app.activeTool()).toBe('zoom');
    expect(app.toolIcon()).toBe('zoom-in');
    hold(app, { space: true, ctrl: true, alt: true });
    expect(app.toolIcon()).toBe('zoom-out');
    hold(app, { space: false, ctrl: true });
    expect(app.activeTool()).toBe('rectangle');
    expect(editor.tool()).toBe('rectangle');
  });

  it('zoom in with a click, out with Alt, and to an area with a drag, drawing nothing', () => {
    const { app, editor } = component('rectangle');
    hold(app, { space: true, ctrl: true });
    app.pointerDown(pointer(200, 200, { ctrlKey: true }));
    app.pointerUp(pointer(200, 200, { ctrlKey: true }));
    expect(editor.zoom()).toBe(1.5);
    hold(app, { space: true, ctrl: true, alt: true });
    app.pointerDown(pointer(200, 200, { ctrlKey: true, altKey: true }));
    app.pointerUp(pointer(200, 200, { ctrlKey: true, altKey: true }));
    expect(editor.zoom()).toBe(1);
    hold(app, { space: true, ctrl: true });
    app.pointerDown(pointer(0, 0, { ctrlKey: true }));
    app.pointerMove(pointer(400, 300, { ctrlKey: true }));
    app.pointerUp(pointer(400, 300, { ctrlKey: true }));
    expect(editor.zoom()).toBe(2);
    expect(editor.document().layers).toHaveLength(0);
  });

  it('are not taken while a text is being written', () => {
    const { app } = component('rectangle');
    Object.assign(app, { textEditing: signal('some-text') });
    hold(app, { space: true, ctrl: true });
    expect(app.activeTool()).toBe('rectangle');
  });
});
