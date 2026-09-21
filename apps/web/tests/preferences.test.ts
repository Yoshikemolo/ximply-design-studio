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

  it("persists measurement units, visibility and individual layout blocks", () => {
    const p = new PreferencesService();
    p.setMeasurement("distanceUnit", "mm");
    p.setMeasurement("fontUnit", "pt");
    p.setMeasurement("gridSize", 96);
    p.setMeasurement("rulersVisible", true);
    p.setMeasurement("snapGuides", true);
    p.toggleLayoutBlock("appearance");
    p.toggleCursor(false);
    const restored = new PreferencesService();
    expect(restored.distanceUnit()).toBe("mm");
    expect(restored.fontUnit()).toBe("pt");
    expect(restored.gridSize()).toBe(96);
    expect(restored.rulersVisible()).toBe(true);
    expect(restored.snapGuides()).toBe(true);
    expect(restored.layoutBlocks()).toEqual({ tools: true, appearance: false, workspace: true, measurement: true, dimensions: true, pivot: true, selection: true });
  });
  it("rejects invalid measurements and rolls back failed persistence", () => {
    const p = new PreferencesService();
    for (const value of [0, -1, NaN, Infinity, 100001]) expect(p.setMeasurement("gridSize", value)).toBe(false);
    expect(p.gridSize()).toBe(20);
    expect(p.setMeasurement("guideSnapRadius", 0)).toBe(true);
    const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    try {
      expect(p.setMeasurement("distanceUnit", "mm")).toBe(false);
      expect(p.distanceUnit()).toBe("px");
      expect(p.toggleLayoutBlock("appearance")).toBe(false);
      expect(p.layoutBlocks().appearance).toBe(true);
    } finally { storage.mockRestore(); }
  });
  it("restores all defaults when persisted measurement data is malformed", () => {
    const p = new PreferencesService();
    p.setMeasurement("distanceUnit", "in");
    const saved = JSON.parse(localStorage.getItem("xds-input-settings")!);
    saved.measurements.gridSize = -20;
    localStorage.setItem("xds-input-settings", JSON.stringify(saved));
    const restored = new PreferencesService();
    expect(restored.distanceUnit()).toBe("px");
    expect(restored.gridSize()).toBe(20);
    expect(restored.error()).toContain("Defaults restored");
  });
});

describe("global guide lock preference", () => {
  beforeEach(() => localStorage.clear());
  it("persists independently from guide visibility and magnetic behavior", () => {
    const preferences = new PreferencesService();
    expect(preferences.guidesLocked()).toBe(false);
    preferences.setMeasurement("guidesLocked", true);
    preferences.setMeasurement("guidesVisible", false);
    preferences.setMeasurement("snapGuides", true);
    const restored = new PreferencesService();
    expect(restored.guidesLocked()).toBe(true);
    expect(restored.guidesVisible()).toBe(false);
    expect(restored.snapGuides()).toBe(true);
  });
  it("loads older settings as unlocked and rejects failed persistence atomically", () => {
    const preferences = new PreferencesService();
    preferences.setMeasurement("guidesLocked", true);
    const saved = JSON.parse(localStorage.getItem("xds-input-settings")!);
    delete saved.measurements.guidesLocked;
    localStorage.setItem("xds-input-settings", JSON.stringify(saved));
    expect(new PreferencesService().guidesLocked()).toBe(false);
    const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    try {
      expect(preferences.setMeasurement("guidesLocked", false)).toBe(false);
      expect(preferences.guidesLocked()).toBe(true);
    } finally { storage.mockRestore(); }
  });
});
