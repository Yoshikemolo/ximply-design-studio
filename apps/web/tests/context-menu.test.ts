// @vitest-environment happy-dom
import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuComponent } from '../src/app/context-menu.component';

describe('context menu keyboard and pointer contract', () => {
  let host: HTMLElement;
  let menu: ContextMenuComponent;
  let opener: HTMLButtonElement;
  let buttons: HTMLButtonElement[];

  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Canvas</button><xds-context-menu><div role="menu" tabindex="-1"><button role="menuitem">Hide</button><button role="menuitem" disabled>Delete</button><button role="menuitem">Front</button></div></xds-context-menu><input id="outside">';
    opener = document.querySelector('#opener')!;
    opener.focus();
    host = document.querySelector('xds-context-menu')!;
    buttons = Array.from(host.querySelectorAll('button'));
    menu = new ContextMenuComponent(new ElementRef(host));
    menu.entries = [{ id: 'hide', label: 'Hide', section: 'object' }, { id: 'delete', label: 'Delete', section: 'object', disabled: true }, { id: 'toFront', label: 'Bring to front', section: 'arrange', shortcut: 'Ctrl+Shift+]' }];
    menu.ngAfterViewInit();
  });
  afterEach(() => { menu.ngOnDestroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('focuses the first command, skips disabled commands, wraps and restores focus', () => {
    expect(document.activeElement).toBe(buttons[0]);
    for (const [key, expected] of [['ArrowDown', 2], ['ArrowDown', 0], ['ArrowUp', 2], ['Home', 0], ['End', 2]] as const) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      menu.key(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(buttons[expected]);
    }
    const dismiss = vi.fn(); menu.dismiss.subscribe(dismiss);
    menu.key(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dismiss).toHaveBeenCalledOnce();
    menu.ngOnDestroy();
    expect(document.activeElement).toBe(opener);
  });

  it('emits exact action ids once and never invokes disabled commands', () => {
    const action = vi.fn(); const dismiss = vi.fn();
    menu.action.subscribe(action); menu.dismiss.subscribe(dismiss);
    menu.activate(menu.entries[1]);
    expect(action).not.toHaveBeenCalled();
    menu.activate(menu.entries[2]);
    menu.activate(menu.entries[0]);
    expect(action).toHaveBeenCalledExactlyOnceWith('toFront');
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps interior pointer presses open and dismisses outside without stealing input focus', () => {
    const dismiss = vi.fn(); menu.dismiss.subscribe(dismiss);
    const inside = new Event('pointerdown'); Object.defineProperty(inside, 'target', { value: buttons[0] });
    menu.outside(inside);
    expect(dismiss).not.toHaveBeenCalled();
    const input = document.querySelector('input')!;
    const outside = new Event('pointerdown'); Object.defineProperty(outside, 'target', { value: input });
    menu.outside(outside); menu.outside(outside);
    expect(dismiss).toHaveBeenCalledOnce();
    input.focus(); menu.ngOnDestroy();
    expect(document.activeElement).toBe(input);
  });

  it('clamps placement within viewport and handles menus with no available command', () => {
    vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ width: 250, height: 180 } as DOMRect);
    menu.x = window.innerWidth - 1; menu.y = window.innerHeight - 1; menu.place();
    expect(menu.position()).toEqual({ x: window.innerWidth - 258, y: window.innerHeight - 188 });
    menu.x = -100; menu.y = -100; menu.ngOnChanges();
    expect(menu.position()).toEqual({ x: 8, y: 8 });
    buttons.forEach(button => button.disabled = true);
    menu.ngAfterViewInit();
    expect(document.activeElement).toBe(host.firstElementChild);
    expect(() => menu.key(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).not.toThrow();
  });
});
