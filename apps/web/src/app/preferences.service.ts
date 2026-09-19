import { Injectable, signal } from "@angular/core";
import {
  defaultShortcuts,
  ShortcutMap,
  validateShortcuts,
} from "../../../../packages/domain/src/shortcuts";
import { isUnit, Unit } from "../../../../packages/domain/src/measurements";
export interface MeasurementSettings {
  distanceUnit: Unit;
  fontUnit: Unit;
  rulersVisible: boolean;
  guidesVisible: boolean;
  gridVisible: boolean;
  snapRulers: boolean;
  snapGuides: boolean;
  snapGrid: boolean;
  rulerStep: number;
  gridSize: number;
  rulerSnapRadius: number;
  guideSnapRadius: number;
  gridSnapRadius: number;
}
export type LayoutBlock = "appearance" | "workspace" | "measurement";
const measurementDefaults: MeasurementSettings = {
  distanceUnit: "px", fontUnit: "px", rulersVisible: false, guidesVisible: true,
  gridVisible: false, snapRulers: false, snapGuides: false, snapGrid: false,
  rulerStep: 100, gridSize: 20, rulerSnapRadius: 8, guideSnapRadius: 8, gridSnapRadius: 8,
};
function validateMeasurement<K extends keyof MeasurementSettings>(key: K, value: unknown): void {
  if (!Object.hasOwn(measurementDefaults, key)) throw new Error("Invalid measurement setting");
  if (key === "distanceUnit" || key === "fontUnit") {
    if (!isUnit(value)) throw new Error("Invalid measurement unit");
  } else if (typeof measurementDefaults[key] === "boolean") {
    if (typeof value !== "boolean") throw new Error("Invalid visibility or snapping setting");
  } else if (typeof value !== "number" || !Number.isFinite(value) || value < (key.endsWith("Radius") ? 0 : 0.01) || value > 100000) {
    throw new Error("Measurement must be finite and within range");
  }
}
@Injectable({ providedIn: "root" })
export class PreferencesService {
  readonly bindings = signal<ShortcutMap>(defaultShortcuts());
  readonly cursorIcon = signal(true);
  readonly cursorAxes = signal(true);
  readonly snapAngle = signal(45);
  readonly error = signal("");
  readonly distanceUnit = signal<Unit>(measurementDefaults.distanceUnit);
  readonly fontUnit = signal<Unit>(measurementDefaults.fontUnit);
  readonly rulersVisible = signal(measurementDefaults.rulersVisible);
  readonly guidesVisible = signal(measurementDefaults.guidesVisible);
  readonly gridVisible = signal(measurementDefaults.gridVisible);
  readonly snapRulers = signal(measurementDefaults.snapRulers);
  readonly snapGuides = signal(measurementDefaults.snapGuides);
  readonly snapGrid = signal(measurementDefaults.snapGrid);
  readonly rulerStep = signal(measurementDefaults.rulerStep);
  readonly gridSize = signal(measurementDefaults.gridSize);
  readonly rulerSnapRadius = signal(measurementDefaults.rulerSnapRadius);
  readonly guideSnapRadius = signal(measurementDefaults.guideSnapRadius);
  readonly gridSnapRadius = signal(measurementDefaults.gridSnapRadius);
  readonly layoutBlocks = signal<Record<LayoutBlock, boolean>>({ appearance: true, workspace: true, measurement: true });
  constructor() {
    try {
      const raw = localStorage.getItem("xds-input-settings");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || typeof saved.cursorIcon !== "boolean")
          throw new Error("Invalid shortcut settings");
        const measurements = { ...measurementDefaults, ...saved.measurements };
        for (const key of Object.keys(measurements) as (keyof MeasurementSettings)[]) validateMeasurement(key, measurements[key]);
        const layout = saved.layoutBlocks ?? this.layoutBlocks();
        for (const key of ["appearance", "workspace", "measurement"] as const)
          if (typeof layout[key] !== "boolean") throw new Error("Invalid layout settings");
        this.bindings.set(validateShortcuts(saved.bindings));
        this.cursorIcon.set(saved.cursorIcon);
        if (
          saved.cursorAxes !== undefined &&
          typeof saved.cursorAxes !== "boolean"
        )
          throw new Error("Invalid cursor axes setting");
        this.cursorAxes.set(saved.cursorAxes ?? true);
        if (saved.snapAngle !== undefined) {
          if (
            !Number.isFinite(saved.snapAngle) ||
            saved.snapAngle < 1 ||
            saved.snapAngle > 90
          )
            throw new Error("Invalid snap angle");
          this.snapAngle.set(saved.snapAngle);
        }
        for (const key of Object.keys(measurementDefaults) as (keyof MeasurementSettings)[]) this.applyMeasurement(key, measurements[key]);
        this.layoutBlocks.set(layout);
      }
    } catch {
      this.bindings.set(defaultShortcuts());
      this.cursorIcon.set(true);
      this.cursorAxes.set(true);
      this.snapAngle.set(45);
      this.error.set("Invalid saved settings. Defaults restored.");
    }
  }
  assign(id: string, keys: string[]): boolean {
    try {
      const next = validateShortcuts({ ...this.bindings(), [id]: keys });
      this.persist(next, this.cursorIcon());
      this.bindings.set(next);
      this.error.set("");
      return true;
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : "Invalid shortcut",
      );
      return false;
    }
  }
  toggleCursor(enabled: boolean) {
    try {
      this.persist(this.bindings(), enabled);
      this.cursorIcon.set(enabled);
      this.error.set("");
    } catch {
      this.error.set("Settings could not be saved.");
    }
  }
  toggleCursorAxes(enabled: boolean) {
    try {
      this.persist(this.bindings(), this.cursorIcon(), this.snapAngle(), enabled);
      this.cursorAxes.set(enabled);
      this.error.set("");
    } catch {
      this.error.set("Settings could not be saved.");
    }
  }
  reset() {
    try {
      const bindings = validateShortcuts(defaultShortcuts());
      this.persist(bindings, this.cursorIcon());
      this.bindings.set(bindings);
      this.error.set("");
    } catch {
      this.error.set("Settings could not be saved.");
    }
  }
  setSnapAngle(angle: number) {
    if (!Number.isFinite(angle) || angle < 1 || angle > 90) {
      this.error.set("Angle must be between 1 and 90 degrees.");
      return;
    }
    try {
      this.persist(this.bindings(), this.cursorIcon(), angle);
      this.snapAngle.set(angle);
      this.error.set("");
    } catch {
      this.error.set("Settings could not be saved.");
    }
  }
  private measurements(): MeasurementSettings {
    return Object.fromEntries(Object.keys(measurementDefaults).map(key => [key, this[key as keyof MeasurementSettings]()])) as unknown as MeasurementSettings;
  }
  private applyMeasurement<K extends keyof MeasurementSettings>(key: K, value: MeasurementSettings[K]) {
    (this[key] as { set(value: MeasurementSettings[K]): void }).set(value);
  }
  setMeasurement<K extends keyof MeasurementSettings>(key: K, value: MeasurementSettings[K]): boolean {
    try {
      validateMeasurement(key, value);
      this.persistExtended({ ...this.measurements(), [key]: value }, this.layoutBlocks());
      this.applyMeasurement(key, value);
      this.error.set("");
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : "Settings could not be saved.");
      return false;
    }
  }
  toggleLayoutBlock(key: LayoutBlock): boolean {
    if (!["appearance", "workspace", "measurement"].includes(key)) return false;
    try {
      const next = { ...this.layoutBlocks(), [key]: !this.layoutBlocks()[key] };
      this.persistExtended(this.measurements(), next);
      this.layoutBlocks.set(next);
      this.error.set("");
      return true;
    } catch {
      this.error.set("Settings could not be saved.");
      return false;
    }
  }
  private persistExtended(measurements: MeasurementSettings, layoutBlocks: Record<LayoutBlock, boolean>) {
    localStorage.setItem("xds-input-settings", JSON.stringify({
      version: 1, bindings: this.bindings(), cursorIcon: this.cursorIcon(), cursorAxes: this.cursorAxes(),
      snapAngle: this.snapAngle(), measurements, layoutBlocks,
    }));
  }
  private persist(
    bindings: ShortcutMap,
    cursorIcon: boolean,
    snapAngle = this.snapAngle(),
    cursorAxes = this.cursorAxes(),
  ) {
    localStorage.setItem(
      "xds-input-settings",
      JSON.stringify({ version: 1, bindings, cursorIcon, snapAngle, cursorAxes, measurements: this.measurements(), layoutBlocks: this.layoutBlocks() }),
    );
  }
}
