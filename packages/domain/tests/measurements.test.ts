import { describe, expect, it } from "vitest";
import { formatMeasurement, fromPixels, measurementUnits, rulerTicks, snapPoint, SnapConfig, toPixels } from "../src/measurements";
const config = (): SnapConfig => ({ zoom: 1, rulers: { enabled: false, visible: true, step: 100, radius: 8 }, grid: { enabled: true, visible: true, step: 20, radius: 8 }, guides: { enabled: true, visible: true, radius: 8, items: [] } });
describe("measurement presentation and magnetic coordinates", () => {
  it("converts physical and typographic units with CSS pixel density", () => {
    expect(toPixels(25.4, "mm")).toBeCloseTo(96);
    expect(toPixels(72, "pt")).toBe(96);
    expect(fromPixels(1152, "ft")).toBe(1);
    expect(formatMeasurement(96, "cm")).toBe("2.54");
    for (const unit of measurementUnits) expect(fromPixels(toPixels(-12.75, unit), unit)).toBeCloseTo(-12.75);
    expect(() => toPixels(NaN, "px")).toThrow();
    expect(() => fromPixels(Infinity, "px")).toThrow();
  });
  it("keeps tick labels in display units and limits pathological tick counts", () => {
    expect(rulerTicks(192, 1, "in", 96)).toEqual([
      { position: 0, label: "0", major: true }, { position: 96, label: "1", major: true }, { position: 192, label: "2", major: true },
    ]);
    expect(rulerTicks(Number.MAX_VALUE, Number.MIN_VALUE, "px", Number.MIN_VALUE)).toEqual([{ position: 0, label: "0", major: true }]);
    expect(rulerTicks(100000, 1000, "px", 0.01).length).toBeLessThanOrEqual(1000);
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(rulerTicks(100, 1, "px", bad)).toEqual([]);
      expect(rulerTicks(100, bad, "px", 20)).toEqual([]);
    }
  });
  it("snaps each axis to its closest source and keeps radius constant on screen", () => {
    const c = config();
    c.guides.items = [{ axis: "x", position: 24 }];
    expect(snapPoint({ x: 23, y: 37 }, c)).toEqual({ x: 24, y: 40 });
    c.zoom = 4;
    expect(snapPoint({ x: 23, y: 37 }, c)).toEqual({ x: 24, y: 37 });
    c.guides.visible = false;
    expect(snapPoint({ x: 23, y: 37 }, c)).toEqual({ x: 23, y: 37 });
    c.zoom = 1;
    c.grid.visible = false;
    c.rulers.enabled = true;
    expect(snapPoint({ x: 96, y: 197 }, c)).toEqual({ x: 100, y: 200 });
  });
  it("ignores invalid snap configuration and preserves additional point metadata", () => {
    const c = config();
    c.grid.step = 0;
    c.guides.items = [{ axis: "x", position: Infinity }];
    expect(snapPoint({ x: -2, y: 2, id: "point" }, c)).toEqual({ x: -2, y: 2, id: "point" });
    c.zoom = NaN;
    expect(snapPoint({ x: 2, y: 3 }, c)).toEqual({ x: 2, y: 3 });
  });
});
