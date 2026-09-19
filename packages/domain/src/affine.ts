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
