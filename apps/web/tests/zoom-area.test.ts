// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { TOOLS, TOOL_FAMILIES } from '../src/app/tools';

beforeEach(() => localStorage.clear());
const pointer = (x: number, y: number, ctrl = false) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, ctrlKey: ctrl, shiftKey: false, altKey: false, preventDefault: vi.fn() }) as unknown as PointerEvent;

function component(tool: 'zoom' | 'zoomArea' | 'select', spaceHeld = false) {
  localStorage.clear();
  const editor = new EditorService();
  editor.zoom.set(1);
  const viewport = { clientWidth: 800, clientHeight: 600, scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    editor,
    canvas: { nativeElement: { setPointerCapture: vi.fn() } },
    viewport: { nativeElement: viewport },
    commitText: vi.fn(), temporarySelect: signal(false), temporaryPan: signal(false), cursorPoint: signal(null),
    zoomArea: signal(null), activeTool: () => tool, point: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    spaceHeld,
  });
  return { app, editor, viewport };
}

describe('zoom area', () => {
  it('is offered as a zoom subtool', () => {
    const family = TOOL_FAMILIES.find((entry) => entry.id === 'zoom')!;
    expect(family.tools).toEqual(['zoom', 'zoomArea']);
    expect(TOOLS.find((tool) => tool.id === 'zoomArea')?.label).toBe('Zoom area');
  });

  it('fits the dragged rectangle into the workspace and centres it', () => {
    const { app, editor, viewport } = component('zoomArea');
    app.pointerDown(pointer(100, 100));
    app.pointerMove(pointer(500, 400));
    expect(app.zoomArea()).toEqual({ x: 100, y: 100, width: 400, height: 300 });
    app.pointerUp();
    // 400 by 300 of document fits 800 by 600: twice the size.
    expect(editor.zoom()).toBe(2);
    expect(viewport.scrollLeft).toBe(300 * 2 - 400);
    expect(viewport.scrollTop).toBe(250 * 2 - 300);
    expect(app.zoomArea()).toBeNull();
  });

  it('ignores a rectangle too small to be meant and leaves the document alone', () => {
    const { app, editor } = component('zoomArea');
    app.pointerDown(pointer(100, 100));
    app.pointerMove(pointer(104, 103));
    app.pointerUp();
    expect(editor.zoom()).toBe(1);
    expect(editor.document().layers).toHaveLength(0);
  });

  it('works as Ctrl with Space and a drag while another tool is active', () => {
    // Space is held, as the key handler records while the key is down.
    const { app, editor } = component('select', true);
    app.pointerDown(pointer(0, 0, true));
    app.pointerMove(pointer(400, 300, true));
    app.pointerUp();
    expect(editor.zoom()).toBe(2);
    expect(editor.document().layers).toHaveLength(0);
  });
});
