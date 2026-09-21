import { describe, expect, it } from "vitest";
import { transformLayers } from "../src/affine";
import { newLayer } from "../src/document";
import { anchor, worldPoint } from "../src/curves";

describe("world-space group transforms", () => {
  it.each([false, true])(
    "preserves exact world geometry for stretched rotated children (flip %s)",
    (flipped) => {
      const layer = {
        ...newLayer("path", "curve", { x: 10, y: 20 }),
        width: 100,
        height: 60,
        rotation: 45,
        skewX: 18,
        flipX: flipped,
        flipY: flipped,
        curves: [
          {
            closed: false,
            nodes: [
              anchor({ x: 0, y: 0 }),
              { ...anchor({ x: 100, y: 60 }), incoming: { x: 80, y: 10 } },
            ],
          },
        ],
      };
      const source = { x: -50, y: -40, width: 400, height: 300 };
      const target = { ...source, width: 800, height: 150 };
      const changed = transformLayers([layer], source, target, 30)[0];
      const rad = Math.PI / 6;
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
        { x: 0, y: 60 },
        { x: 80, y: 10 },
      ];
      for (const p of points) {
        const old = worldPoint(layer, p);
        const dx = (old.x - 150) * 2,
          dy = (old.y - 110) * 0.5;
        const expected = {
          x: 350 + dx * Math.cos(rad) - dy * Math.sin(rad),
          y: 35 + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
        const actual = worldPoint(changed, {
          x: (p.x * changed.width) / 100,
          y: (p.y * changed.height) / 60,
        });
        expect(actual.x).toBeCloseTo(expected.x, 8);
        expect(actual.y).toBeCloseTo(expected.y, 8);
      }
      expect(changed.curves![0].nodes[1].incoming!.x).toBeCloseTo(
        (80 * changed.width) / 100,
      );
      expect(layer.width).toBe(100);
    },
  );
  it("keeps all world y coordinates fixed when dragging a right edge horizontally", () => {
    const layer = {
      ...newLayer("rectangle", "rotated", { x: 25, y: 10 }),
      width: 120,
      height: 80,
      rotation: 45,
    };
    const box = { x: 0, y: 0, width: 200, height: 200 };
    const result = transformLayers([layer], box, { ...box, width: 400 })[0];
    for (const point of [
      { x: 0, y: 0 },
      { x: 120, y: 80 },
    ]) {
      const before = worldPoint(layer, point);
      const after = worldPoint(result, {
        x: (point.x * result.width) / 120,
        y: (point.y * result.height) / 80,
      });
      expect(after.x).toBeCloseTo(before.x * 2);
      expect(after.y).toBeCloseTo(before.y);
    }
  });
});
