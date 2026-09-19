// @vitest-environment happy-dom
import "@angular/compiler";
import { beforeEach, describe, it, expect } from "vitest";
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
});
