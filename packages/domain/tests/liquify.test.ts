import { describe, expect, it } from 'vitest';
import { CurvePath } from '../src/curves';
import { LIQUIFY_DEFAULTS, brushWeight, liquifyStep, refine, validLiquifyOptions } from '../src/liquify';

const node = (x: number, y: number) => ({ point: { x, y }, incoming: { x, y }, outgoing: { x, y }, smooth: false });
/** A square outline 200 wide centred on the origin, with an anchor every 10 along each side. */
function square(): CurvePath {
  const nodes = [];
  for (let x = -100; x < 100; x += 10) nodes.push(node(x, -100));
  for (let y = -100; y < 100; y += 10) nodes.push(node(100, y));
  for (let x = 100; x > -100; x -= 10) nodes.push(node(x, 100));
  for (let y = 100; y > -100; y -= 10) nodes.push(node(-100, y));
  return { closed: true, nodes };
}
const options = { ...LIQUIFY_DEFAULTS.warp, width: 80, height: 80 };
const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

describe('the liquify brush', () => {
  it('acts fully at its centre, not at all at its rim, and turns with its angle', () => {
    expect(brushWeight({ x: 0, y: 0 }, { x: 0, y: 0 }, options)).toBe(1);
    expect(brushWeight({ x: 40, y: 0 }, { x: 0, y: 0 }, options)).toBe(0);
    const flat = { width: 100, height: 20, angle: 90 };
    // Turned upright, the long axis runs down the page.
    expect(brushWeight({ x: 0, y: 40 }, { x: 0, y: 0 }, flat)).toBeGreaterThan(0);
    expect(brushWeight({ x: 40, y: 0 }, { x: 0, y: 0 }, flat)).toBe(0);
  });

  it('leaves every point outside the brush where it was', () => {
    const path = square();
    for (const tool of ['warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'] as const) {
      const out = liquifyStep(path, tool, { x: 100, y: 0 }, { x: 5, y: 5 }, { ...LIQUIFY_DEFAULTS[tool], width: 40, height: 40, complexity: 15 });
      out.nodes.forEach((n, i) => {
        if (Math.hypot(path.nodes[i].point.x - 100, path.nodes[i].point.y) >= 20) expect(n.point).toEqual(path.nodes[i].point);
      });
    }
  });
});

describe('the tools', () => {
  it('Warp moves the points with the drag, most at the centre', () => {
    const out = liquifyStep(square(), 'warp', { x: 100, y: 0 }, { x: 10, y: 0 }, { ...options, intensity: 100 });
    const at = out.nodes.findIndex((n, i) => square().nodes[i].point.x === 100 && square().nodes[i].point.y === 0);
    expect(out.nodes[at].point.x).toBeCloseTo(110, 9);
  });

  it('Pucker pulls towards the centre and Bloat pushes away', () => {
    const path = square();
    const centre = { x: 100, y: 10 };
    const pucker = liquifyStep(path, 'pucker', centre, { x: 0, y: 0 }, options);
    const bloat = liquifyStep(path, 'bloat', centre, { x: 0, y: 0 }, options);
    const i = path.nodes.findIndex((n) => n.point.x === 100 && n.point.y === 0);
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
    expect(d(pucker.nodes[i].point)).toBeLessThan(d(path.nodes[i].point));
    expect(d(bloat.nodes[i].point)).toBeGreaterThan(d(path.nodes[i].point));
  });

  it('Twirl turns the points about the centre, keeping their distance, counterclockwise for a positive rate', () => {
    const path = square();
    const out = liquifyStep(path, 'twirl', { x: 100, y: 0 }, { x: 0, y: 0 }, { ...options, twirlRate: 90, intensity: 100 });
    const i = path.nodes.findIndex((n) => n.point.x === 100 && n.point.y === -10);
    const before = path.nodes[i].point, after = out.nodes[i].point;
    expect(Math.hypot(after.x - 100, after.y)).toBeCloseTo(Math.hypot(before.x - 100, before.y), 9);
    // Above the centre on screen, counterclockwise moves the point to the left.
    expect(after.x).toBeLessThan(before.x);
  });

  it('Crystallize spikes outwards and Scallop curls inwards, the same way each time', () => {
    const path = square();
    const centre = { x: 100, y: 0 }, o = { ...options, complexity: 15 };
    const crystal = liquifyStep(path, 'crystallize', centre, { x: 0, y: 0 }, o);
    const scallop = liquifyStep(path, 'scallop', centre, { x: 0, y: 0 }, o);
    const i = path.nodes.findIndex((n) => n.point.x === 100 && n.point.y === 10);
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
    expect(d(crystal.nodes[i].point)).toBeGreaterThan(d(path.nodes[i].point));
    expect(crystal.nodes[i].incoming).toEqual(crystal.nodes[i].point);
    expect(d(scallop.nodes[i].point)).toBeLessThan(d(path.nodes[i].point));
    expect(liquifyStep(path, 'crystallize', centre, { x: 0, y: 0 }, o)).toEqual(crystal);
  });

  it('Wrinkle moves along the directions its horizontal and vertical amounts give', () => {
    const out = liquifyStep(square(), 'wrinkle', { x: 100, y: 0 }, { x: 0, y: 0 }, { ...options, complexity: 15, horizontal: 0, vertical: 100 });
    out.nodes.forEach((n, i) => expect(n.point.x).toBe(square().nodes[i].point.x));
    expect(out.nodes.some((n, i) => n.point.y !== square().nodes[i].point.y)).toBe(true);
  });
});

describe('detail and options', () => {
  it('adds anchors where the brush passes at the spacing of Detail, and nowhere else', () => {
    const line: CurvePath = { closed: false, nodes: [node(0, 0), node(400, 0)] };
    const refined = refine(line, { x: 0, y: 0 }, { ...options, detail: 2 });
    // Spacing 80 / (2 * 4) = 10 along 400 pixels.
    expect(refined.nodes).toHaveLength(41);
    expect(refine(line, { x: 0, y: 500 }, options).nodes).toHaveLength(2);
    const closer = refine(line, { x: 0, y: 0 }, { ...options, detail: 10 });
    expect(closer.nodes.length).toBeGreaterThan(refined.nodes.length);
  });

  it('keeps the options inside the ranges of the manual', () => {
    expect(validLiquifyOptions(LIQUIFY_DEFAULTS.twirl)).toBe(true);
    expect(validLiquifyOptions({ ...LIQUIFY_DEFAULTS.twirl, twirlRate: 181 })).toBe(false);
    expect(validLiquifyOptions({ ...LIQUIFY_DEFAULTS.twirl, detail: 11 })).toBe(false);
    expect(validLiquifyOptions({ ...LIQUIFY_DEFAULTS.twirl, affectIn: 'yes' })).toBe(false);
  });

  it('keeps its points on a circle when a centred Bloat grows it evenly', () => {
    const ring: CurvePath = { closed: true, nodes: Array.from({ length: 36 }, (_, i) => node(20 * Math.cos(i * Math.PI / 18), 20 * Math.sin(i * Math.PI / 18))) };
    const out = liquifyStep(ring, 'bloat', { x: 0, y: 0 }, { x: 0, y: 0 }, options);
    const radii = out.nodes.map((n) => radius(n.point));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
    expect(radii[0]).toBeGreaterThan(20);
  });
});
