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
  it("renders independent minor divisions as short unlabelled ticks, preserving major coincidences", () => {
    const ticks = rulerTicks(200, 1, "px", 100, 10);
    expect(ticks).toHaveLength(21);
    expect(ticks.filter(tick => tick.major).map(tick => tick.position)).toEqual([0, 100, 200]);
    expect(ticks.find(tick => tick.position === 10)).toEqual({ position: 10, label: "", major: false });
    expect(ticks.find(tick => tick.position === 100)?.label).toBe("100");
    const independent = rulerTicks(120, 1, "px", 60, 25);
    expect(independent.map(tick => tick.position)).toEqual([0, 25, 50, 60, 75, 100, 120]);
    expect(rulerTicks(1e7, 1000, "mm", .01, .001).length).toBeLessThanOrEqual(1000);
    expect(rulerTicks(Number.MAX_VALUE, Number.MIN_VALUE, "px", Number.MIN_VALUE, Number.MIN_VALUE)).toEqual([{ position: 0, label: "0", major: true }]);
  });
  it("marks the minor tick half way between two major ones, to be drawn longer", () => {
    // Major every 100 and minor every 10: the minor ticks at 50 and 150 are the half marks.
    const ticks = rulerTicks(200, 1, "px", 100, 10);
    expect(ticks.filter(tick => tick.half).map(tick => tick.position)).toEqual([50, 150]);
    expect(ticks.find(tick => tick.position === 50)).toEqual({ position: 50, label: "", major: false, half: true });
    expect(ticks.find(tick => tick.position === 100)?.half).toBeUndefined();
    // Only a minor tick that falls half way is marked: every 30, 150 is one but 50 is not a tick.
    expect(rulerTicks(200, 1, "px", 100, 30).filter(tick => tick.half).map(tick => tick.position)).toEqual([150]);
    expect(rulerTicks(200, 1, "px", 100, 40).some(tick => tick.half)).toBe(false);
    // Without minor ticks there is no half mark either.
    expect(rulerTicks(200, 1, "px", 100).some(tick => tick.half)).toBe(false);
  });
  it("selects ruler snap intervals independently under the global magnetic switch", () => {
    const c = config(); c.grid.enabled = false; c.guides.enabled = false;
    c.rulers = { enabled: true, visible: true, step: 100, minorStep: 10, radius: 8, majorEnabled: true, minorEnabled: false };
    expect(snapPoint({ x: 23, y: 96 }, c)).toEqual({ x: 23, y: 100 });
    c.rulers.majorEnabled = false; c.rulers.minorEnabled = true;
    expect(snapPoint({ x: 23, y: 96 }, c)).toEqual({ x: 20, y: 100 });
    c.rulers.majorEnabled = true; c.rulers.minorStep = 30;
    expect(snapPoint({ x: 94, y: 98 }, c)).toEqual({ x: 90, y: 100 });
    c.rulers.majorEnabled = false; c.rulers.minorEnabled = false;
    expect(snapPoint({ x: 94, y: 98 }, c)).toEqual({ x: 94, y: 98 });
    c.rulers.minorEnabled = true; c.rulers.enabled = false;
    expect(snapPoint({ x: 94, y: 98 }, c)).toEqual({ x: 94, y: 98 });
    c.rulers.enabled = true; c.rulers.visible = false;
    expect(snapPoint({ x: 94, y: 98 }, c)).toEqual({ x: 94, y: 98 });
  });
  it("keeps fine interval snapping independent of zoom display thinning and validates minor intervals", () => {
    const c = config(); c.grid.enabled = false; c.guides.enabled = false;
    c.rulers = { enabled: true, visible: true, step: 100, minorStep: 1, radius: 8, majorEnabled: false, minorEnabled: true };
    c.zoom = .01;
    expect(rulerTicks(1000, c.zoom, "px", 100, 1).some(tick => tick.position === 11)).toBe(false);
    expect(snapPoint({ x: 10.8, y: -12.4 }, c)).toEqual({ x: 11, y: -12 });
    for (const minorStep of [0, -1, Infinity, NaN]) {
      c.rulers.minorStep = minorStep;
      expect(snapPoint({ x: 10.8, y: -12.4 }, c)).toEqual({ x: 10.8, y: -12.4 });
    }
  });

});
