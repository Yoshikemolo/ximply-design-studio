import { describe, it, expect } from "vitest";
import {
  anchor,
  cubic,
  splitSegment,
  flatten,
  fitCurves,
  worldPoint,
  rotationFromDrag,
  snapDirection,
} from "../src/curves";
import {
  newLayer,
  resizeFromCorner,
  parseDocument,
  blankDocument,
  svgExport,
  hitTest,
} from "../src/document";
import { construction, DEFAULT_SHAPE } from "../src/shapes";
import {
  defaultShortcuts,
  validateShortcuts,
  eventChord,
  matchShortcut,
  normalizeChord,
} from "../src/shortcuts";
import { tracePixels } from "../src/tracing";
import { nineSlice, symbolEffect } from "../src/symbols";
import { canvasWheelZoom, isCanvasZoomGesture } from "../src/input";
const curve = {
  closed: false,
  nodes: [
    { ...anchor({ x: 0, y: 0 }), outgoing: { x: 0, y: 100 } },
    { ...anchor({ x: 100, y: 0 }), incoming: { x: 100, y: 100 } },
  ],
};
describe("drawing geometry", () => {
  it("subdivides a cubic without changing its shape", () => {
    expect(
      cubic(
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        0.5,
      ),
    ).toEqual({ x: 50, y: 75 });
    const split = splitSegment(curve, 0, 0.5);
    expect(split.nodes[1].point).toEqual({ x: 50, y: 75 });
    const a = split.nodes[0],
      b = split.nodes[1];
    expect(cubic(a.point, a.outgoing, b.incoming, b.point, 0.5)).toEqual(
      cubic(
        curve.nodes[0].point,
        curve.nodes[0].outgoing,
        curve.nodes[1].incoming,
        curve.nodes[1].point,
        0.25,
      ),
    );
  });
  it("preserves world controls when rebounding a rotated curve", () => {
    const layer = {
        ...newLayer("path", "p", { x: 30, y: 40 }),
        width: 100,
        height: 100,
        rotation: 37,
        curves: [curve],
      },
      before = worldPoint(layer, curve.nodes[0].outgoing),
      after = fitCurves(layer, [curve]);
    expect(worldPoint(after, after.curves![0].nodes[0].outgoing).x).toBeCloseTo(
      before.x,
    );
    expect(worldPoint(after, after.curves![0].nodes[0].outgoing).y).toBeCloseTo(
      before.y,
    );
  });
  it("edge handles preserve the perpendicular dimension and opposite edge under rotation", () => {
    const layer = {
      ...newLayer("rectangle", "x", { x: 20, y: 30 }),
      width: 100,
      height: 80,
      rotation: 35,
    };
    for (const [side, p, opposite] of [
      ["r", { x: 150, y: 40 }, { x: 0, y: 40 }],
      ["l", { x: -50, y: 40 }, { x: 100, y: 40 }],
      ["t", { x: 50, y: -40 }, { x: 50, y: 80 }],
      ["b", { x: 50, y: 120 }, { x: 50, y: 0 }],
    ] as const) {
      const before = worldPoint(layer, opposite),
        result = resizeFromCorner(layer, worldPoint(layer, p), side);
      expect(
        side === "l" || side === "r" ? result.height : result.width,
      ).toBeCloseTo(side === "l" || side === "r" ? 80 : 100);
      const local =
        side === "r"
          ? { x: 0, y: 40 }
          : side === "l"
            ? { x: result.width, y: 40 }
            : side === "t"
              ? { x: 50, y: result.height }
              : { x: 50, y: 0 };
      expect(worldPoint(result, local).x).toBeCloseTo(before.x);
      expect(worldPoint(result, local).y).toBeCloseTo(before.y);
    }
  });
  it("snaps movement and rotation using the configured angle without moving the centre", () => {
    expect(snapDirection({ x: 0, y: 0 }, { x: 10, y: 2 }, 45).y).toBe(0);
    const layer = {
      ...newLayer("rectangle", "x", { x: 0, y: 0 }),
      width: 100,
      height: 100,
    };
    expect(
      rotationFromDrag(layer, { x: 50, y: 0 }, { x: 100, y: 50 }, true, 30),
    ).toBe(90);
    expect(canvasWheelZoom(1, -100)).toBeGreaterThan(1);
    expect(canvasWheelZoom(3, -100)).toBe(3);
    expect(isCanvasZoomGesture(true, true, false)).toBe(true);
    expect(isCanvasZoomGesture(true, false, false)).toBe(false);
    expect(isCanvasZoomGesture(true, true, true)).toBe(false);
  });
  it("constructs every parametric tool with finite editable geometry", () => {
    for (const tool of [
      "line",
      "rounded",
      "polygon",
      "star",
      "arc",
      "spiral",
      "grid",
      "polar",
      "flare",
    ] as const) {
      const paths = construction(
        tool,
        { x: 10, y: 20 },
        { x: 210, y: 120 },
        DEFAULT_SHAPE,
      );
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths)
        for (const n of p.nodes)
          expect(Number.isFinite(n.outgoing.x + n.incoming.y)).toBe(true);
    }
    expect(
      construction(
        "polygon",
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        DEFAULT_SHAPE,
      )[0].nodes,
    ).toHaveLength(5);
    expect(
      construction("star", { x: 0, y: 0 }, { x: 100, y: 100 }, DEFAULT_SHAPE)[0]
        .nodes,
    ).toHaveLength(10);
    expect(
      construction("grid", { x: 0, y: 0 }, { x: 100, y: 100 }, DEFAULT_SHAPE),
    ).toHaveLength(10);
  });
  it("round trips cubic data and rejects unsafe controls and unsupported versions", () => {
    const doc = blankDocument();
    doc.layers = [
      {
        ...newLayer("path", "curve", { x: 0, y: 0 }),
        width: 100,
        height: 100,
        curves: [curve],
      },
    ];
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    expect(svgExport(doc)).toContain("C 0 100 100 100 100 0");
    expect(hitTest(doc.layers[0], { x: 50, y: 75 })).toBe(true);
    expect(hitTest(doc.layers[0], { x: 50, y: 10 })).toBe(false);
    expect(() =>
      parseDocument(JSON.stringify({ ...doc, version: 1 })),
    ).toThrow();
    expect(
      parseDocument(JSON.stringify({ ...blankDocument(), version: 1 })).version,
    ).toBe(2);
    doc.layers[0].curves![0].nodes[0].incoming.x = Infinity;
    expect(() => parseDocument(JSON.stringify(doc))).toThrow();
  });
  it("traces a known bitmap into exact colored scanline areas", () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]);
    const result = tracePixels(data, 2, 2, {
      mode: "mono",
      threshold: 128,
      levels: 2,
      ignoreWhite: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe("#000000");
    expect(result[0].curves).toHaveLength(2);
    expect(result[0].curves[0].nodes[1].point.x).toBe(1);
    expect(result[0].curves[1].nodes[1].point.x).toBe(2);
    expect(() =>
      tracePixels(data, 100, 100, {
        mode: "mono",
        threshold: 128,
        levels: 2,
        ignoreWhite: true,
      }),
    ).toThrow();
  });
  it("preserves nine-slice corners and applies bounded symbol effects", () => {
    const layer = {
      ...newLayer("path", "x", { x: 0, y: 0 }),
      width: 100,
      height: 100,
      curves: construction(
        "rounded",
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        DEFAULT_SHAPE,
      ),
    };
    const scaled = nineSlice(layer, 200, 150);
    expect(scaled.curves![0].nodes[0].point.x).toBe(20);
    expect(scaled.curves![0].nodes[1].point.x).toBe(180);
    expect(
      symbolEffect(
        layer,
        "symbolScreen",
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        1,
        false,
        "#ff0000",
      ).opacity,
    ).toBeCloseTo(0.9);
    expect(
      symbolEffect(
        layer,
        "symbolStain",
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        1,
        false,
        "#ff0000",
      ).fill,
    ).toBe("#ff0000");
  });
});
describe("shortcut invariants", () => {
  it("has collision-free defaults with expected tool keys", () => {
    const map = validateShortcuts(defaultShortcuts());
    expect(map["tool.pen"]).toEqual(["P"]);
    expect(map["tool.path"]).toEqual(["N"]);
    expect(map["tool.eraser"]).toEqual(["Shift+E"]);
    expect(map["tool.rectangle"]).toEqual(["M"]);
  });
  it("normalizes modifier aliases and rejects collisions across aliases", () => {
    const map = defaultShortcuts();
    map["tool.pen"] = ["ctrl+z"];
    expect(() => validateShortcuts(map)).toThrow(/collision/);
    expect(normalizeChord("cmd+shift+z")).toBe("Mod+Shift+Z");
  });
  it("blocks malformed and browser-reserved assignments", () => {
    const map = defaultShortcuts();
    map["save"] = ["Mod+W"];
    expect(() => validateShortcuts(map)).toThrow(/Reserved/);
    map["save"] = ["Hyper+Q"];
    expect(() => validateShortcuts(map)).toThrow();
  });
  it("ignores composing or modifier-only events and matches both platforms", () => {
    const key = {
      key: "z",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    };
    expect(matchShortcut(defaultShortcuts(), key)).toBe("undo");
    expect(
      matchShortcut(defaultShortcuts(), {
        ...key,
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe("undo");
    expect(eventChord({ ...key, isComposing: true })).toBeNull();
    expect(eventChord({ ...key, key: "Control" })).toBeNull();
    expect(
      eventChord({ ...key, key: "+", ctrlKey: false, shiftKey: true }),
    ).toBe("+");
  });
});

describe("eraser topology", () => {
  it("subtracts overlapping filled erasures without restoring their overlap", async () => {
    const { eraseFilled } = await import("../src/erase");
    const original = construction(
      "rounded",
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { ...DEFAULT_SHAPE, radius: 0 },
    );
    const once = eraseFilled(original, { x: 40, y: 50 }, 20),
      twice = eraseFilled(once, { x: 60, y: 50 }, 20);
    const layer = {
      ...newLayer("path", "p", { x: 0, y: 0 }),
      width: 100,
      height: 100,
      strokeWidth: 0,
      curves: twice,
    };
    expect(hitTest(layer, { x: 50, y: 50 })).toBe(false);
    expect(hitTest(layer, { x: 10, y: 10 })).toBe(true);
  });
  it("splits an open stroke at the exact eraser circle boundary", async () => {
    const { eraseStroke } = await import("../src/erase");
    const result = eraseStroke(
      [
        {
          nodes: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })],
          closed: false,
        },
      ],
      { x: 50, y: 0 },
      10,
    );
    expect(result).toHaveLength(2);
    expect(result[0].nodes.at(-1)!.point.x).toBeCloseTo(40);
    expect(result[1].nodes[0].point.x).toBeCloseTo(60);
  });
});
