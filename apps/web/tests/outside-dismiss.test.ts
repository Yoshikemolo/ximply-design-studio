// @vitest-environment happy-dom
import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { readFileSync } from 'node:fs';
import { AppComponent } from '../src/app/app.component';

function component() {
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, {
    paintPicker: signal({ x: 0, y: 0 }), flyout: signal('pen'), nativeColorPicking: false,
    dismissMenus: vi.fn(), mobile: signal(false), startLongPress: vi.fn(), swipeStart: null,
  });
  return app;
}
const pressOn = (element: Element) => ({ target: element, pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 }) as unknown as PointerEvent;

describe('a press outside', () => {
  it('closes the appearance popover and the list of a tool family with one listener', () => {
    const app = component();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    app.documentPointerDown(pressOn(canvas));
    expect(app.paintPicker()).toBeNull();
    expect(app.flyout()).toBeNull();
    canvas.remove();
    // Every press goes through the one listener of the page.
    const source = readFileSync('apps/web/src/app/app.component.ts', 'utf8');
    expect(source.match(/HostListener\("document:pointerdown"/g)).toHaveLength(1);
  });

  it('leaves the popover open for a press inside it', () => {
    const app = component();
    const popover = document.createElement('section');
    popover.className = 'paint-popover';
    const field = document.createElement('input');
    popover.appendChild(field);
    document.body.appendChild(popover);
    app.documentPointerDown(pressOn(field));
    expect(app.paintPicker()).not.toBeNull();
    popover.remove();
  });

  it('leaves the popover open while the eyedropper of the colour picker takes a colour from the page', () => {
    const app = component();
    app.nativeColorPicking = true;
    app.documentPointerDown(pressOn(document.body));
    expect(app.paintPicker()).not.toBeNull();
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const popover = html.slice(html.indexOf('<section #paintPopover'), html.indexOf('</section>', html.indexOf('<section #paintPopover')));
    expect(popover.match(/type="color" \(click\)="nativeColorPicking = true"/g)?.length).toBe(popover.match(/type="color"/g)?.length);
  });
});
