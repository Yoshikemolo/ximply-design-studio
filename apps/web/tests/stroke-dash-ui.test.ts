// @vitest-environment happy-dom
import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { EditorService } from '../src/app/editor.service';

beforeEach(() => localStorage.clear());
function component() {
  const editor = new EditorService();
  const app = Object.create(AppComponent.prototype) as AppComponent;
  Object.assign(app, { editor, usesStyleDefaults: () => true });
  return { app, editor };
}
const change = (value: string) => ({ target: { value } }) as unknown as Event;

describe('line type control', () => {
  it('starts solid and applies each preset sequence', () => {
    const { app, editor } = component();
    expect(app.dashPreset()).toBe('solid');
    expect(app.dashPattern()).toEqual([]);
    app.setDashPreset('dashed');
    expect(editor.strokeStyle().dash).toEqual([12, 6]);
    expect(app.dashPreset()).toBe('dashed');
    app.setDashPreset('axis');
    expect(app.dashPattern()).toEqual([24, 6, 4, 6]);
    app.setDashPreset('solid');
    expect(app.dashPattern()).toEqual([]);
    expect(app.dashPreset()).toBe('solid');
  });

  it('shows the preset values as placeholders and only for a named preset', () => {
    const { app } = component();
    app.setDashPreset('dotted');
    expect([0, 1, 2].map((i) => app.dashPlaceholder(i))).toEqual([1, 4, '']);
    app.setDashValue(0, change('9'));
    expect(app.dashPreset()).toBe('custom');
    expect(app.dashPlaceholder(0)).toBe('');
  });

  it('edits single lengths, shortens the sequence and refuses invalid input', () => {
    const { app } = component();
    app.setDashPreset('axis');
    app.setDashValue(3, change('10'));
    expect(app.dashPattern()).toEqual([24, 6, 4, 10]);
    app.setDashValue(2, change(''));
    expect(app.dashPattern()).toEqual([24, 6]);
    app.setDashValue(1, change('-3'));
    app.setDashValue(1, change('2000'));
    app.setDashValue(1, change('abc'));
    expect(app.dashPattern()).toEqual([24, 6]);
    app.setDashValue(0, change('0'));
    expect(app.dashPattern()).toEqual([]);
  });
});
