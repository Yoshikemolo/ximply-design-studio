import type { Layer, Point } from './document';

/**
 * Duplication in series. The geometry of every copy is decided here as a step away from the
 * original: how far it moves, how much it turns and how much it grows. The editor applies
 * those steps to clones of the selection, so the rules stay testable on their own.
 */
export type ArrayMode = 'linear' | 'circular' | 'grid';
export interface ArraySettings {
  mode: ArrayMode;
  /** Copies made besides the original, for the linear and circular modes. */
  copies: number;
  /** Distance between consecutive copies of a linear series. */
  stepX: number;
  stepY: number;
  /** Turn added by each copy, in degrees, and relative size in percent. */
  rotation: number;
  scale: number;
  /** Angle the circular series covers, in degrees, measured around the pivot. */
  sweep: number;
  /** Whether the copies of a circular series turn with it or keep their own rotation. */
  orient: boolean;
  columns: number;
  rows: number;
  gapX: number;
  gapY: number;
}
export const DEFAULT_ARRAY: ArraySettings = {
  mode: 'linear', copies: 3, stepX: 40, stepY: 0, rotation: 0, scale: 100,
  sweep: 360, orient: true, columns: 3, rows: 3, gapX: 20, gapY: 20,
};
export interface CopyStep {
  /** Where the centre of the copy sits, relative to the centre of the original. */
  dx: number;
  dy: number;
  /** Turn of the copy in degrees and its size relative to the original. */
  rotation: number;
  scale: number;
}
const LIMITS = { copies: 200, grid: 40 };
export function validArraySettings(settings: ArraySettings): boolean {
  const finite = [settings.copies, settings.stepX, settings.stepY, settings.rotation, settings.scale,
    settings.sweep, settings.columns, settings.rows, settings.gapX, settings.gapY].every(Number.isFinite);
  if (!finite || settings.scale <= 0 || settings.scale > 1000) return false;
  if (settings.mode === 'grid') {
    return settings.columns >= 1 && settings.rows >= 1 && settings.columns <= LIMITS.grid
      && settings.rows <= LIMITS.grid && settings.columns * settings.rows <= LIMITS.copies + 1;
  }
  return settings.copies >= 1 && settings.copies <= LIMITS.copies && Math.abs(settings.sweep) <= 3600;
}
/**
 * The steps of a series. `pivot` and `centre` are the pivot of the transform and the centre
 * of the selection, which the circular mode turns around.
 */
export function arraySteps(settings: ArraySettings, pivot: Point, centre: Point): CopyStep[] {
  if (!validArraySettings(settings)) return [];
  const relative = settings.scale / 100;
  if (settings.mode === 'grid') {
    const steps: CopyStep[] = [];
    for (let row = 0; row < settings.rows; row++) {
      for (let column = 0; column < settings.columns; column++) {
        if (!row && !column) continue;
        const index = row * settings.columns + column;
        steps.push({
          dx: column * settings.gapX,
          dy: row * settings.gapY,
          rotation: settings.rotation * index,
          scale: Math.pow(relative, index),
        });
      }
    }
    return steps;
  }
  const steps: CopyStep[] = [];
  for (let index = 1; index <= settings.copies; index++) {
    if (settings.mode === 'linear') {
      steps.push({
        dx: settings.stepX * index,
        dy: settings.stepY * index,
        rotation: settings.rotation * index,
        scale: Math.pow(relative, index),
      });
      continue;
    }
    // A full turn shares the circle between the original and its copies; a partial one
    // spreads the copies across the angle it covers.
    const divisions = Math.abs(Math.abs(settings.sweep) - 360) < 1e-9 ? settings.copies + 1 : settings.copies;
    const angle = ((settings.sweep / divisions) * index * Math.PI) / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const offset = { x: centre.x - pivot.x, y: centre.y - pivot.y };
    steps.push({
      dx: offset.x * cos - offset.y * sin - offset.x,
      dy: offset.x * sin + offset.y * cos - offset.y,
      rotation: (settings.orient ? (settings.sweep / divisions) * index : 0) + settings.rotation * index,
      scale: Math.pow(relative, index),
    });
  }
  return steps;
}
/** The copy of a layer for one step of the series, turned and scaled about the given centre. */
export function copyLayer(layer: Layer, step: CopyStep, centre: Point, id: string): Layer {
  const radians = (step.rotation * Math.PI) / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const own = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
  const relative = { x: (own.x - centre.x) * step.scale, y: (own.y - centre.y) * step.scale };
  const placed = {
    x: centre.x + relative.x * cos - relative.y * sin + step.dx,
    y: centre.y + relative.x * sin + relative.y * cos + step.dy,
  };
  const width = Math.max(1, layer.width * step.scale), height = Math.max(1, layer.height * step.scale);
  return {
    ...structuredClone(layer),
    id,
    x: placed.x - width / 2,
    y: placed.y - height / 2,
    width,
    height,
    rotation: layer.rotation + step.rotation,
    regroupPath: undefined,
  };
}
