import { Affine } from "./affine";
import { Layer } from "./document";

/** The context and results of the agent tools (FEAT-0029): pure pieces the editor composes. */
export interface Frame { x: number; y: number; width: number; height: number }

/**
 * The map that fits a box into a frame, keeping its proportions and centring it: how a picture or
 * a drawing the model returns takes the place of what it was made from.
 */
export function fitInto(source: Frame, target: Frame): Affine {
  const scale = Math.min(target.width / Math.max(source.width, 1e-9), target.height / Math.max(source.height, 1e-9));
  const width = source.width * scale, height = source.height * scale;
  return { a: scale, b: 0, c: 0, d: scale, e: target.x + (target.width - width) / 2 - source.x * scale, f: target.y + (target.height - height) / 2 - source.y * scale };
}

/** The frame of a picture of a given pixel size fitted into a target frame. */
export function fittedPicture(width: number, height: number, target: Frame): Frame {
  const m = fitInto({ x: 0, y: 0, width, height }, target);
  return { x: m.e, y: m.f, width: width * m.a, height: height * m.d };
}

/**
 * The selected objects as data for the model: what the editor stores, without the pixels of
 * pictures, which travel as images, and within a size the request can carry.
 */
export function contextData(layers: readonly Layer[], limit = 200_000): string {
  const light = layers.map((layer) => {
    const copy: Record<string, unknown> = { ...layer };
    if (layer.source) copy["source"] = "[picture sent as an image]";
    return copy;
  });
  const text = JSON.stringify(light);
  return text.length <= limit ? text : text.slice(0, limit);
}

/** The pixel size of a PNG data URL, read from its header, or null when it is not a PNG. */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]{32,})/.exec(dataUrl);
  if (!match) return null;
  const head = atob(match[1].slice(0, 32));
  const bytes = Array.from(head, (char) => char.charCodeAt(0));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => bytes[index] !== byte) || head.slice(12, 16) !== "IHDR") return null;
  const read = (at: number) => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  const width = read(16), height = read(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Whether a context holds pictures: a vector result would then mean tracing them, which is not offered yet. */
export function hasPictures(layers: readonly Layer[]): boolean {
  return layers.some((layer) => layer.visible && !layer.guide && layer.source !== "");
}

/**
 * The source SVG sent with a vector request: the exported drawing framed on the context, without
 * the page background unless the whole document is the context, or nothing when it is too large.
 */
export function contextSvg(exported: string, frame: Frame, keepBackground: boolean, limit = 500_000): string | undefined {
  const opening = /^<svg [^>]*>/.exec(exported);
  if (!opening) return undefined;
  let body = exported.slice(opening[0].length);
  if (!keepBackground) body = body.replace(/^<rect width="100%" height="100%" fill="[^"]*"\/>/, "");
  const round = (value: number) => Math.round(value * 100) / 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${round(frame.width)}" height="${round(frame.height)}" viewBox="${round(frame.x)} ${round(frame.y)} ${round(frame.width)} ${round(frame.height)}">` + body;
  return svg.length <= limit ? svg : undefined;
}
