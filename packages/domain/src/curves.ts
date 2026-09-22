import type { Layer, Point } from "./document";

export interface Anchor {
  point: Point;
  incoming: Point;
  outgoing: Point;
  smooth: boolean;
}
export interface CurvePath {
  nodes: Anchor[];
  closed: boolean;
}
export const anchor = (point: Point): Anchor => ({
  point: { ...point },
  incoming: { ...point },
  outgoing: { ...point },
  smooth: false,
});
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export function cubic(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  t: number,
): Point {
  const u = 1 - t;
  return {
    x:
      u * u * u * a.x +
      3 * u * u * t * b.x +
      3 * u * t * t * c.x +
      t * t * t * d.x,
    y:
      u * u * u * a.y +
      3 * u * u * t * b.y +
      3 * u * t * t * c.y +
      t * t * t * d.y,
  };
}
export function splitSegment(
  path: CurvePath,
  index: number,
  t = 0.5,
): CurvePath {
  const nodes = structuredClone(path.nodes),
    a = nodes[index],
    b = nodes[(index + 1) % nodes.length];
  const ab = lerp(a.point, a.outgoing, t),
    bc = lerp(a.outgoing, b.incoming, t),
    cd = lerp(b.incoming, b.point, t),
    abc = lerp(ab, bc, t),
    bcd = lerp(bc, cd, t),
    point = lerp(abc, bcd, t);
  a.outgoing = ab;
  b.incoming = cd;
  nodes.splice(index + 1, 0, {
    point,
    incoming: abc,
    outgoing: bcd,
    smooth: true,
  });
  return { ...path, nodes };
}
export function flatten(path: CurvePath, steps = 24): Point[] {
  if (!path.nodes.length) return [];
  const result = [path.nodes[0].point],
    count = path.closed ? path.nodes.length : path.nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i],
      b = path.nodes[(i + 1) % path.nodes.length];
    for (let j = 1; j <= steps; j++)
      result.push(cubic(a.point, a.outgoing, b.incoming, b.point, j / steps));
  }
  return result;
}
export function mapCurves(
  paths: CurvePath[],
  fn: (p: Point) => Point,
): CurvePath[] {
  return paths.map((path) => ({
    ...path,
    nodes: path.nodes.map((n) => ({
      ...n,
      point: fn(n.point),
      incoming: fn(n.incoming),
      outgoing: fn(n.outgoing),
    })),
  }));
}
export function worldPoint(layer: Layer, p: Point): Point {
  const a = (layer.rotation * Math.PI) / 180,
    dy = (layer.flipY ? layer.height - p.y : p.y) - layer.height / 2,
    dx =
      (layer.flipX ? layer.width - p.x : p.x) -
      layer.width / 2 +
      Math.tan(((layer.skewX ?? 0) * Math.PI) / 180) * dy;
  return {
    x: layer.x + layer.width / 2 + dx * Math.cos(a) - dy * Math.sin(a),
    y: layer.y + layer.height / 2 + dx * Math.sin(a) + dy * Math.cos(a),
  };
}
export function fitCurves(layer: Layer, curves: CurvePath[]): Layer {
  const points = curves.flatMap((p) =>
    p.nodes.flatMap((n) => [n.point, n.incoming, n.outgoing]),
  );
  if (!points.length) return { ...layer, curves };
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    x = Math.min(x, p.x);
    y = Math.min(y, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  const width = Math.max(1, right - x),
    height = Math.max(1, bottom - y),
    center = worldPoint(layer, { x: x + width / 2, y: y + height / 2 });
  return {
    ...layer,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    curves: mapCurves(curves, (p) => ({ x: p.x - x, y: p.y - y })),
  };
}
export function curveSvg(paths: CurvePath[]): string {
  return paths
    .map((path) => {
      if (!path.nodes.length) return "";
      let d = `M ${path.nodes[0].point.x} ${path.nodes[0].point.y}`;
      const count = path.closed ? path.nodes.length : path.nodes.length - 1;
      for (let i = 0; i < count; i++) {
        const a = path.nodes[i],
          b = path.nodes[(i + 1) % path.nodes.length];
        d += ` C ${a.outgoing.x} ${a.outgoing.y} ${b.incoming.x} ${b.incoming.y} ${b.point.x} ${b.point.y}`;
      }
      return d + (path.closed ? " Z" : "");
    })
    .join(" ");
}
export function nearestSegment(
  paths: CurvePath[],
  point: Point,
): { path: number; segment: number; t: number; distance: number } | undefined {
  let nearest: ReturnType<typeof nearestSegment>;
  paths.forEach((path, pi) => {
    const count = path.closed ? path.nodes.length : path.nodes.length - 1;
    for (let i = 0; i < count; i++) {
      const a = path.nodes[i],
        b = path.nodes[(i + 1) % path.nodes.length];
      for (let j = 1; j < 32; j++) {
        const t = j / 32,
          p = cubic(a.point, a.outgoing, b.incoming, b.point, t),
          distance = Math.hypot(p.x - point.x, p.y - point.y);
        if (!nearest || distance < nearest.distance)
          nearest = { path: pi, segment: i, t, distance };
      }
    }
  });
  return nearest;
}
export function rotationFromDrag(
  layer: Layer,
  start: Point,
  end: Point,
  snap = false,
  increment = 45,
  /** The point the rotation turns about, as the angle is measured there; the centre by default. */
  center: Point = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 },
): number {
  const delta =
    Math.atan2(end.y - center.y, end.x - center.x) -
    Math.atan2(start.y - center.y, start.x - center.x);
  let angle = layer.rotation + (delta * 180) / Math.PI;
  if (snap) angle = Math.round(angle / increment) * increment;
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}
export function moveAnchor(node: Anchor, p: Point): Anchor {
  const dx = p.x - node.point.x,
    dy = p.y - node.point.y;
  return {
    ...node,
    point: p,
    incoming: { x: node.incoming.x + dx, y: node.incoming.y + dy },
    outgoing: { x: node.outgoing.x + dx, y: node.outgoing.y + dy },
  };
}
export function smoothPath(path: CurvePath, strength = 0.2): CurvePath {
  return {
    ...path,
    nodes: path.nodes.map((n, i) => {
      const prev = path.nodes[(i - 1 + path.nodes.length) % path.nodes.length],
        next = path.nodes[(i + 1) % path.nodes.length];
      const dx = (next.point.x - prev.point.x) * strength,
        dy = (next.point.y - prev.point.y) * strength;
      return {
        ...n,
        smooth: true,
        incoming:
          !path.closed && i === 0
            ? n.point
            : { x: n.point.x - dx, y: n.point.y - dy },
        outgoing:
          !path.closed && i === path.nodes.length - 1
            ? n.point
            : { x: n.point.x + dx, y: n.point.y + dy },
      };
    }),
  };
}
export function simplifyPoints(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const first = points[0],
    last = points[points.length - 1],
    dx = last.x - first.x,
    dy = last.y - first.y,
    length = dx * dx + dy * dy;
  let far = 0,
    index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      t = length
        ? Math.max(
            0,
            Math.min(1, ((p.x - first.x) * dx + (p.y - first.y) * dy) / length),
          )
        : 0,
      dist = Math.hypot(p.x - first.x - dx * t, p.y - first.y - dy * t);
    if (dist > far) {
      far = dist;
      index = i;
    }
  }
  return far > tolerance
    ? [
        ...simplifyPoints(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplifyPoints(points.slice(index), tolerance),
      ]
    : [first, last];
}

export function snapDirection(
  start: Point,
  end: Point,
  increment: number,
): Point {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    length = Math.hypot(dx, dy),
    step = (increment * Math.PI) / 180,
    angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: start.x + Math.cos(angle) * length,
    y: start.y + Math.sin(angle) * length,
  };
}
