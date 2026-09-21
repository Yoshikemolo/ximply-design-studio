import * as clipping from "polygon-clipping";
import type { Layer, Point } from "./document";
import { flatten, worldPoint, type CurvePath } from "./curves";
import { ellipsePath, polyline } from "./shapes";

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Alignment =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom"
  | "distributeX"
  | "distributeY";
export type BooleanOperation = "union" | "subtract" | "intersect" | "exclude";
const NODE_LIMIT = 20_000;

function pointBounds(points: Point[]): SelectionBounds {
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error("Geometry contains a non-finite coordinate.");
    x = Math.min(x, point.x);
    y = Math.min(y, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return points.length
    ? { x, y, width: right - x, height: bottom - y }
    : { x: 0, y: 0, width: 0, height: 0 };
}

function worldCorners(layer: Layer): Point[] {
  return [
    { x: 0, y: 0 },
    { x: layer.width, y: 0 },
    { x: layer.width, y: layer.height },
    { x: 0, y: layer.height },
  ].map((point) => worldPoint(layer, point));
}

export function selectionBounds(layers: Layer[]): SelectionBounds {
  return pointBounds(layers.flatMap(worldCorners));
}

/** Returns copies in original stacking order; equal-gap distribution preserves both outer extents. */
export function alignLayers(
  layers: Layer[],
  mode: Alignment,
  reference?: SelectionBounds,
): Layer[] {
  const result = layers.map((layer) => ({ ...layer }));
  if (!layers.length) return result;
  const boxes = layers.map((layer) => selectionBounds([layer]));
  const target = reference ?? selectionBounds(layers);
  if (mode === "distributeX" || mode === "distributeY") {
    if (layers.length < 3)
      throw new Error("Select at least three objects to distribute.");
    const axis = mode === "distributeX" ? "x" : "y",
      size = axis === "x" ? "width" : "height";
    const ordered = boxes
      .map((box, index) => ({ box, index }))
      .sort((a, b) => a.box[axis] - b.box[axis] || a.index - b.index);
    const first = ordered[0],
      last = ordered.reduce((outer, item) =>
        item.box[axis] + item.box[size] >= outer.box[axis] + outer.box[size]
          ? item
          : outer,
      );
    if (first.index === last.index)
      throw new Error(
        "Distribution requires different objects at the two outer edges.",
      );
    const distribution = [
      first,
      ...ordered.filter(
        (item) => item.index !== first.index && item.index !== last.index,
      ),
      last,
    ];
    const gap =
      (last.box[axis] +
        last.box[size] -
        first.box[axis] -
        boxes.reduce((sum, box) => sum + box[size], 0)) /
      (layers.length - 1);
    let next = first.box[axis];
    for (const { box, index } of distribution) {
      result[index][axis] += next - box[axis];
      next += box[size] + gap;
    }
    return result;
  }
  const horizontal = ["left", "centerX", "right"].includes(mode);
  const axis = horizontal ? "x" : "y",
    size = horizontal ? "width" : "height";
  const factor =
    mode === "centerX" || mode === "centerY"
      ? 0.5
      : mode === "right" || mode === "bottom"
        ? 1
        : 0;
  result.forEach((layer, index) => {
    layer[axis] +=
      target[axis] +
      target[size] * factor -
      boxes[index][axis] -
      boxes[index][size] * factor;
  });
  return result;
}

function filledPaths(layer: Layer): CurvePath[] {
  if (layer.kind === "rectangle")
    return [
      polyline(
        [
          { x: 0, y: 0 },
          { x: layer.width, y: 0 },
          { x: layer.width, y: layer.height },
          { x: 0, y: layer.height },
        ],
        true,
      ),
    ];
  if (layer.kind === "ellipse")
    return [
      ellipsePath(
        layer.width / 2,
        layer.height / 2,
        layer.width / 2,
        layer.height / 2,
      ),
    ];
  if (layer.kind !== "path")
    throw new Error(
      "Boolean operations require vector shapes; outline text or trace images first.",
    );
  const paths =
    layer.curves?.filter((path) => path.closed && path.nodes.length >= 3) ?? [];
  if (!paths.length)
    throw new Error("Boolean operations require a closed, filled vector path.");
  return paths;
}

function straight(path: CurvePath): boolean {
  return path.nodes.every(
    (node) =>
      node.point.x === node.incoming.x &&
      node.point.y === node.incoming.y &&
      node.point.x === node.outgoing.x &&
      node.point.y === node.outgoing.y,
  );
}

function inputGeometry(
  layer: Layer,
  budget: { remaining: number },
): clipping.MultiPolygon {
  const polygons: clipping.Polygon[] = filledPaths(layer).map((path) => {
    const isStraight = straight(path),
      count = isStraight ? path.nodes.length : path.nodes.length * 24 + 1;
    budget.remaining -= count;
    if (budget.remaining < 0)
      throw new Error(
        "Boolean geometry exceeds the 20,000-point preview limit.",
      );
    const points = isStraight
      ? path.nodes.map((node) => node.point)
      : flatten(path, 24);
    const ring: clipping.Ring = points.map((point) => {
      const world = worldPoint(layer, point);
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y))
        throw new Error("Geometry contains a non-finite coordinate.");
      return [world.x, world.y];
    });
    return [ring];
  });
  const [first, ...rest] = polygons;
  return clipping.xor(first, ...rest);
}

/** Layers must be ordered bottom to top. The bottom object's appearance is retained. */
export function booleanLayers(
  layers: Layer[],
  operation: BooleanOperation,
  id: string,
): Layer {
  if (layers.length < 2)
    throw new Error("Select at least two objects for a boolean operation.");
  if (!id || id.length > 100 || layers.some((layer) => layer.id === id))
    throw new Error("The result requires a new unique object ID.");
  const budget = { remaining: NODE_LIMIT };
  const [first, ...rest] = layers.map((layer) => inputGeometry(layer, budget));
  const operations = {
    union: clipping.union,
    subtract: clipping.difference,
    intersect: clipping.intersection,
    exclude: clipping.xor,
  };
  const polygons = operations[operation](first, ...rest);
  const rings = polygons.flatMap((polygon) =>
    polygon.map((ring) => ring.slice(0, -1)),
  );
  if (!rings.length)
    throw new Error("The boolean operation produces no filled area.");
  if (
    rings.reduce((count, ring) => count + ring.length, 0) > NODE_LIMIT ||
    rings.length > 4096
  )
    throw new Error("Boolean result exceeds the editable path limit.");
  const bounds = pointBounds(
    rings.flatMap((ring) => ring.map(([x, y]) => ({ x, y }))),
  );
  if (
    bounds.width > 16384 ||
    bounds.height > 16384 ||
    Math.abs(bounds.x) > 100000 ||
    Math.abs(bounds.y) > 100000
  )
    throw new Error("Boolean result exceeds the editable document bounds.");
  const result: Layer = {
    ...layers[0],
    ...bounds,
    id,
    name: `Boolean ${operation}`,
    kind: "path",
    rotation: 0,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    points: [],
    text: "",
    source: "",
    curves: rings.map((ring) =>
      polyline(
        ring.map(([x, y]) => ({ x: x - bounds.x, y: y - bounds.y })),
        true,
      ),
    ),
  };
  delete result.symbolId;
  delete result.traceSourceId;
  return result;
}
