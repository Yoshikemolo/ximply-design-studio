// @vitest-environment happy-dom
import '@angular/compiler';
import { ElementRef, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';

const categories = [
  { id: 'cursor', label: 'Cursor', icon: 'select' },
  { id: 'selection', label: 'Selection and transforms', icon: 'direct' },
  { id: 'measurement', label: 'Units and snapping', icon: 'rulers' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard' },
] as const;

describe('settings category keyboard navigation', () => {
  let app: AppComponent;
  const tab = (id: string) => document.getElementById('settings-tab-' + id)!;
  const key = (element: HTMLElement, value: string) => {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  };
  beforeEach(() => {
    app = Object.create(AppComponent.prototype) as AppComponent;
    Object.assign(app, { settings: signal(false), settingsCategory: signal('cursor'), recording: signal(null), settingsCategories: categories });
    document.body.innerHTML = categories.map(category => `<button id="settings-tab-${category.id}">${category.label}</button>`).join('') + '<section id="settings-panel" tabindex="0"><input></section>';
    categories.forEach((category, index) => tab(category.id).addEventListener('keydown', event => app.settingsNavKey(event as KeyboardEvent, index)));
    document.getElementById('settings-panel')!.addEventListener('keydown', event => app.settingsPanelKey(event as KeyboardEvent));
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('automatically selects and focuses adjacent tabs, wraps, and stops shortcut recording', () => {
    app.recording.set('tool.pen'); tab('cursor').focus();
    expect(key(tab('cursor'), 'ArrowDown').defaultPrevented).toBe(true);
    expect(app.settingsCategory()).toBe('selection'); expect(document.activeElement).toBe(tab('selection')); expect(app.recording()).toBeNull();
    key(tab('selection'), 'Home'); expect(document.activeElement).toBe(tab('cursor'));
    key(tab('cursor'), 'ArrowUp'); expect(app.settingsCategory()).toBe('shortcuts'); expect(document.activeElement).toBe(tab('shortcuts'));
    key(tab('shortcuts'), 'ArrowDown'); expect(app.settingsCategory()).toBe('cursor');
    key(tab('cursor'), 'End'); expect(app.settingsCategory()).toBe('shortcuts');
  });

  it('moves between navigation and panel without consuming input arrow keys or Tab', () => {
    app.selectSettingsCategory('measurement'); tab('measurement').focus();
    key(tab('measurement'), 'ArrowRight'); expect(document.activeElement).toBe(document.getElementById('settings-panel'));
    key(document.activeElement as HTMLElement, 'ArrowLeft'); expect(document.activeElement).toBe(tab('measurement'));
    const input = document.querySelector('input')!; input.focus();
    expect(key(input, 'ArrowLeft').defaultPrevented).toBe(false); expect(document.activeElement).toBe(input);
    expect(key(tab('measurement'), 'Tab').defaultPrevented).toBe(false);
  });

  it('cancels capture, resets panel scrolling, and focuses only when the navigation view mounts', () => {
    app.recording.set('tool.pen');
    const panel = document.getElementById('settings-panel')!; panel.scrollTop = 300;
    app.selectSettingsCategory('shortcuts');
    expect(app.recording()).toBeNull(); expect(panel.scrollTop).toBe(0);
    expect(app.activeSettingsCategory().label).toBe('Keyboard shortcuts');
    const input = document.querySelector('input')!; input.focus();
    app.openSettings(); expect(document.activeElement).toBe(input);
    app.settingsNavHost = new ElementRef(document.body);
    expect(app.settings()).toBe(true); expect(document.activeElement).toBe(tab('shortcuts'));
    app.recording.set('tool.pen'); app.selectSettingsCategory('cursor'); expect(app.recording()).toBeNull();
  });

  it('does not steal focus after closing or when the navigation view is destroyed', () => {
    const input = document.querySelector('input')!; input.focus();
    app.openSettings(); app.settings.set(false);
    app.settingsNavHost = new ElementRef(document.body);
    expect(document.activeElement).toBe(input);
    app.settingsNavHost = undefined; expect(document.activeElement).toBe(input);
  });
});
