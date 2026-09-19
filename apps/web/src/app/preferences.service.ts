import { Injectable, signal } from "@angular/core";
import {
  defaultShortcuts,
  ShortcutMap,
  validateShortcuts,
} from "../../../../packages/domain/src/shortcuts";
@Injectable({ providedIn: "root" })
export class PreferencesService {
  readonly bindings = signal<ShortcutMap>(defaultShortcuts());
  readonly cursorIcon = signal(true);
  readonly snapAngle = signal(45);
  readonly error = signal("");
  constructor() {
    try {
      const raw = localStorage.getItem("xds-input-settings");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || typeof saved.cursorIcon !== "boolean")
          throw new Error("Invalid shortcut settings");
        this.bindings.set(validateShortcuts(saved.bindings));
        this.cursorIcon.set(saved.cursorIcon);
        if (saved.snapAngle !== undefined) {
          if (
            !Number.isFinite(saved.snapAngle) ||
            saved.snapAngle < 1 ||
            saved.snapAngle > 90
          )
            throw new Error("Invalid snap angle");
          this.snapAngle.set(saved.snapAngle);
        }
      }
    } catch {
      this.bindings.set(defaultShortcuts());
      this.cursorIcon.set(true);
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
  private persist(
    bindings: ShortcutMap,
    cursorIcon: boolean,
    snapAngle = this.snapAngle(),
  ) {
    localStorage.setItem(
      "xds-input-settings",
      JSON.stringify({ version: 1, bindings, cursorIcon, snapAngle }),
    );
  }
}
