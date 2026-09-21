// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';

beforeEach(() => localStorage.clear());

function canvasComponent(editor: EditorService) {
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    editor,
    canvas: { nativeElement: { setPointerCapture: vi.fn() } },
    commitText: vi.fn(),
    temporarySelect: signal(false),
    temporaryPan: signal(false),
    cursorPoint: signal(null),
    activeTool: () => editor.tool(),
    point: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
  });
  return app;
}
const pointer = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault: vi.fn(), shiftKey: false, altKey: false, ctrlKey: false }) as unknown as PointerEvent;
/** Browser order for a click on a captured canvas: pointerdown, pointerup, then lostpointercapture. */
function click(app: AppComponent, x: number, y: number) {
  app.pointerMove(pointer(x, y));
  app.pointerDown(pointer(x, y));
  app.pointerUp();
  app.pointerLost();
}

describe('dimension placement with real pointer event order', () => {
  it('keeps each fixed point after the capture is released and creates the dimension on the third click', () => {
    const editor = new EditorService(), app = canvasComponent(editor);
    editor.setTool('dimensionLinear');
    click(app, 100, 100);
    expect(editor.dimensionDraft()?.points).toEqual([{ x: 100, y: 100 }]);
    click(app, 250, 100);
    expect(editor.dimensionDraft()?.points).toHaveLength(2);
    expect(editor.dimensionPreview()).not.toBeNull();
    click(app, 175, 60);
    expect(editor.dimensionDraft()).toBeNull();
    expect(editor.document().layers).toHaveLength(1);
    expect(editor.selected()?.dimension?.kind).toBe('linear');
  });

  it('still cancels when the capture is lost during a press', () => {
    const editor = new EditorService(), app = canvasComponent(editor);
    editor.setTool('dimensionLinear');
    app.pointerDown(pointer(100, 100));
    app.pointerLost();
    expect(editor.dimensionDraft()).toBeNull();
  });
});
