// @vitest-environment happy-dom
import "@angular/compiler";
import { signal } from "@angular/core";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { EditorService } from "../src/app/editor.service";
import { PreferencesService } from "../src/app/preferences.service";
import { AppComponent } from "../src/app/app.component";

// Prototype calls isolate input contracts without constructor scheduling effects.
// The DOM emulator omits WheelEvent.ctrlKey; tests supply that browser field explicitly.
function component() {
  const app = Object.create(AppComponent.prototype) as AppComponent;
  const editor = new EditorService(),
    preferences = new PreferencesService();
  Object.assign(app, {
    editor,
    preferences,
    temporarySelect: signal(false),
    temporaryPan: signal(false),
    cursorPoint: signal(null),
    textEditing: signal(null),
    textDraft: signal(""),
    recording: signal(null),
    flyout: signal(null),
    settings: signal(false),
    about: signal(false),
    dialog: signal(false),
    spatial: signal(false),
  });
  return app;
}
describe("inline editing and canvas-only zoom", () => {
  beforeEach(() => localStorage.clear());
  it("commits inline text in a single reversible edit", async () => {
    const { signal } = await import("@angular/core");
    const app = component(),
      e = app.editor;
    e.setTool("text");
    e.start({ x: 20, y: 20 });
    e.end();
    const old = e.selected()!.text;
    Object.assign(app, {
      textEditing: signal(e.selectedId()),
      textDraft: signal("Edited\nSecond line"),
    });
    app.commitText();
    expect(e.selected()!.text).toBe("Edited\nSecond line");
    e.undo();
    expect(e.selected()!.text).toBe(old);
  });
  it("Escape cancels text without changing the document and stops canvas shortcuts", async () => {
    const { signal } = await import("@angular/core");
    const app = component();
    Object.assign(app, { textEditing: signal("id") });
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    const stop = vi.spyOn(event, "stopPropagation");
    app.textKey(event);
    expect(app.textEditing()).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalled();
  });
  it("prevents page zoom only for the canvas modifier gesture", async () => {
    const { signal } = await import("@angular/core");
    const app = component();
    Object.assign(app, {
      spaceHeld: true,
      textEditing: signal(null),
      settings: signal(false),
      about: signal(false),
      dialog: signal(false),
    });
    const event = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      cancelable: true,
    });
    Object.defineProperty(event, "ctrlKey", { value: true });
    app.canvasWheel(event);
    expect(event.defaultPrevented).toBe(true);
    expect(app.editor.zoom()).toBeGreaterThan(0.7);
    const noSpace = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      cancelable: true,
    });
    Object.assign(app, { spaceHeld: false });
    Object.defineProperty(noSpace, "ctrlKey", { value: true });
    app.canvasWheel(noSpace);
    expect(noSpace.defaultPrevented).toBe(false);
  });
  it("suspends tool shortcuts while typing in an input", async () => {
    const { signal } = await import("@angular/core");
    const app = component();
    Object.assign(app, {
      about: signal(false),
      dialog: signal(false),
      settings: signal(false),
      textEditing: signal(null),
      spatial: signal(false),
    });
    const input = document.createElement("input"),
      event = new KeyboardEvent("keydown", {
        key: "p",
        bubbles: true,
        cancelable: true,
      });
    input.addEventListener("keydown", (e) => app.key(e));
    input.dispatchEvent(event);
    expect(app.editor.tool()).toBe("select");
    expect(event.defaultPrevented).toBe(false);
  });
  it("temporarily selects with Ctrl and resumes the unfinished Pen path", () => {
    const app = component(),
      e = app.editor;
    e.setTool("pen");
    e.start({ x: 100, y: 100 });
    e.end();
    e.start({ x: 200, y: 100 });
    e.end();
    const pathId = e.penId();
    app.key(
      new KeyboardEvent("keydown", {
        key: "Control",
        code: "ControlLeft",
        ctrlKey: true,
      }),
    );
    expect(app.activeTool()).toBe("select");
    expect(e.tool()).toBe("pen");
    Object.assign(app, {
      canvas: {
        nativeElement: {
          setPointerCapture: vi.fn(),
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 1200,
            height: 800,
          }),
        },
      },
    });
    app.pointerDown(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 150,
        clientY: 100,
        ctrlKey: true,
      }),
    );
    app.pointerUp();
    expect(e.penId()).toBe(pathId);
    app.keyUp(
      new KeyboardEvent("keyup", { key: "Control", code: "ControlLeft" }),
    );
    expect(app.activeTool()).toBe("pen");
    e.start({ x: 250, y: 150 });
    e.end();
    expect(e.document().layers).toHaveLength(1);
    expect(e.document().layers[0].curves![0].nodes).toHaveLength(3);
  });
  it("routes Ctrl and Shift through pointer events without replacing the stored tool", () => {
    const app = component(), e = app.editor;
    e.setTool("direct");
    Object.assign(app, { canvas: { nativeElement: {
      setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    } } });
    const start = vi.spyOn(e, "start"), move = vi.spyOn(e, "move");
    app.pointerDown(new PointerEvent("pointerdown", {
      button: 0, clientX: 100, clientY: 120, ctrlKey: true, shiftKey: true,
    }));
    expect(start).toHaveBeenCalledWith(
      { x: 100, y: 120 }, { ctrl: true, shift: true, alt: false }, "select",
    );
    app.pointerMove(new PointerEvent("pointermove", {
      clientX: 150, clientY: 170, ctrlKey: true, shiftKey: true, altKey: true,
    }));
    expect(move).toHaveBeenCalledWith(
      { x: 150, y: 170 }, { ctrl: true, shift: true, alt: true },
    );
    expect(e.tool()).toBe("direct");
  });
  it("keeps the Pen tool and path stable when Ctrl is pressed during a curve drag", () => {
    const app = component(), e = app.editor;
    e.setTool("pen");
    e.start({ x: 100, y: 100 });
    const pathId = e.penId();
    app.key(new KeyboardEvent("keydown", {
      key: "Control", code: "ControlLeft", ctrlKey: true,
    }));
    expect(e.isEditingCurve()).toBe(true);
    expect(app.activeTool()).toBe("pen");
    expect(e.tool()).toBe("pen");
    app.pointerUp();
    expect(app.activeTool()).toBe("select");
    app.keyUp(new KeyboardEvent("keyup", { key: "Control", code: "ControlLeft" }));
    expect(app.activeTool()).toBe("pen");
    expect(e.penId()).toBe(pathId);
    e.start({ x: 200, y: 150 });
    e.end();
    expect(e.document().layers).toHaveLength(1);
    expect(e.document().layers[0].curves![0].nodes).toHaveLength(2);
  });
  it("requests control-point overlays for Select without changing other tools", () => {
    const app = component(), e = app.editor;
    const canvas = document.createElement("canvas");
    Object.assign(app, { canvas: { nativeElement: canvas } });
    const draw = vi.spyOn(e.renderer, "draw").mockImplementation(() => {});
    const frame = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    try {
      app.schedule();
      expect(draw.mock.calls.at(-1)?.[6]).toMatchObject({ direct: true });
      e.setTool("text");
      app.schedule();
      expect(draw.mock.calls.at(-1)?.[6]).toMatchObject({ direct: false });
    } finally {
      frame.mockRestore();
      draw.mockRestore();
    }
  });
  it("clears a held Ctrl override when focus leaves the window", () => {
    const app = component();
    app.editor.setTool("text");
    app.temporarySelect.set(true);
    app.resetInput();
    expect(app.activeTool()).toBe("text");
    expect(app.temporarySelect()).toBe(false);
  });
  it("bounds explicit automatic multiline text height to the native document limit", () => {
    const app = component(),
      e = app.editor;
    e.setTool("text");
    e.start({ x: 20, y: 20 });
    e.end();
    e.updateLayer({ fontSize: 500 });
    Object.assign(e.renderer, { measureText: (text: string, size: number) => text.length * size * .6 });
    e.updateTextLayout({ sizing: "height" });
    app.textEditing.set(e.selectedId());
    app.textDraft.set("line\n".repeat(600));
    app.commitText();
    expect(e.selected()!.height).toBe(16384);
    expect(e.selected()!.text.length).toBe(2000);
  });
  it("opens the branded editable cover as a single undoable document change", () => {
    const app = component();
    const before = app.editor.document();
    vi.spyOn(app, "fit").mockImplementation(() => {});
    app.sample();
    expect(app.editor.document().name).toContain("Ximply");
    expect(
      app.editor
        .document()
        .layers.some((l) => l.name.includes("Brand X") && l.curves?.length),
    ).toBe(true);
    expect(app.editor.selectedLayers()).toHaveLength(0);
    app.editor.undo();
    expect(app.editor.document()).toEqual(before);
  });
  it("keeps inline text reflection and shear aligned with its canvas object", () => {
    const app = component(), e = app.editor;
    e.setTool("text"); e.start({ x: 20, y: 20 }); e.end();
    e.updateLayer({ rotation: 30, skewX: 20, flipX: true });
    expect(app.textTransform(e.selected()!)).toBe("rotate(30deg) skewX(20deg) scale(-1, 1)");
  });

  it("projects the cursor onto visible rulers independently of canvas axes", () => {
    const app = component();
    let rect = { left: 100, top: 60, width: 600, height: 400 };
    Object.assign(app, { canvas: { nativeElement: { getBoundingClientRect: () => rect } } });
    app.preferences.toggleCursorAxes(false);
    app.preferences.setMeasurement("rulersVisible", true);
    app.cursorPoint.set({ x: 250, y: 160 });
    expect(app.cursorAxesPoint()).toBeNull();
    expect(app.rulerCursorPoint()).toEqual({ x: 150, y: 100 });
    app.editor.zoom.set(2);
    rect = { left: 40, top: 20, width: 2400, height: 1600 };
    expect(app.rulerCursorPoint()).toEqual({ x: 210, y: 140 });
    app.preferences.setMeasurement("rulersVisible", false);
    expect(app.rulerCursorPoint()).toBeNull();
    app.preferences.setMeasurement("rulersVisible", true);
    app.cursorPoint.set(null);
    expect(app.rulerCursorPoint()).toBeNull();
  });

  it("positions canvas axes in displayed pixels across zoom and scroll offsets", () => {
    const app = component();
    let rect = { left: 100, top: 60, width: 600, height: 400 };
    Object.assign(app, { canvas: { nativeElement: { getBoundingClientRect: () => rect } } });
    app.editor.zoom.set(0.5);
    app.cursorPoint.set({ x: 250, y: 160 });
    expect(app.cursorAxesPoint()).toEqual({ x: 150, y: 100 });
    app.editor.zoom.set(2);
    rect = { left: 40, top: 20, width: 2400, height: 1600 };
    app.refreshCursorPosition();
    expect(app.cursorAxesPoint()).toEqual({ x: 210, y: 140 });
    expect(app.cursorPoint()).toEqual({ x: 250, y: 160 });
  });
  it("hides canvas axes outside its bounds, during editing and when disabled", () => {
    const app = component();
    Object.assign(app, { canvas: { nativeElement: {
      getBoundingClientRect: () => ({ left: 100, top: 60, width: 600, height: 400 }),
    } } });
    for (const point of [{ x: 99, y: 80 }, { x: 150, y: 59 }, { x: 700, y: 80 }, { x: 150, y: 460 }]) {
      app.cursorPoint.set(point);
      expect(app.cursorAxesPoint()).toBeNull();
    }
    app.cursorPoint.set({ x: 100, y: 60 });
    expect(app.cursorAxesPoint()).toEqual({ x: 0, y: 0 });
    app.textEditing.set("text");
    expect(app.cursorAxesPoint()).toBeNull();
    app.textEditing.set(null);
    app.settings.set(true);
    expect(app.cursorAxesPoint()).toBeNull();
    app.settings.set(false);
    app.preferences.toggleCursorAxes(false);
    expect(app.cursorAxesPoint()).toBeNull();
    expect(app.preferences.cursorIcon()).toBe(true);
    app.preferences.toggleCursorAxes(true);
    expect(app.toolCursor()).toBe("none");
    app.cursorPoint.set(null);
    expect(app.cursorAxesPoint()).toBeNull();
  });

  it("hides captured-pointer axes outside the visible viewport and over scrollbars", () => {
    const app = component();
    Object.assign(app, {
      canvas: { nativeElement: {
        getBoundingClientRect: () => ({ left: -400, top: -200, width: 2400, height: 1600 }),
      } },
      viewport: { nativeElement: {
        getBoundingClientRect: () => ({ left: 100, top: 60, width: 815, height: 615 }),
        clientLeft: 0, clientTop: 0, clientWidth: 800, clientHeight: 600,
      } },
    });
    for (const point of [{ x: 80, y: 100 }, { x: 400, y: 50 }, { x: 905, y: 100 }, { x: 400, y: 665 }]) {
      app.cursorPoint.set(point);
      expect(app.cursorAxesPoint()).toBeNull();
    }
    app.cursorPoint.set({ x: 400, y: 200 });
    expect(app.cursorAxesPoint()).toEqual({ x: 800, y: 400 });
  });

});
