import { Layer, resizeLayer } from "./document";

type Box = Pick<Layer, "x" | "y" | "width" | "height">;

/** Apply a world-space selection stretch and rotation without losing child shear. */
export function transformLayers(
  layers: Layer[],
  source: Box,
  target: Box,
  rotationDelta = 0,
): Layer[] {
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  const angle = (rotationDelta * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  return layers.map((layer) => {
    const radians = (layer.rotation * Math.PI) / 180;
    const c = Math.cos(radians),
      s = Math.sin(radians);
    const shear = Math.tan(((layer.skewX ?? 0) * Math.PI) / 180);
    // Columns of diag(sx, sy) * rotation * shear. Rotation of the whole
    // selection is applied after decomposition; local reflections stay intact.
    const a = sx * c,
      b = sy * s;
    const c2 = sx * (c * shear - s),
      d = sy * (s * shear + c);
    const localX = Math.hypot(a, b);
    const localY = (sx * sy) / localX;
    const localShear = (a * c2 + b * d) / (localX * localY);
    const width = layer.width * localX,
      height = layer.height * localY;
    const dx = (layer.x + layer.width / 2 - source.x - source.width / 2) * sx;
    const dy = (layer.y + layer.height / 2 - source.y - source.height / 2) * sy;
    return {
      ...resizeLayer(layer, width, height),
      x: target.x + target.width / 2 + cosine * dx - sine * dy - width / 2,
      y: target.y + target.height / 2 + sine * dx + cosine * dy - height / 2,
      rotation: (Math.atan2(b, a) * 180) / Math.PI + rotationDelta,
      skewX: (Math.atan(localShear) * 180) / Math.PI,
    };
  });
}

/**
 * An affine map of the page: a point (x, y) goes to (a x + c y + e, b x + d y + f), in
 * page coordinates, whose y axis points down.
 */
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }
export type Linear = [a: number, b: number, c: number, d: number];

/** The map that applies a linear part about a fixed point. */
export function about(linear: Linear, point: { x: number; y: number }): Affine {
  const [a, b, c, d] = linear;
  return { a, b, c, d, e: point.x - a * point.x - c * point.y, f: point.y - b * point.x - d * point.y };
}
export function applyAffine(m: Affine, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}
export const scaleLinear = (sx: number, sy: number): Linear => [sx, 0, 0, sy];
/**
 * Illustrator's shear: the slant of `angle` degrees, clockwise, applied along an axis at
 * `axis` degrees from the horizontal, counterclockwise as the Shear dialog reads it. The
 * page's y axis points down, so the map is worked out upright and turned back.
 */
export function shearLinear(angle: number, axis = 0): Linear {
  const t = Math.tan((angle * Math.PI) / 180), r = (axis * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  // Upright: R(axis) · [[1, t], [0, 1]] · R(-axis), a clockwise slant of the lines across the axis.
  const m00 = 1 - t * cos * sin, m01 = t * cos * cos, m10 = -t * sin * sin, m11 = 1 + t * sin * cos;
  // With y pointing down, the off-diagonal terms change sign.
  return [m00, -m10, -m01, m11];
}

/**
 * Applies an affine map to layers and keeps each one of its kind: the map is decomposed on
 * every layer into a rotation, a shear along its own x axis and a new size, with a
 * reflection when the map turns the layer over. Strokes keep their weight unless
 * `scaleStrokes` is set, when they grow with the square root of the change of area, as
 * Scale Strokes & Effects does.
 */
export function affineLayers(layers: Layer[], m: Affine, options: { scaleStrokes?: boolean } = {}): Layer[] {
  const area = Math.abs(m.a * m.d - m.b * m.c);
  return layers.map((layer) => {
    const r = (layer.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const k = Math.tan(((layer.skewX ?? 0) * Math.PI) / 180);
    // The columns of rotation · shear, the directions of the layer's own axes on the page.
    const col1 = { x: cos, y: sin }, col2 = { x: k * cos - sin, y: k * sin + cos };
    const u = { x: m.a * col1.x + m.c * col1.y, y: m.b * col1.x + m.d * col1.y };
    let v = { x: m.a * col2.x + m.c * col2.y, y: m.b * col2.x + m.d * col2.y };
    const turned = u.x * v.y - u.y * v.x < 0;
    if (turned) v = { x: -v.x, y: -v.y };
    const sx = Math.hypot(u.x, u.y);
    const angle = Math.atan2(u.y, u.x), ca = Math.cos(angle), sa = Math.sin(angle);
    const qx = ca * v.x + sa * v.y, qy = -sa * v.x + ca * v.y;
    const sy = qy, shear = qx / qy;
    const width = Math.max(1e-3, layer.width * sx), height = Math.max(1e-3, layer.height * sy);
    const centre = applyAffine(m, { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 });
    const skew = Math.max(-89.9999, Math.min(89.9999, (Math.atan(shear) * 180) / Math.PI));
    const rotation = (angle * 180) / Math.PI;
    return {
      ...resizeLayer(layer, width, height),
      x: centre.x - width / 2,
      y: centre.y - height / 2,
      rotation: Math.round(rotation * 1e9) / 1e9,
      skewX: Math.abs(skew) < 1e-9 ? 0 : skew,
      ...(turned ? { flipY: !layer.flipY } : {}),
      ...(options.scaleStrokes ? { strokeWidth: layer.strokeWidth * Math.sqrt(area) } : {}),
    };
  });
}
