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

  it('puts the selection column last by default and first when asked', () => {
    const template = readFileSync('apps/web/src/app/smart-table.component.html', 'utf-8');
    const header = template.slice(template.indexOf('<thead>'), template.indexOf('</thead>'));
    const columns = header.indexOf('@for (column of columns');
    // The export list keeps its boxes on the right; administration puts them first.
    expect(header.indexOf("selectionAt === 'start'")).toBeLessThan(columns);
    expect(header.indexOf("selectionAt === 'end'")).toBeGreaterThan(columns);
    expect(template).toContain('[indeterminate]="someChosen()"');
    const body = template.slice(template.indexOf('<tbody>'));
    expect(body.indexOf("selectionAt === 'start'")).toBeLessThan(body.indexOf('cell-value'));
    expect(body.indexOf("selectionAt === 'end'")).toBeGreaterThan(body.indexOf('cell-value'));
    expect(new SmartTableComponent().selectionAt).toBe('end');
    // A box in the first column selects without opening the row.
    expect(body).toContain('class="select-column start" (click)="$event.stopPropagation()"');
  });

  it('draws icons before values and coloured badges for toned values', () => {
    const component = new SmartTableComponent();
    const column = { key: 'tier', label: 'Tier', toneKey: 'tierTone', iconKey: 'stateIcon', iconTitleKey: 'stateTitle' };
    const row = { id: '1', tier: 'Studio', tierTone: 'studio', stateIcon: 'status-banned', stateTitle: 'Banned' };
    expect([component.tone(row, column), component.icon(row, column), component.iconTitle(row, column)]).toEqual(['studio', 'status-banned', 'Banned']);
    expect([component.tone(row, { key: 'tier', label: 'Tier' }), component.icon(row, { key: 'tier', label: 'Tier' })]).toEqual(['', '']);
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

describe('smart table search, filters, order and pages (SC-0141)', () => {
  const rows = [
    { id: '1', name: 'Ana Diaz', role: 'Admin', joined: '12 Mar', joinedAt: '2026-03-12', jobs: 4 },
    { id: '2', name: 'Luis Gil', role: 'User', joined: '1 Jan', joinedAt: '2026-01-01', jobs: 12 },
    { id: '3', name: 'Marta Ruiz', role: 'User', joined: '30 Jun', joinedAt: '2026-06-30', jobs: 0 },
    { id: '4', name: 'Aitor Sanz', role: 'User', joined: '', joinedAt: '', jobs: 7 },
  ];
  function users() {
    const component = new SmartTableComponent();
    component.columns = [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'joined', label: 'Joined', sortKey: 'joinedAt' }, { key: 'jobs', label: 'Jobs', align: 'end' }];
    component.rows = rows;
    return component;
  }
  const ids = (component: SmartTableComponent) => component.view().map((row) => row.id);

  it('keeps the rows whose text contains the search in any column, ignoring case', () => {
    const component = users();
    component.setSearch('USER');
    expect(ids(component)).toEqual(['2', '3', '4']);
    component.setSearch('ruiz');
    expect(ids(component)).toEqual(['3']);
    component.setSearch('  ');
    expect(ids(component)).toEqual(['1', '2', '3', '4']);
  });

  it('combines column filters with the search', () => {
    const component = users();
    component.setFilter('role', 'user');
    component.setFilter('name', 'a');
    // Luis Gil has no a in his name, so only Marta Ruiz and Aitor Sanz remain.
    expect(ids(component)).toEqual(['3', '4']);
    component.setSearch('marta');
    expect(ids(component)).toEqual(['3']);
    component.setFilter('missing', 'x');
    expect(ids(component)).toEqual(['3']);
  });

  it('orders by a heading, first ascending then descending, by the raw value when there is one', () => {
    const component = users();
    component.sortBy('jobs');
    expect(ids(component)).toEqual(['3', '1', '4', '2']);
    component.sortBy('jobs');
    expect(ids(component)).toEqual(['2', '4', '1', '3']);
    expect(component.ariaSort('jobs')).toBe('descending');
    // Dates order by their instant and empty values go last.
    component.sortBy('joined');
    expect(ids(component)).toEqual(['2', '1', '3', '4']);
    component.sortBy('name');
    expect(ids(component)).toEqual(['4', '1', '2', '3']);
  });

  it('gives the same order through the general choice, and none when cleared', () => {
    const component = users();
    component.setSort('jobs', 'descending');
    const general = ids(component);
    component.setSort('');
    expect(ids(component)).toEqual(['1', '2', '3', '4']);
    component.sortBy('jobs'); component.sortBy('jobs');
    expect(ids(component)).toEqual(general);
    component.setSort('name');
    expect(component.sort()).toEqual({ key: 'name', direction: 'descending' });
    component.setSort('unknown');
    expect(ids(component)).toEqual(['1', '2', '3', '4']);
  });

  it('pages the filtered and ordered rows and returns to the first page when filtering', () => {
    const component = users();
    component.pageSize = 3;
    component.sortBy('jobs');
    expect([ids(component), component.pages()]).toEqual([['3', '1', '4'], 2]);
    component.goTo(1);
    expect(ids(component)).toEqual(['2']);
    component.goTo(9);
    expect(component.page()).toBe(1);
    component.setFilter('role', 'user');
    expect([component.page(), ids(component)]).toEqual([0, ['3', '4', '2']]);
    component.pageSize = 0;
    expect(component.pages()).toBe(1);
  });

  it('activates a row only when activation is on', () => {
    const component = users();
    const activated: string[] = [];
    component.activate.subscribe((id: string) => activated.push(id));
    component.choose('2');
    component.activatable = true;
    component.choose('3');
    expect(activated).toEqual(['3']);
  });
});

describe('smart table filters after the content of each column', () => {
  const NOW = Date.parse('2026-09-24T12:00:00Z');
  const rows = [
    { id: '1', role: 'Admin', joined: '24/09/26', joinedAt: '2026-09-24T08:00:00Z', jobs: 4 },
    { id: '2', role: 'User', joined: '10/09/26', joinedAt: '2026-09-10T08:00:00Z', jobs: 12 },
    { id: '3', role: 'User', joined: '01/01/24', joinedAt: '2024-01-01T08:00:00Z', jobs: 0 },
    { id: '4', role: 'Administrator', joined: '—', joinedAt: '', jobs: 7 },
  ];
  function table() {
    const component = new SmartTableComponent();
    component.columns = [{ key: 'role', label: 'Role', filter: 'choice' }, { key: 'joined', label: 'Joined', sortKey: 'joinedAt', filter: 'period', titleKey: 'full' },
      { key: 'jobs', label: 'Jobs', filter: 'minimum' }, { key: 'note', label: 'Note', ellipsis: true }];
    component.rows = rows.map((row) => ({ ...row, full: row.joinedAt ? 'Full ' + row.joinedAt : '', note: 'A long note ' + row.id }));
    component.now = () => NOW;
    return component;
  }
  const ids = (component: SmartTableComponent) => component.view().map((row) => row.id);

  it('offers the values a column holds and keeps exact matches only', () => {
    const component = table();
    expect(component.choices(component.columns[0])).toEqual(['Admin', 'Administrator', 'User']);
    component.setFilter('role', 'Admin');
    expect(ids(component)).toEqual(['1']);
    component.setFilter('role', '');
    expect(ids(component)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps the rows of a recent period, older ones or those without a date', () => {
    const component = table();
    component.setFilter('joined', '1');
    expect(ids(component)).toEqual(['1']);
    component.setFilter('joined', '30');
    expect(ids(component)).toEqual(['1', '2']);
    component.setFilter('joined', 'older');
    expect(ids(component)).toEqual(['3']);
    component.setFilter('joined', 'never');
    expect(ids(component)).toEqual(['4']);
  });

  it('keeps the rows at or above a minimum', () => {
    const component = table();
    component.setFilter('jobs', '5');
    expect(ids(component)).toEqual(['2', '4']);
    component.setFilter('jobs', 'x');
    expect(ids(component)).toEqual(['1', '2', '3', '4']);
  });

  it('shows the full value on hover for dates and long texts only', () => {
    const component = table();
    const [first, , , fourth] = component.records();
    expect(component.title(first, component.columns[1])).toBe('Full 2026-09-24T08:00:00Z');
    expect(component.title(fourth, component.columns[1])).toBeNull();
    expect(component.title(first, component.columns[3])).toBe('A long note 1');
    expect(component.title(first, component.columns[0])).toBeNull();
  });

  it('sorts with the buttons of a heading, and a second press removes the order', () => {
    const component = table();
    component.sortDirection('jobs', 'descending');
    expect(ids(component)).toEqual(['2', '4', '1', '3']);
    component.sortDirection('jobs', 'ascending');
    expect(ids(component)).toEqual(['3', '1', '4', '2']);
    component.sortDirection('jobs', 'ascending');
    expect([component.sort(), ids(component)]).toEqual([null, ['1', '2', '3', '4']]);
  });
});
