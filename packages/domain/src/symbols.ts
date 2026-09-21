import { Layer, resizeLayer } from "./document";
import { mapCurves } from "./curves";
export function nineSlice(
  layer: Layer,
  width: number,
  height: number,
  inset = 0.25,
): Layer {
  const ratio = Math.max(0.05, Math.min(0.45, inset));
  const warp = (p: number, oldSize: number, newSize: number) => {
    const border = Math.min(oldSize * ratio, newSize / 2),
      left = oldSize * ratio,
      right = oldSize - left;
    if (p <= left) return (p / left) * border;
    if (p >= right) return newSize - border + ((p - right) / left) * border;
    return border + ((p - left) / (right - left)) * (newSize - 2 * border);
  };
  return {
    ...resizeLayer(layer, width, height),
    ...(layer.curves
      ? {
          curves: mapCurves(layer.curves, (p) => ({
            x: warp(p.x, layer.width, width),
            y: warp(p.y, layer.height, height),
          })),
        }
      : {}),
  };
}
export function symbolEffect(
  layer: Layer,
  mode: string,
  point: { x: number; y: number },
  delta: { x: number; y: number },
  intensity: number,
  reverse: boolean,
  color: string,
): Layer {
  const amount = Math.max(0.01, Math.min(1, intensity)) * (reverse ? -1 : 1);
  if (mode === "symbolShift")
    return { ...layer, x: layer.x + delta.x, y: layer.y + delta.y };
  if (mode === "symbolScrunch")
    return {
      ...layer,
      x: layer.x + (point.x - layer.x - layer.width / 2) * amount * 0.2,
      y: layer.y + (point.y - layer.y - layer.height / 2) * amount * 0.2,
    };
  if (mode === "symbolSize") {
    const w = Math.max(1, Math.min(4096, layer.width * (1 + amount * 0.2))),
      h = Math.max(1, Math.min(4096, layer.height * (1 + amount * 0.2)));
    return {
      ...resizeLayer(layer, w, h),
      x: layer.x + (layer.width - w) / 2,
      y: layer.y + (layer.height - h) / 2,
    };
  }
  if (mode === "symbolSpin")
    return { ...layer, rotation: (layer.rotation + amount * 30) % 360 };
  if (mode === "symbolStain" || mode === "symbolStyle")
    return {
      ...layer,
      fill: color,
      ...(mode === "symbolStyle"
        ? { stroke: color, strokeWidth: 2, blend: "multiply" as const }
        : {}),
    };
  if (mode === "symbolScreen")
    return {
      ...layer,
      opacity: Math.max(0, Math.min(1, layer.opacity - amount * 0.1)),
    };
  return layer;
}
