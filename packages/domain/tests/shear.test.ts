import { describe, expect, it } from "vitest";
import {
  blankDocument,
  localPoint,
  newLayer,
  parseDocument,
  resizeFromCorner,
  svgExport,
} from "../src/document";
import { anchor, worldPoint } from "../src/curves";

describe("centered shear geometry", () => {
  const layer = {
    ...newLayer("rectangle", "sheared", { x: 20, y: 30 }),
    width: 80,
    height: 60,
    skewX: 45,
  };
  it("uses an independent affine oracle and inverts rotated reflected points", () => {
    expect(worldPoint(layer, { x: 80, y: 60 })).toEqual({ x: 130, y: 90 });
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const transformed = { ...layer, rotation: 37, flipX, flipY };
        const point = localPoint(
          transformed,
          worldPoint(transformed, { x: 17, y: 43 }),
        );
        expect(point.x).toBeCloseTo(17);
        expect(point.y).toBeCloseTo(43);
      }
  });
  it("keeps the opposite edge fixed during a reflected, rotated side resize", () => {
    const original = { ...layer, rotation: 33, flipX: true, flipY: true };
    const resized = resizeFromCorner(
      original,
      worldPoint(original, { x: 140, y: 30 }),
      "r",
    );
    expect(resized.width).toBeCloseTo(140);
    expect(resized.height).toBe(60);
    for (const y of [0, 60]) {
      const before = worldPoint(original, { x: 0, y }),
        after = worldPoint(resized, { x: 0, y });
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    }
  });
  it("round trips shear only in format two and rejects malformed values", () => {
    const document = { ...blankDocument(), layers: [layer] };
    expect(parseDocument(JSON.stringify(document)).layers[0].skewX).toBe(45);
    for (const skewX of [null, true, "45", 90, -90])
      expect(() =>
        parseDocument(
          JSON.stringify({ ...document, layers: [{ ...layer, skewX }] }),
        ),
      ).toThrow();
    expect(() =>
      parseDocument(JSON.stringify({ ...document, version: 1 })),
    ).toThrow();
  });
  it("exports centered shear and fills only closed subpaths", () => {
    const closed = {
      closed: true,
      nodes: [
        anchor({ x: 0, y: 0 }),
        anchor({ x: 10, y: 0 }),
        anchor({ x: 0, y: 10 }),
      ],
    };
    const open = {
      closed: false,
      nodes: [
        anchor({ x: 30, y: 30 }),
        anchor({ x: 40, y: 30 }),
        anchor({ x: 40, y: 40 }),
      ],
    };
    const svg = svgExport({
      ...blankDocument(),
      layers: [{ ...layer, kind: "path", curves: [closed, open] }],
    });
    expect(svg).toContain("translate(40 30) skewX(45) translate(-40 -30)");
    const paths = svg.match(/<path[^>]+>/g)!;
    expect(paths).toHaveLength(2);
    expect(paths[0]).not.toContain("30 30");
    expect(paths[1]).toContain("30 30");
    expect(paths[1]).toContain('fill="none"');
  });
});
