import { Point } from "./document";
import { Anchor, CurvePath, cubic } from "./curves";

/**
 * The liquify tools of Illustrator: Warp, Twirl, Pucker, Bloat, Scallop, Crystallize and
 * Wrinkle. Each one moves the anchors and handles of paths that fall inside an elliptical
 * brush, most at its centre and not at all at its rim, after adding anchors where the
 * brush passes at the spacing its Detail sets. Everything here is in page coordinates.
 */
export type LiquifyTool = "warp" | "twirl" | "pucker" | "bloat" | "scallop" | "crystallize" | "wrinkle";
export const LIQUIFY_TOOLS: LiquifyTool[] = ["warp", "twirl", "pucker", "bloat", "scallop", "crystallize", "wrinkle"];

export interface LiquifyOptions {
  /** The brush: its width and height in pixels, its angle in degrees and its intensity in percent. */
  width: number;
  height: number;
  angle: number;
  intensity: number;
  /** Spacing of the anchors added where the brush passes: higher is closer, 1 to 10. */
  detail: number;
  /** How much of what does not change the shape is removed afterwards, 0.2 to 100 (Warp, Twirl, Pucker, Bloat). */
  simplify: number;
  /** Degrees of turn per step, -180 to 180; positive turns counterclockwise (Twirl). */
  twirlRate: number;
  /** How closely the details are spaced on the outline, 0 to 15 (Scallop, Crystallize, Wrinkle). */
  complexity: number;
  /** How far apart the wrinkles move across and along, 0 to 100 percent (Wrinkle). */
  horizontal: number;
  vertical: number;
  /** What the brush may move (Scallop, Crystallize, Wrinkle). */
  affectAnchors: boolean;
  affectIn: boolean;
  affectOut: boolean;
}

const BASE: LiquifyOptions = { width: 100, height: 100, angle: 0, intensity: 50, detail: 2, simplify: 50, twirlRate: 40, complexity: 1, horizontal: 0, vertical: 100, affectAnchors: true, affectIn: false, affectOut: false };
export const LIQUIFY_DEFAULTS: Record<LiquifyTool, LiquifyOptions> = {
  warp: { ...BASE },
  twirl: { ...BASE },
  pucker: { ...BASE },
  bloat: { ...BASE },
  scallop: { ...BASE },
  crystallize: { ...BASE },
  wrinkle: { ...BASE },
};
export const LIQUIFY_RANGES = {
  width: [1, 1000], height: [1, 1000], angle: [-360, 360], intensity: [1, 100], detail: [1, 10], simplify: [0.2, 100],
  twirlRate: [-180, 180], complexity: [0, 15], horizontal: [0, 100], vertical: [0, 100],
} as const;

/** Keeps saved or typed options inside the ranges of the manual, or refuses them. */
export function validLiquifyOptions(value: unknown): value is LiquifyOptions {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const numbers = Object.entries(LIQUIFY_RANGES).every(([key, [min, max]]) => typeof v[key] === "number" && Number.isFinite(v[key] as number) && (v[key] as number) >= min && (v[key] as number) <= max);
  return numbers && ["affectAnchors", "affectIn", "affectOut"].every((key) => typeof v[key] === "boolean");
}

/** How much the brush acts at a point: 1 at its centre, falling smoothly to 0 at its rim. */
export function brushWeight(point: Point, centre: Point, options: Pick<LiquifyOptions, "width" | "height" | "angle">): number {
  const r = (-options.angle * Math.PI) / 180, dx = point.x - centre.x, dy = point.y - centre.y;
  const x = dx * Math.cos(r) - dy * Math.sin(r), y = dx * Math.sin(r) + dy * Math.cos(r);
  const d = (x / (options.width / 2)) ** 2 + (y / (options.height / 2)) ** 2;
  return d >= 1 ? 0 : (1 - d) ** 2;
}

/** A repeatable pseudo-random number from 0 to 1 for a place, so a stroke gives the same details again. */
function noise(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Adds anchors to the segments the brush touches so that none is longer than the spacing
 * Detail sets, splitting at even parameter so the curve keeps its shape.
 */
export function refine(path: CurvePath, centre: Point, options: LiquifyOptions, limit = 4000): CurvePath {
  const spacing = Math.max(1, Math.min(options.width, options.height) / (options.detail * 4));
  const nodes = path.nodes.map((n) => structuredClone(n));
  const segments = path.closed ? nodes.length : nodes.length - 1;
  const out: Anchor[] = [];
  const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const reach = Math.max(options.width, options.height) / 2 + spacing;
  for (let i = 0; i < nodes.length; i++) {
    const current = nodes[i];
    out.push(current);
    if (i >= segments) continue;
    const next = nodes[(i + 1) % nodes.length];
    let [p0, p1, p2] = [current.point, current.outgoing, next.incoming];
    const p3 = next.point;
    // Only segments that come near the brush are split.
    const near = [0, 0.25, 0.5, 0.75, 1].some((t) => { const p = cubic(p0, p1, p2, p3, t); return Math.hypot(p.x - centre.x, p.y - centre.y) <= reach; });
    let length = 0, previous = p0;
    for (let t = 0.125; t <= 1; t += 0.125) { const p = cubic(p0, p1, p2, p3, t); length += Math.hypot(p.x - previous.x, p.y - previous.y); previous = p; }
    const pieces = near ? Math.min(64, Math.ceil(length / spacing)) : 1;
    if (pieces <= 1 || nodes.length + out.length + pieces > limit) continue;
    let last = current;
    for (let k = pieces; k > 1; k--) {
      const t = 1 / k, ab = lerp(p0, p1, t), bc = lerp(p1, p2, t), cd = lerp(p2, p3, t);
      const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), mid = lerp(abc, bcd, t);
      last.outgoing = ab;
      last = { point: mid, incoming: abc, outgoing: bcd, smooth: true };
      out.push(last);
      [p0, p1, p2] = [mid, bcd, cd];
    }
    last.outgoing = p1;
    next.incoming = p2;
  }
  return { closed: path.closed, nodes: out };
}

/**
 * One step of a liquify tool at `centre`, `delta` being how far the pointer moved since
 * the last step, which only Warp follows. Returns the path with its anchors and handles
 * moved; points outside the brush stay exactly where they were.
 */
export function liquifyStep(path: CurvePath, tool: LiquifyTool, centre: Point, delta: Point, options: LiquifyOptions, seed = 1): CurvePath {
  const strength = options.intensity / 100;
  const size = Math.min(options.width, options.height);
  const move = (p: Point, index: number, part: number): Point => {
    const w = brushWeight(p, centre, options);
    if (!w) return p;
    const dx = p.x - centre.x, dy = p.y - centre.y, distance = Math.hypot(dx, dy) || 1;
    switch (tool) {
      case "warp":
        return { x: p.x + delta.x * w * strength, y: p.y + delta.y * w * strength };
      case "twirl": {
        // Counterclockwise on screen for a positive rate, whose y axis points down.
        const a = (-options.twirlRate * Math.PI / 180) * w * strength * 0.1, c = Math.cos(a), s = Math.sin(a);
        return { x: centre.x + dx * c - dy * s, y: centre.y + dx * s + dy * c };
      }
      case "pucker":
      case "bloat": {
        const k = w * strength * 0.1 * (tool === "pucker" ? -1 : 1);
        return { x: p.x + dx * k, y: p.y + dy * k };
      }
      default: {
        // The detail tools move only every so many anchors, more of them with Complexity.
        const every = Math.max(1, 16 - options.complexity);
        if (index % every) return p;
        const r = noise(Math.round(p.x), Math.round(p.y), seed + part);
        const amount = size * 0.05 * w * strength * (0.5 + r);
        if (tool === "crystallize") return { x: p.x + (dx / distance) * amount, y: p.y + (dy / distance) * amount };
        if (tool === "scallop") return { x: p.x - (dx / distance) * amount, y: p.y - (dy / distance) * amount };
        const sign = r < 0.5 ? -1 : 1;
        return { x: p.x + sign * amount * (options.horizontal / 100), y: p.y + sign * amount * (options.vertical / 100) };
      }
    }
  };
  const detailTool = tool === "scallop" || tool === "crystallize" || tool === "wrinkle";
  const affects = { point: !detailTool || options.affectAnchors, incoming: !detailTool || options.affectIn, outgoing: !detailTool || options.affectOut };
  return {
    closed: path.closed,
    nodes: path.nodes.map((node, index) => {
      const point = affects.point ? move(node.point, index, 0) : node.point;
      // A handle keeps its offset from its anchor unless the brush moves the handle itself.
      const shift = { x: point.x - node.point.x, y: point.y - node.point.y };
      const carry = (h: Point) => ({ x: h.x + shift.x, y: h.y + shift.y });
      let incoming = carry(node.incoming), outgoing = carry(node.outgoing);
      if (!detailTool) { incoming = move(node.incoming, index, 1); outgoing = move(node.outgoing, index, 2); }
      else {
        if (affects.incoming) incoming = move(incoming, index, 1);
        if (affects.outgoing) outgoing = move(outgoing, index, 2);
        // Crystallize makes spikes: the anchors it moves lose their handles.
        if (tool === "crystallize" && (point.x !== node.point.x || point.y !== node.point.y)) { incoming = { ...point }; outgoing = { ...point }; return { point, incoming, outgoing, smooth: false }; }
      }
      return { point, incoming, outgoing, smooth: node.smooth };
    }),
  };
}
