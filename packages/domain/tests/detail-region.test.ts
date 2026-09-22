import { describe, expect, it } from "vitest";
import { detailRegion } from "../src/zoom";

describe("the part of the page drawn sharp", () => {
  it("is nothing when a page unit is no bigger than a device pixel", () => {
    const page = { left: 0, top: 0, width: 800, height: 600 };
    expect(detailRegion(page, page, 1, 1)).toBeNull();
    expect(detailRegion(page, page, 0.5, 2)).toBeNull();
    expect(detailRegion(page, page, 1, 2)).not.toBeNull();
  });

  it("is the page in view, at one canvas pixel per device pixel", () => {
    // A 400 x 300 page at 4x is 1600 x 1200 on screen, scrolled so the view starts at (500, 250) of it.
    const page = { left: -500, top: -250, width: 1600, height: 1200 };
    const view = { left: 0, top: 0, width: 800, height: 600 };
    const region = detailRegion(page, view, 4, 2)!;
    expect(region.css).toEqual({ left: 500, top: 250, width: 800, height: 600 });
    expect(region.page).toEqual({ x: 125, y: 62.5, width: 200, height: 150, scale: 8 });
    // The canvas it gives is as many pixels as the device shows there.
    expect(region.page.width * region.page.scale).toBe(1600);
  });

  it("stops at the edges of the page and is nothing when the page is out of view", () => {
    const page = { left: 700, top: 100, width: 1000, height: 1000 };
    const view = { left: 0, top: 0, width: 800, height: 600 };
    expect(detailRegion(page, view, 2, 1)!.css).toEqual({ left: 0, top: 0, width: 100, height: 500 });
    expect(detailRegion({ ...page, left: 900 }, view, 2, 1)).toBeNull();
  });

  it("lowers the scale so the canvas stays within the pixel budget", () => {
    const page = { left: 0, top: 0, width: 4000, height: 4000 };
    const region = detailRegion(page, { left: 0, top: 0, width: 4000, height: 4000 }, 3, 3, 16_000_000)!;
    const pixels = region.page.width * region.page.scale * region.page.height * region.page.scale;
    expect(pixels).toBeLessThanOrEqual(16_000_000 + 1);
    expect(region.page.scale).toBeCloseTo(3);
  });
});
