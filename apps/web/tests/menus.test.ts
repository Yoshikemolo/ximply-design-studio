// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';

describe('transient menu dismissal', () => {
  let component: AppComponent;
  let cleanup: (() => void)[];
  const menu = (id: string) => document.getElementById(id) as HTMLDetailsElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <nav class="menus">
        <details id="file" open><summary><span>File</span></summary><button>Save</button></details>
        <details id="edit"><summary><span>Edit</span></summary><button>Undo</button></details>
      </nav>
      <details class="panel" id="inspector" open><summary>Properties</summary><input></details>
      <div class="tool-family"><button><span>Drawing tools</span></button></div>
      <div class="tool-flyout"><label><input id="tool-option"></label></div>
      <canvas></canvas>`;
    component = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(component, {
      recording: () => null,
      temporarySelect: signal(false),
      temporaryPan: signal(false),
      cursorPoint: signal(null),
      pointerCancel: vi.fn(),
      flyout: signal<string | null>(null),
      about: () => false,
      dialog: () => false,
      settings: () => true,
    });
    const click = (event: MouseEvent) => component.closeMenus(event);
    const pointer = (event: PointerEvent) => { component.dismissOutsideMenus(event); component.dismissToolFlyout(event); };
    const key = (event: KeyboardEvent) => component.key(event);
    const blur = () => component.resetInput();
    document.addEventListener('click', click);
    document.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    cleanup = [
      () => document.removeEventListener('click', click),
      () => document.removeEventListener('pointerdown', pointer),
      () => window.removeEventListener('keydown', key),
      () => window.removeEventListener('blur', blur),
    ];
  });

  afterEach(() => {
    cleanup.forEach(remove => remove());
    document.body.innerHTML = '';
  });

  it('closes other menus when a nested summary label is clicked', () => {
    menu('edit').querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu('file').open).toBe(false);
    expect(menu('edit').open).toBe(true);
    expect(menu('inspector').open).toBe(true);
  });

  it('dismisses outside menus even when canvas pointer handling prevents the default action', () => {
    const canvas = document.querySelector('canvas')!;
    canvas.addEventListener('pointerdown', event => event.preventDefault());
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(menu('file').open).toBe(false);
    expect(menu('inspector').open).toBe(true);
  });

  it('keeps menu commands available on pointer down and dismisses after their click handler', () => {
    const button = menu('file').querySelector('button')!;
    const command = vi.fn(() => expect(menu('file').open).toBe(true));
    button.addEventListener('click', command);
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu('file').open).toBe(true);
    button.click();
    expect(command).toHaveBeenCalledOnce();
    expect(menu('file').open).toBe(false);
  });

  it('dismisses on outside keyboard-generated clicks and Escape without collapsing panels', () => {
    document.querySelector('input')!.click();
    expect(menu('file').open).toBe(false);
    menu('file').open = true;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.querySelector('input')!.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(menu('file').open).toBe(false);
    expect(menu('inspector').open).toBe(true);
  });

  it('dismisses tool flyouts outside while preserving tool-family and flyout interactions', () => {
    component.flyout.set('draw');
    document.querySelector('.tool-family span')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(component.flyout()).toBe('draw');
    document.querySelector('#tool-option')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(component.flyout()).toBe('draw');
    document.querySelector('canvas')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(component.flyout()).toBeNull();
    expect(menu('inspector').open).toBe(true);
  });

  it('dismisses a tool flyout when a main menu is opened by keyboard-generated click', () => {
    component.flyout.set('draw');
    menu('edit').querySelector('summary')!.click();
    expect(component.flyout()).toBeNull();
    expect(menu('edit').open).toBe(true);
    expect(menu('file').open).toBe(false);
  });

  it('gives Escape priority to the tool flyout before an open main menu', () => {
    component.flyout.set('draw');
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(component.flyout()).toBeNull();
    expect(menu('file').open).toBe(true);
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    expect(menu('file').open).toBe(false);
    expect(menu('inspector').open).toBe(true);
  });

  it('dismisses transient menus on window blur and restores the tool without collapsing panels', () => {
    component.flyout.set('draw');
    component.temporarySelect.set(true);
    component.temporaryPan.set(true);
    window.dispatchEvent(new Event('blur'));
    expect(component.flyout()).toBeNull();
    expect(menu('file').open).toBe(false);
    expect(menu('inspector').open).toBe(true);
    expect(component.temporarySelect()).toBe(false);
    expect(component.temporaryPan()).toBe(false);
    expect(component.pointerCancel).toHaveBeenCalledOnce();
  });

  it('does not consume composition or shortcut recording Escape events', () => {
    component.flyout.set('draw');
    const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(composing);
    expect(menu('file').open).toBe(true);
    expect(composing.defaultPrevented).toBe(false);
    Object.assign(component, { recording: () => 'tool.select' });
    const recording = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(recording);
    expect(menu('file').open).toBe(true);
    expect(recording.defaultPrevented).toBe(false);
    expect(component.flyout()).toBe('draw');
  });
});
