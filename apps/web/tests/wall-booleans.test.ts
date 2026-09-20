// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { parseDocument } from '../../../packages/domain/src/document';

beforeEach(() => localStorage.clear());

function crossingWalls() {
  localStorage.clear();
  const e = new EditorService();
  e.setTool('wall');
  e.start({ x: 100, y: 200 });
  e.move({ x: 400, y: 200 });
  e.end();
  e.finishWallRun();
  e.setTool('wall');
  e.start({ x: 250, y: 60 });
  e.move({ x: 250, y: 360 });
  e.end();
  e.finishWallRun();
  e.setTool('select');
  e.selectAll();
  return e;
}
const area = (points: { x: number; y: number }[]) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;

describe('boolean operations on walls', () => {
  it('unites two crossing walls into a single ordinary layer', () => {
    const e = crossingWalls();
    expect(e.document().layers).toHaveLength(2);
    e.boolean('union');
    const layers = e.document().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0].procedural).toBeUndefined();
    expect(layers[0].curves?.length).toBeGreaterThan(0);
    // A 300 by 16 wall crossing a 300 by 16 wall covers both minus the shared square.
    const painted = layers[0].curves!.reduce((sum, path) => sum + area(path.nodes.map((n) => n.point)), 0);
    expect(painted).toBeCloseTo(300 * 16 * 2 - 16 * 16, 0);
    expect(parseDocument(JSON.stringify(e.document())).layers).toHaveLength(1);
    e.undo();
    expect(e.document().layers).toHaveLength(2);
  });

  it('subtracts, intersects and excludes crossing walls', () => {
    for (const [operation, expected] of [['subtract', 300 * 16 - 16 * 16], ['intersect', 16 * 16], ['exclude', 300 * 16 * 2 - 2 * 16 * 16]] as const) {
      const e = crossingWalls();
      e.boolean(operation);
      const layers = e.document().layers;
      expect(layers).toHaveLength(1);
      const painted = layers[0].curves!.reduce((sum, path) => sum + area(path.nodes.map((n) => n.point)), 0);
      expect(painted).toBeCloseTo(expected, 0);
    }
  });

  it('still refuses to combine dimensions', () => {
    const e = crossingWalls();
    e.createDimension('linear', [{ x: 100, y: 500 }, { x: 300, y: 500 }], { x: 200, y: 460 });
    e.selectAll();
    e.boolean('union');
    expect(e.document().layers.filter((l) => l.dimension)).toHaveLength(1);
    expect(e.document().layers.length).toBeGreaterThan(1);
  });

  it('offers an icon for every action in the flyout', () => {
    const app = Object.create(AppComponent.prototype) as AppComponent;
    for (const id of ['union', 'subtract', 'intersect', 'exclude', 'alignLeft', 'alignCenterX', 'alignRight', 'alignTop', 'alignCenterY', 'alignBottom', 'distributeX', 'distributeY', 'group', 'ungroup', 'makeBlend', 'expandBlend', 'releaseBlend', 'mirrorH', 'mirrorV', 'rotateCW', 'rotateCCW', 'scaleUp', 'scaleDown']) {
      expect(app.commandIcon(id), id).not.toBe('');
    }
    expect(app.commandIcon('unknownCommand')).toBe('');
  });
});
