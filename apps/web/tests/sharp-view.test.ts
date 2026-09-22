// @vitest-environment happy-dom
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';
import { COMMANDS } from '../../../packages/domain/src/shortcuts';

/** The component on a 800 by 600 view scrolled so the page at 3x starts 200 px left of it. */
function component(zoom = 3) {
  const editor = new EditorService();
  editor.zoom.set(zoom);
  const view = { clientWidth: 800, clientHeight: 600, clientLeft: 0, clientTop: 0, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const doc = editor.document();
  const canvas = { style: { opacity: '' } as Record<string, string>, offsetLeft: 20, offsetTop: 30, getBoundingClientRect: () => ({ left: -200, top: 0, width: doc.width * editor.zoom(), height: doc.height * editor.zoom() }) };
  const detail = { style: {} as Record<string, string> };
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, { editor, canvas: { nativeElement: canvas }, viewport: { nativeElement: view }, detail: { nativeElement: detail }, pointerActive: false, detailZoom: zoom, detailHeldUntil: 0, schedule: vi.fn() });
  const draw = vi.spyOn(editor.renderer, 'draw').mockImplementation(() => undefined);
  const drawDetail = () => (app as unknown as { drawDetail: (d: unknown, ids: string[], o: unknown) => void }).drawDetail(editor.document(), [], { zoom, direct: false });
  return { app, editor, canvas, detail, draw, drawDetail };
}

describe('the sharp view of a magnified page', () => {
  it('draws the part in view at the screen resolution over the page canvas once the view is still', () => {
    const { canvas, detail, draw, drawDetail } = component();
    drawDetail();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0][7]).toEqual({ x: 200 / 3, y: 0, width: 800 / 3, height: 600 / 3, scale: 3 });
    expect(detail.style).toMatchObject({ display: 'block', left: '220px', top: '30px', width: '800px', height: '600px' });
    expect(canvas.style.opacity).toBe('0');
  });

  it('shows the fast page canvas while a gesture runs, the view moves or the zoom changes', () => {
    const { app, editor, canvas, detail, draw, drawDetail } = component();
    Object.assign(app, { pointerActive: true });
    drawDetail();
    expect(draw).not.toHaveBeenCalled();
    expect([detail.style.display, canvas.style.opacity]).toEqual(['none', '']);
    Object.assign(app, { pointerActive: false });
    app.holdDetail();
    drawDetail();
    expect(draw).not.toHaveBeenCalled();
    Object.assign(app, { detailHeldUntil: 0 });
    editor.zoom.set(2);
    drawDetail();
    expect(draw).not.toHaveBeenCalled();
  });

  it('is not drawn at 100 percent on a standard screen, nor in Pixel Preview', () => {
    const plain = component(1);
    plain.drawDetail();
    expect(plain.draw).not.toHaveBeenCalled();
    const pixels = component();
    pixels.editor.togglePixelPreview();
    pixels.drawDetail();
    expect(pixels.draw).not.toHaveBeenCalled();
    expect(pixels.detail.style.display).toBe('none');
  });
});

describe('View > Pixel Preview', () => {
  it('toggles with Alt+Ctrl+Y, as in Illustrator, and shows the pixels of the page unsmoothed', () => {
    expect(COMMANDS.find((c) => c.id === 'togglePixelPreview')?.keys).toEqual(['Mod+Alt+Y']);
    const editor = new EditorService();
    expect(editor.pixelPreview()).toBe(false);
    editor.togglePixelPreview();
    expect(editor.pixelPreview()).toBe(true);
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const view = html.slice(html.indexOf('<summary>{{ t("View") }}</summary>'));
    expect(view).toContain('(click)="editor.togglePixelPreview()"');
    expect(html).toContain('[class.pixel-preview]="editor.pixelPreview()"');
    expect(readFileSync('packages/design-system/styles/studio.scss', 'utf8')).toMatch(/canvas\.pixel-preview \{ image-rendering: pixelated; \}/);
  });
});
