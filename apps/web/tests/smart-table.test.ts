// @vitest-environment happy-dom
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SmartTableComponent } from '../src/app/smart-table.component';

function table(rows = [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }]) {
  const component = new SmartTableComponent();
  component.columns = [{ key: 'name', label: 'Document', noteKey: 'note' }];
  component.rows = rows;
  component.selectable = true;
  return component;
}

describe('smart table', () => {
  it('reports every change of the selection and keeps it in step with the rows', () => {
    const component = table();
    const emitted: string[][] = [];
    component.selectedChange.subscribe((value: string[]) => emitted.push(value));
    expect(component.isChosen('a')).toBe(false);
    component.toggle('a', true);
    expect(component.isChosen('a')).toBe(true);
    expect(emitted.at(-1)).toEqual(['a']);
    // Choosing the same row twice does not repeat it.
    component.toggle('a', true);
    expect(emitted.at(-1)).toEqual(['a']);
    component.toggle('a', false);
    expect(emitted.at(-1)).toEqual([]);
  });

  it('answers whether all or only some rows are chosen', () => {
    const component = table();
    expect(component.allChosen()).toBe(false);
    expect(component.someChosen()).toBe(false);
    component.toggle('a', true);
    expect(component.someChosen()).toBe(true);
    expect(component.allChosen()).toBe(false);
    component.toggle('b', true);
    expect(component.allChosen()).toBe(true);
    expect(component.someChosen()).toBe(false);
    component.toggleAll(false);
    expect(component.chosen()).toEqual([]);
    component.toggleAll(true);
    expect(component.chosen()).toEqual(['a', 'b']);
    // An empty table is not "all chosen".
    const empty = table([]);
    expect(empty.allChosen()).toBe(false);
  });

  it('reads the value and the note of each column from the row', () => {
    const component = table([{ id: 'a', name: 'First', note: 'Current' }]);
    const column = component.columns[0];
    expect(component.value(component.records()[0], 'name')).toBe('First');
    expect(component.note(component.records()[0], column)).toBe('Current');
    expect(component.note(component.records()[0], { key: 'name', label: 'Document' })).toBe('');
  });

  it('puts the values first and the selection column last', () => {
    const template = readFileSync('apps/web/src/app/smart-table.component.html', 'utf-8');
    const header = template.slice(template.indexOf('<thead>'), template.indexOf('</thead>'));
    // The selection column is rendered after the data columns, so the boxes sit on the right.
    expect(header.indexOf('@for (column of columns')).toBeLessThan(header.indexOf('select-column'));
    expect(template).toContain('[indeterminate]="someChosen()"');
    const body = template.slice(template.indexOf('<tbody>'));
    expect(body.indexOf('cell-value')).toBeLessThan(body.indexOf('select-column'));
  });

  it('is what the export dialog lists its documents with', () => {
    const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
    const start = template.indexOf('export-dialog');
    const dialog = template.slice(start, template.indexOf('</form></div>', start));
    expect(dialog).toContain('<xds-smart-table');
    expect(dialog).toContain('[selectable]="true"');
    expect(dialog).toContain('(selectedChange)="exportTabs.set($event)"');
    expect(dialog).not.toContain('toggleExportTab');
  });
});
