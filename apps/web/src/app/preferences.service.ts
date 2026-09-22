import { Injectable, signal } from "@angular/core";
import {
  defaultShortcuts,
  ShortcutMap,
  validateShortcuts,
} from "../../../../packages/domain/src/shortcuts";
import { isUnit, Unit } from "../../../../packages/domain/src/measurements";
import { COLOR_MODES, ColorMode } from "../../../../packages/domain/src/paint";

const COLOR_SETTINGS = "xds-color-settings";
export const MAX_PALETTE_COLORS = 64;
/** The colour model and the custom palette, kept apart from the input settings. */
function readColorSettings(): { mode: ColorMode; palette: string[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOR_SETTINGS) ?? "null");
    if (saved?.version !== 1 || !COLOR_MODES.includes(saved.mode) || !Array.isArray(saved.palette)) throw new Error("Invalid colour settings");
    const palette = saved.palette.filter((color: unknown): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color));
    return { mode: saved.mode, palette: [...new Set<string>(palette)].slice(0, MAX_PALETTE_COLORS) };
  } catch {
    return { mode: "quick", palette: [] };
  }
}
import { FreehandOptions, FreehandToolOptions, PAINTBRUSH_DEFAULTS, PENCIL_DEFAULTS, SMOOTH_DEFAULTS, validFreehandTool } from "../../../../packages/domain/src/path-fit";
import { BrushStroke, DEFAULT_BRUSH_STROKE, validBrushStroke } from "../../../../packages/domain/src/brush-stroke";

/**
 * The settings of drawing and editing paths: the option dialogs of the Pencil, the
 * Paintbrush and the Smooth tool, the brush the Paintbrush applies, whether the Pen adds
 * and deletes anchors by itself, and how anchors and handles are displayed.
 */
export interface PathSettings {
  pencil: FreehandToolOptions;
  paintbrush: FreehandToolOptions;
  smooth: FreehandOptions;
  brush: BrushStroke;
  autoAddDelete: boolean;
  anchorDisplay: "small" | "mixed" | "large";
  handleStyle: "small" | "large" | "cross";
  showHandlesMultiple: boolean;
  highlightAnchors: boolean;
  /** The Eraser's nib: angle in degrees, roundness in percent and diameter in pixels. */
  eraser: { angle: number; roundness: number; diameter: number };
}
export const PATH_SETTINGS_DEFAULTS: PathSettings = {
  pencil: { ...PENCIL_DEFAULTS },
  paintbrush: { ...PAINTBRUSH_DEFAULTS },
  smooth: { ...SMOOTH_DEFAULTS },
  brush: { ...DEFAULT_BRUSH_STROKE },
  autoAddDelete: true,
  anchorDisplay: "mixed",
  handleStyle: "small",
  showHandlesMultiple: true,
  highlightAnchors: true,
  eraser: { angle: 0, roundness: 100, diameter: 10 },
};
/** Reads stored path settings, keeping the default for anything missing or invalid. */
export function validPathSettings(value: unknown): PathSettings {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const smooth = validFreehandTool({ ...PENCIL_DEFAULTS, ...(input["smooth"] as object) }, { ...PENCIL_DEFAULTS, ...SMOOTH_DEFAULTS });
  return {
    pencil: validFreehandTool(input["pencil"], PENCIL_DEFAULTS),
    paintbrush: validFreehandTool(input["paintbrush"], PAINTBRUSH_DEFAULTS),
    smooth: { fidelity: smooth.fidelity, smoothness: smooth.smoothness },
    brush: validBrushStroke(input["brush"]) ? { ...(input["brush"] as BrushStroke) } : { ...DEFAULT_BRUSH_STROKE },
    autoAddDelete: typeof input["autoAddDelete"] === "boolean" ? input["autoAddDelete"] : true,
    anchorDisplay: pick(input["anchorDisplay"], ["small", "mixed", "large"] as const, "mixed"),
    handleStyle: pick(input["handleStyle"], ["small", "large", "cross"] as const, "small"),
    showHandlesMultiple: typeof input["showHandlesMultiple"] === "boolean" ? input["showHandlesMultiple"] : true,
    highlightAnchors: typeof input["highlightAnchors"] === "boolean" ? input["highlightAnchors"] : true,
    eraser: validBrushStroke({ kind: "calligraphic", ...(input["eraser"] as object) }) && (input["eraser"] as { diameter: number }).diameter >= 1
      ? (({ angle, roundness, diameter }) => ({ angle, roundness, diameter }))(input["eraser"] as { angle: number; roundness: number; diameter: number })
      : { angle: 0, roundness: 100, diameter: 10 },
  };
}
const PATH_SETTINGS_KEY = "xds-path-settings";
export type AreaSelectionMode = "rectangle" | "ellipse" | "lasso";
export interface MeasurementSettings {
  distanceUnit: Unit;
  fontUnit: Unit;
  /** Decimal places used to display measurements; stored values keep their precision. */
  displayDecimals: number;
  rulersVisible: boolean;
  guidesVisible: boolean;
  guidesLocked: boolean;
  gridVisible: boolean;
  snapRulers: boolean;
  snapGuides: boolean;
  snapGrid: boolean;
  rulerStep: number;
  rulerMinorStep: number;
  snapRulerMajor: boolean;
  snapRulerMinor: boolean;
  dimensionsVisible: boolean;
  /** Show a checkerboard behind transparent areas, and the size of its squares. */
  transparencyChecker: boolean;
  transparencyCheckerSize: number;
  /** Area selection takes touched objects or only enclosed ones. */
  areaSelectionMode: "intersect" | "inside";
  pivotVisible: boolean;
  pivotLocked: boolean;
  pivotSnap: boolean;
  dimensionsLocked: boolean;
  dimensionsSnap: boolean;
  dimensionSnapRadius: number;
  gridSize: number;
  rulerSnapRadius: number;
  guideSnapRadius: number;
  gridSnapRadius: number;
}
export type LayoutBlock = "tools" | "appearance" | "workspace" | "measurement" | "dimensions" | "pivot" | "selection" | "swatches" | "contextBar";
const measurementDefaults: MeasurementSettings = {
  distanceUnit: "px", fontUnit: "px", displayDecimals: 2, rulersVisible: false, guidesVisible: true, guidesLocked: false,
  gridVisible: false, snapRulers: false, snapGuides: false, snapGrid: false,
  dimensionsVisible: true, dimensionsLocked: false, dimensionsSnap: true, dimensionSnapRadius: 8,
  pivotVisible: true, pivotLocked: false, pivotSnap: true, areaSelectionMode: "intersect",
  transparencyChecker: true, transparencyCheckerSize: 8,
  rulerMinorStep: 10, snapRulerMajor: true, snapRulerMinor: false,
  rulerStep: 100, gridSize: 20, rulerSnapRadius: 8, guideSnapRadius: 8, gridSnapRadius: 8,
};
function validateMeasurement<K extends keyof MeasurementSettings>(key: K, value: unknown): void {
  if (!Object.hasOwn(measurementDefaults, key)) throw new Error("Invalid measurement setting");
  if (key === "transparencyCheckerSize") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > 64) throw new Error("Checker size must be a whole number between 2 and 64 pixels");
  } else if (key === "areaSelectionMode") {
    if (value !== "intersect" && value !== "inside") throw new Error("Invalid area selection mode");
  } else if (key === "distanceUnit" || key === "fontUnit") {
    if (!isUnit(value)) throw new Error("Invalid measurement unit");
  } else if (typeof measurementDefaults[key] === "boolean") {
    if (typeof value !== "boolean") throw new Error("Invalid visibility or snapping setting");
  } else if (key === "displayDecimals") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 8) throw new Error("Decimal places must be a whole number between 0 and 8");
  } else if (typeof value !== "number" || !Number.isFinite(value) || value < (key.endsWith("Radius") ? 0 : 0.01) || value > 100000) {
    throw new Error("Measurement must be finite and within range");
  }
}
@Injectable({ providedIn: "root" })
export class PreferencesService {
  readonly bindings = signal<ShortcutMap>(defaultShortcuts());
  readonly lastAreaSelection = signal<AreaSelectionMode>("rectangle");
  readonly cursorIcon = signal(true);
  readonly cursorAxes = signal(true);
  readonly snapAngle = signal(45);
  readonly error = signal("");
  readonly distanceUnit = signal<Unit>(measurementDefaults.distanceUnit);
  readonly displayDecimals = signal(measurementDefaults.displayDecimals);
  readonly areaSelectionMode = signal(measurementDefaults.areaSelectionMode);
  readonly transparencyChecker = signal(measurementDefaults.transparencyChecker);
  readonly transparencyCheckerSize = signal(measurementDefaults.transparencyCheckerSize);
  readonly pivotVisible = signal(measurementDefaults.pivotVisible);
  readonly pivotLocked = signal(measurementDefaults.pivotLocked);
  readonly pivotSnap = signal(measurementDefaults.pivotSnap);
  readonly fontUnit = signal<Unit>(measurementDefaults.fontUnit);
  readonly rulersVisible = signal(measurementDefaults.rulersVisible);
  readonly guidesVisible = signal(measurementDefaults.guidesVisible);
  readonly guidesLocked = signal(measurementDefaults.guidesLocked);
  readonly gridVisible = signal(measurementDefaults.gridVisible);
  readonly snapRulers = signal(measurementDefaults.snapRulers);
  readonly snapGuides = signal(measurementDefaults.snapGuides);
  readonly snapGrid = signal(measurementDefaults.snapGrid);
  readonly rulerMinorStep = signal(measurementDefaults.rulerMinorStep);
  readonly snapRulerMajor = signal(measurementDefaults.snapRulerMajor);
  readonly snapRulerMinor = signal(measurementDefaults.snapRulerMinor);
  readonly dimensionsVisible = signal(measurementDefaults.dimensionsVisible);
  readonly dimensionsLocked = signal(measurementDefaults.dimensionsLocked);
  readonly dimensionsSnap = signal(measurementDefaults.dimensionsSnap);
  readonly dimensionSnapRadius = signal(measurementDefaults.dimensionSnapRadius);
  readonly rulerStep = signal(measurementDefaults.rulerStep);
  readonly gridSize = signal(measurementDefaults.gridSize);
  readonly rulerSnapRadius = signal(measurementDefaults.rulerSnapRadius);
  readonly guideSnapRadius = signal(measurementDefaults.guideSnapRadius);
  readonly gridSnapRadius = signal(measurementDefaults.gridSnapRadius);
  readonly pathSettings = signal<PathSettings>(PreferencesService.loadPathSettings());
  private static loadPathSettings(): PathSettings {
    try { return validPathSettings(JSON.parse(localStorage.getItem(PATH_SETTINGS_KEY) ?? "{}")); }
    catch { return structuredClone(PATH_SETTINGS_DEFAULTS); }
  }
  /** Changes some of the path settings and keeps them for the next session. */
  updatePathSettings(change: Partial<PathSettings>): boolean {
    const next = validPathSettings({ ...this.pathSettings(), ...change });
    try {
      localStorage.setItem(PATH_SETTINGS_KEY, JSON.stringify(next));
      this.pathSettings.set(next);
      this.error.set("");
      return true;
    } catch {
      this.error.set("Settings could not be saved.");
      return false;
    }
  }
  /** Keeps the options the tool dialogs set. */
  saveToolOptions(options: Pick<PathSettings, "pencil" | "paintbrush" | "smooth" | "brush">): boolean {
    return this.updatePathSettings(options);
  }
  readonly layoutBlocks = signal<Record<LayoutBlock, boolean>>({ tools: true, appearance: true, workspace: true, measurement: true, dimensions: true, pivot: true, selection: true, swatches: false, contextBar: true });
  /** How colours are chosen: Quick RGB by default, or RGB, CMYK, Grayscale or a custom palette. */
  readonly colorMode = signal<ColorMode>(readColorSettings().mode);
  readonly customPalette = signal<string[]>(readColorSettings().palette);
  setColorMode(mode: string): boolean {
    if (!COLOR_MODES.includes(mode as ColorMode)) return false;
    this.colorMode.set(mode as ColorMode);
    return this.persistColor();
  }
  addPaletteColor(color: string): boolean {
    const hex = color.slice(0, 7).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex) || this.customPalette().includes(hex) || this.customPalette().length >= MAX_PALETTE_COLORS) return false;
    this.customPalette.set([...this.customPalette(), hex]);
    return this.persistColor();
  }
  removePaletteColor(color: string): boolean {
    if (!this.customPalette().includes(color)) return false;
    this.customPalette.set(this.customPalette().filter((c) => c !== color));
    return this.persistColor();
  }
  private persistColor(): boolean {
    try {
      localStorage.setItem(COLOR_SETTINGS, JSON.stringify({ version: 1, mode: this.colorMode(), palette: this.customPalette() }));
      return true;
    } catch {
      this.error.set("Settings could not be saved.");
      return false;
    }
  }
  constructor() {
    try {
      const raw = localStorage.getItem("xds-input-settings");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || typeof saved.cursorIcon !== "boolean")
          throw new Error("Invalid shortcut settings");
        if (saved.lastAreaSelection !== undefined && !["rectangle", "ellipse", "lasso"].includes(saved.lastAreaSelection)) throw new Error("Invalid selection mode");
        this.lastAreaSelection.set(saved.lastAreaSelection ?? "rectangle");
        const measurements = { ...measurementDefaults, ...saved.measurements };
        if (saved.measurements?.rulerMinorStep === undefined) measurements.rulerMinorStep = Math.max(0.01, measurements.rulerStep / 10);
        for (const key of Object.keys(measurements) as (keyof MeasurementSettings)[]) validateMeasurement(key, measurements[key]);
        const layout = { ...this.layoutBlocks(), ...saved.layoutBlocks };
        for (const key of ["appearance", "workspace", "measurement", "dimensions", "swatches", "contextBar"] as const)
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
      this.lastAreaSelection.set("rectangle");
      this.bindings.set(defaultShortcuts());
      this.cursorIcon.set(true);
      this.cursorAxes.set(true);
      this.snapAngle.set(45);
      this.error.set("Invalid saved settings. Defaults restored.");
    }
  }
  setAreaSelection(mode: AreaSelectionMode): boolean {
    if (!["rectangle", "ellipse", "lasso"].includes(mode)) return false;
    const previous = this.lastAreaSelection();
    try {
      this.lastAreaSelection.set(mode);
      this.persist(this.bindings(), this.cursorIcon());
      this.error.set("");
      return true;
    } catch {
      this.lastAreaSelection.set(previous);
      this.error.set("Settings could not be saved.");
      return false;
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
    // Every block the settings carry can be shown or hidden; a name they do not carry cannot.
    if (!Object.prototype.hasOwnProperty.call(this.layoutBlocks(), key)) return false;
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
      version: 1, lastAreaSelection: this.lastAreaSelection(), bindings: this.bindings(), cursorIcon: this.cursorIcon(), cursorAxes: this.cursorAxes(),
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
      JSON.stringify({ version: 1, lastAreaSelection: this.lastAreaSelection(), bindings, cursorIcon, snapAngle, cursorAxes, measurements: this.measurements(), layoutBlocks: this.layoutBlocks() }),
    );
  }
}
