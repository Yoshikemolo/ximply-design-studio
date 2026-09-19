import type { Point } from "./document";
import { anchor, CurvePath } from "./curves";
export type ConstructionTool =
  | "line"
  | "rounded"
  | "polygon"
  | "star"
  | "arc"
  | "spiral"
  | "grid"
  | "polar"
  | "flare";
export interface ShapeOptions {
  sides: number;
  radius: number;
  inner: number;
  turns: number;
  decay: number;
  rows: number;
  columns: number;
  rings: number;
  rays: number;
}
export const DEFAULT_SHAPE: ShapeOptions = {
  sides: 5,
  radius: 20,
  inner: 0.45,
  turns: 3,
  decay: 0.8,
  rows: 4,
  columns: 4,
  rings: 4,
  rays: 12,
};
export const polyline = (points: Point[], closed = false): CurvePath => ({
  nodes: points.map(anchor),
  closed,
});
export function ellipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): CurvePath {
  const k = 0.5522847498307936;
  return {
    closed: true,
    nodes: [
      {
        point: { x: cx + rx, y: cy },
        incoming: { x: cx + rx, y: cy - k * ry },
        outgoing: { x: cx + rx, y: cy + k * ry },
        smooth: true,
      },
      {
        point: { x: cx, y: cy + ry },
        incoming: { x: cx + k * rx, y: cy + ry },
        outgoing: { x: cx - k * rx, y: cy + ry },
        smooth: true,
      },
      {
        point: { x: cx - rx, y: cy },
        incoming: { x: cx - rx, y: cy + k * ry },
        outgoing: { x: cx - rx, y: cy - k * ry },
        smooth: true,
      },
      {
        point: { x: cx, y: cy - ry },
        incoming: { x: cx - k * rx, y: cy - ry },
        outgoing: { x: cx + k * rx, y: cy - ry },
        smooth: true,
      },
    ],
  };
}
export function construction(
  tool: ConstructionTool,
  a: Point,
  b: Point,
  o: ShapeOptions,
): CurvePath[] {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y),
    w = Math.max(1, Math.abs(b.x - a.x)),
    h = Math.max(1, Math.abs(b.y - a.y)),
    cx = x + w / 2,
    cy = y + h / 2;
  const line = (p: Point, q: Point) => polyline([p, q]);
  if (tool === "line") return [line(a, b)];
  if (tool === "arc") {
    const first = anchor(a),
      last = anchor(b);
    first.outgoing = { x: a.x + (b.x - a.x) * 0.55228475, y: a.y };
    last.incoming = { x: b.x, y: b.y - (b.y - a.y) * 0.55228475 };
    return [{ nodes: [first, last], closed: false }];
  }
  if (tool === "rounded") {
    const r = Math.max(0, Math.min(o.radius, w / 2, h / 2)),
      k = 0.55228475,
      pts = [
        { x: x + r, y },
        { x: x + w - r, y },
        { x: x + w, y: y + r },
        { x: x + w, y: y + h - r },
        { x: x + w - r, y: y + h },
        { x: x + r, y: y + h },
        { x, y: y + h - r },
        { x, y: y + r },
      ],
      nodes = pts.map(anchor);
    nodes[1].outgoing = { x: x + w - r + k * r, y };
    nodes[2].incoming = { x: x + w, y: y + r - k * r };
    nodes[3].outgoing = { x: x + w, y: y + h - r + k * r };
    nodes[4].incoming = { x: x + w - r + k * r, y: y + h };
    nodes[5].outgoing = { x: x + r - k * r, y: y + h };
    nodes[6].incoming = { x, y: y + h - r + k * r };
    nodes[7].outgoing = { x, y: y + r - k * r };
    nodes[0].incoming = { x: x + r - k * r, y };
    return [{ nodes, closed: true }];
  }
  if (tool === "polygon" || tool === "star") {
    const sides = Math.round(Math.max(3, Math.min(64, o.sides))),
      n = tool === "star" ? sides * 2 : sides;
    return [
      polyline(
        Array.from({ length: n }, (_, i) => {
          const r =
              tool === "star" && i % 2
                ? Math.max(0.05, Math.min(0.95, o.inner))
                : 1,
            t = (i * Math.PI * 2) / n - Math.PI / 2;
          return {
            x: cx + ((Math.cos(t) * w) / 2) * r,
            y: cy + ((Math.sin(t) * h) / 2) * r,
          };
        }),
        true,
      ),
    ];
  }
  if (tool === "spiral") {
    const turns = Math.max(0.25, Math.min(12, o.turns)),
      decay = Math.max(0.1, Math.min(1, o.decay)),
      n = Math.ceil(turns * 64);
    return [
      polyline(
        Array.from({ length: n + 1 }, (_, i) => {
          const t = (i / n) * turns * Math.PI * 2,
            r = Math.pow(decay, (i / n) * turns) * (1 - i / (n + 1));
          return {
            x: cx + ((Math.cos(t) * w) / 2) * r,
            y: cy + ((Math.sin(t) * h) / 2) * r,
          };
        }),
      ),
    ];
  }
  const paths: CurvePath[] = [];
  if (tool === "grid") {
    const rows = Math.round(Math.max(1, Math.min(32, o.rows))),
      cols = Math.round(Math.max(1, Math.min(32, o.columns)));
    for (let i = 0; i <= rows; i++)
      paths.push(
        line({ x, y: y + (h * i) / rows }, { x: x + w, y: y + (h * i) / rows }),
      );
    for (let i = 0; i <= cols; i++)
      paths.push(
        line({ x: x + (w * i) / cols, y }, { x: x + (w * i) / cols, y: y + h }),
      );
    return paths;
  }
  const rings = Math.round(Math.max(1, Math.min(32, o.rings))),
    rays = Math.round(Math.max(1, Math.min(64, o.rays)));
  for (let i = 1; i <= rings; i++)
    paths.push(
      ellipsePath(cx, cy, ((w / 2) * i) / rings, ((h / 2) * i) / rings),
    );
  for (let i = 0; i < rays; i++) {
    const t = (i * Math.PI * 2) / rays;
    paths.push(
      line(
        { x: cx, y: cy },
        { x: cx + (Math.cos(t) * w) / 2, y: cy + (Math.sin(t) * h) / 2 },
      ),
    );
  }
  if (tool === "flare") {
    for (let i = 1; i <= 4; i++)
      paths.push(
        ellipsePath(
          cx + (w * i) / 6,
          cy + (h * i) / 8,
          w / (10 + i * 4),
          h / (10 + i * 4),
        ),
      );
  }
  return paths;
}
