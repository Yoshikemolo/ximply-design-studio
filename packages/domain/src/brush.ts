import type { Point } from './document';
import { Blend, BLENDS } from './document';

/** Tip shapes offered as brush subtools; the eraser uses the same shapes. */
export type BrushType = 'round' | 'flat' | 'calligraphy' | 'marker' | 'airbrush' | 'pencil';
export const BRUSH_TYPES: BrushType[] = ['round', 'flat', 'calligraphy', 'marker', 'airbrush', 'pencil'];
export interface BrushSettings {
  type: BrushType;
  /** Share of the nominal size the tip actually paints, as a percentage. */
  pressure: number;
  /** Paint opacity of each stamp, as a percentage. */
  opacity: number;
  /** Distance between stamps as a percentage of the tip size; smaller is denser. */
  cadence: number;
  blend: Blend;
  /** Soft edge of the tip, as a percentage of its radius. */
  diffusion: number;
  /** Thin the stroke as the pointer moves faster. */
  speedVariation: boolean;
  /** Tip orientation in degrees; round tips ignore it. */
  angle: number;
}
/** Proportions of each tip: how wide it is across the stroke and how opaque it paints. */
const TIP: Record<BrushType, { ratio: number; alpha: number; diffusion: number }> = {
  round: { ratio: 1, alpha: 1, diffusion: 0 },
  flat: { ratio: 0.3, alpha: 1, diffusion: 0 },
  calligraphy: { ratio: 0.16, alpha: 1, diffusion: 0 },
  marker: { ratio: 0.8, alpha: 0.65, diffusion: 0.1 },
  airbrush: { ratio: 1, alpha: 0.35, diffusion: 0.8 },
  pencil: { ratio: 0.75, alpha: 0.85, diffusion: 0.05 },
};
export const defaultBrush: BrushSettings = {
  type: 'round', pressure: 100, opacity: 100, cadence: 25, blend: 'source-over', diffusion: 0, speedVariation: false, angle: 0,
};
export function validBrushSettings(value: unknown): value is BrushSettings {
  const v = value as BrushSettings;
  const percentage = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  return !!v && typeof v === 'object'
    && BRUSH_TYPES.includes(v.type)
    && percentage(v.pressure) && v.pressure >= 1
    && percentage(v.opacity) && percentage(v.diffusion)
    && typeof v.cadence === 'number' && v.cadence >= 1 && v.cadence <= 100
    && (BLENDS as readonly string[]).includes(v.blend)
    && typeof v.speedVariation === 'boolean'
    && typeof v.angle === 'number' && Number.isFinite(v.angle) && v.angle >= 0 && v.angle <= 180;
}

export interface BrushStamp { center: Point; radiusX: number; radiusY: number; angle: number; alpha: number; blur: number }
/**
 * Stamps laid along one segment. `speed` is the distance the pointer travelled for this
 * segment, which thins the stroke when speed variation is on.
 */
export function brushStamps(from: Point, to: Point, size: number, settings: BrushSettings, speed = 0): BrushStamp[] {
  if (!(size > 0) || !validBrushSettings(settings)) return [];
  const tip = TIP[settings.type];
  const pressure = settings.pressure / 100;
  const thinning = settings.speedVariation ? Math.max(0.35, 1 - Math.min(1, speed / (size * 4)) * 0.65) : 1;
  const radius = Math.max(0.5, (size / 2) * pressure * thinning);
  const radiusY = Math.max(0.25, radius * tip.ratio);
  const alpha = Math.max(0, Math.min(1, (settings.opacity / 100) * tip.alpha));
  const blur = Math.max(0, radius * Math.max(settings.diffusion / 100, tip.diffusion));
  const spacing = Math.max(0.5, radius * 2 * (settings.cadence / 100));
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  const steps = Math.min(512, Math.max(1, Math.ceil(length / spacing)));
  const angle = settings.type === 'round' ? 0 : (settings.angle * Math.PI) / 180;
  const stamps: BrushStamp[] = [];
  for (let step = 1; step <= steps; step++) {
    const t = length ? step / steps : 1;
    stamps.push({ center: { x: from.x + dx * t, y: from.y + dy * t }, radiusX: radius, radiusY, angle, alpha, blur });
  }
  return stamps;
}
/** A sinuous sample stroke used by the brush preview, in a box of the given size. */
export function previewStroke(width: number, height: number, points = 48): Point[] {
  const path: Point[] = [];
  for (let index = 0; index <= points; index++) {
    const t = index / points;
    path.push({ x: t * width, y: height / 2 + Math.sin(t * Math.PI * 2) * (height / 3.2) });
  }
  return path;
}
