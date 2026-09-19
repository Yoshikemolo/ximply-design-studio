// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { PreferencesService } from "../src/app/preferences.service";
describe("input preferences", () => {
  beforeEach(() => localStorage.clear());
  it("persists unique bindings and cursor visibility", () => {
    const p = new PreferencesService();
    expect(p.assign("tool.pen", ["Q"])).toBe(true);
    p.toggleCursor(false);
    p.setSnapAngle(30);
    const reloaded = new PreferencesService();
    expect(reloaded.bindings()["tool.pen"]).toEqual(["Q"]);
    expect(reloaded.cursorIcon()).toBe(false);
    expect(reloaded.snapAngle()).toBe(30);
  });
  it("rejects collisions atomically without replacing the previous binding", () => {
    const p = new PreferencesService();
    expect(p.assign("tool.pen", ["V"])).toBe(false);
    expect(p.bindings()["tool.pen"]).toEqual(["P"]);
    expect(localStorage.getItem("xds-input-settings")).toBeNull();
    expect(p.error()).toContain("collision");
  });
  it("recovers malformed settings and rejects invalid snap angles", () => {
    localStorage.setItem("xds-input-settings", '{"version":1,"bindings":{}}');
    const p = new PreferencesService();
    expect(p.error()).toContain("Defaults restored");
    p.setSnapAngle(0);
    expect(p.snapAngle()).toBe(45);
  });
  it("persists canvas axes independently of the tool badge and other settings", () => {
    const p = new PreferencesService();
    expect(p.cursorAxes()).toBe(true);
    p.toggleCursorAxes(false);
    p.toggleCursor(false);
    p.setSnapAngle(30);
    p.assign("tool.pen", ["Q"]);
    p.reset();
    const reloaded = new PreferencesService();
    expect(reloaded.cursorAxes()).toBe(false);
    expect(reloaded.cursorIcon()).toBe(false);
    expect(reloaded.snapAngle()).toBe(30);
    reloaded.toggleCursorAxes(true);
    expect(new PreferencesService().cursorAxes()).toBe(true);
    expect(new PreferencesService().cursorIcon()).toBe(false);
  });
  it("loads earlier settings without losing shortcuts and rejects malformed axes", () => {
    const p = new PreferencesService();
    p.assign("tool.pen", ["Q"]);
    const saved = JSON.parse(localStorage.getItem("xds-input-settings")!);
    delete saved.cursorAxes;
    localStorage.setItem("xds-input-settings", JSON.stringify(saved));
    const legacy = new PreferencesService();
    expect(legacy.cursorAxes()).toBe(true);
    expect(legacy.bindings()["tool.pen"]).toEqual(["Q"]);
    localStorage.setItem("xds-input-settings", JSON.stringify({ ...saved, cursorAxes: "false" }));
    expect(new PreferencesService().error()).toContain("Defaults restored");
  });
  it("leaves axes unchanged when storage refuses the preference update", () => {
    const p = new PreferencesService();
    const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    try {
      p.toggleCursorAxes(false);
      expect(p.cursorAxes()).toBe(true);
      expect(p.error()).toBe("Settings could not be saved.");
    } finally {
      storage.mockRestore();
    }
  });

});
