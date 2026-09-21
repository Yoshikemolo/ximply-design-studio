import { CurvePath } from "./curves";
import { polyline } from "./shapes";
export interface TraceOptions {
  mode: "mono" | "gray" | "color";
  threshold: number;
  levels: number;
  ignoreWhite: boolean;
}
export interface TraceRegion {
  color: string;
  curves: CurvePath[];
}
/** Scanline runs produce bounded, deterministic editable vector regions. */
export function tracePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: TraceOptions,
): TraceRegion[] {
  if (
    width < 1 ||
    height < 1 ||
    width > 64 ||
    height > 64 ||
    data.length !== width * height * 4
  )
    throw new Error("Invalid trace raster");
  const groups = new Map<string, CurvePath[]>(),
    levels = Math.max(2, Math.min(8, Math.round(options.levels)));
  const quantize = (v: number) =>
    Math.round((Math.round((v / 255) * (levels - 1)) * 255) / (levels - 1));
  const colorAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return "";
    let r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (options.mode === "mono") r = g = b = gray < options.threshold ? 0 : 255;
    else if (options.mode === "gray") r = g = b = quantize(gray);
    else {
      r = quantize(r);
      g = quantize(g);
      b = quantize(b);
    }
    const color =
      "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return options.ignoreWhite && color === "#ffffff" ? "" : color;
  };
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const start = x,
        color = colorAt(x, y);
      while (x < width && colorAt(x, y) === color) x++;
      if (color) {
        const list = groups.get(color) ?? [];
        list.push(
          polyline(
            [
              { x: start, y },
              { x, y },
              { x, y: y + 1 },
              { x: start, y: y + 1 },
            ],
            true,
          ),
        );
        groups.set(color, list);
      }
    }
  }
  return [...groups].map(([color, curves]) => ({ color, curves }));
}
