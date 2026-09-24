import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';

/**
 * A generic table for the lists of the shell. It renders rows of data with optional
 * multiple selection, a global search, a filter per column, sorting by any column, paging
 * and activation of a row, so the same component serves the export document list and the
 * tables of administration (SC-0141). The table owns the layout, the selection, the
 * filtering and the ordering; what a row means belongs to whoever fills it.
 */
export interface SmartTableColumn {
  /** Key of the value in the row record. */
  key: string;
  /** Column heading, already translated by the caller. */
  label: string;
  align?: 'start' | 'end';
  /** Secondary text shown beside the value, such as a tag for the current document. */
  noteKey?: string;
  /** Key of a raw value to sort by, such as an instant behind a formatted date. */
  sortKey?: string;
  /**
   * How the column is filtered, after its content: free text, a choice among the values it
   * holds, a recent period for instants (read from sortKey) or a minimum for numbers.
   */
  filter?: 'text' | 'choice' | 'period' | 'minimum';
  /** Key of the text shown on hover, such as the full date, time and zone of a short date. */
  titleKey?: string;
  /** Long values end in an ellipsis; the full value shows on hover. */
  ellipsis?: boolean;
  /** Key of an icon name shown before the value, such as the state of an account, and of its tooltip. */
  iconKey?: string;
  iconTitleKey?: string;
  /** Key of a tone that draws the value as a coloured badge, such as the tier of a licence. */
  toneKey?: string;
}
/** The periods a date column can be filtered by, in days back from now; never keeps rows without a date. */
export const PERIODS = [
  { id: '1', label: 'Last 24 hours' }, { id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' },
  { id: '365', label: 'Last year' }, { id: 'older', label: 'Older than a year' }, { id: 'never', label: 'Never' },
] as const;
export interface SmartTableRow {
  id: string;
  /** Rows of a table are plain records; the columns say which keys are shown. */
  [key: string]: unknown;
}
export type SortDirection = 'ascending' | 'descending';

@Component({
  selector: 'xds-smart-table',
  standalone: true,
  templateUrl: './smart-table.component.html',
})
export class SmartTableComponent {
  @Input({ required: true }) set columns(value: readonly SmartTableColumn[]) { this.headers.set([...value]); }
  get columns(): readonly SmartTableColumn[] { return this.headers(); }
  @Input({ required: true }) set rows(value: readonly SmartTableRow[]) { this.records.set([...value]); }
  /** Multiple selection is a feature of the table: the column appears only when it is on. */
  @Input() selectable = false;
  /** Where the selection column sits: last, as in the export list, or first, as in administration. */
  @Input() selectionAt: 'start' | 'end' = 'end';
  @Input() set selected(value: readonly string[]) { this.chosen.set([...value]); }
  @Input() label = '';
  @Input() selectionLabel = 'Select';
  @Input() selectAllLabel = 'Select all';
  /** A search box above the table that keeps the rows containing its text in any column. */
  @Input() searchable = false;
  /** A filter under each heading that keeps the rows whose value contains its text. */
  @Input() filterable = false;
  /** Headings that order the rows, and a general choice of the order above the table. */
  @Input() sortable = false;
  /** Rows per page; zero shows every row. */
  @Input() set pageSize(value: number) { this.size.set(Math.max(0, Math.floor(value || 0))); }
  /** Rows that can be activated, to edit them beside the table. */
  @Input() activatable = false;
  @Input() activeId: string | null = null;
  @Input() searchLabel = 'Search';
  @Input() filterLabel = 'Filter';
  @Input() sortLabel = 'Sort by';
  @Input() unsortedLabel = 'No order';
  @Input() ascendingLabel = 'Ascending';
  @Input() descendingLabel = 'Descending';
  @Input() emptyLabel = '';
  @Input() previousLabel = 'Previous page';
  @Input() nextLabel = 'Next page';
  @Input() anyLabel = 'Any';
  @Input() minimumLabel = 'At least';
  /** Translates the fixed words the table shows, such as the periods of a date filter. */
  @Input() translate: (text: string) => string = (text) => text;
  /** The clock date filters compare with; tests give their own. */
  @Input() now: () => number = () => Date.now();
  readonly periods = PERIODS;
  @Output() readonly selectedChange = new EventEmitter<string[]>();
  @Output() readonly activate = new EventEmitter<string>();

  readonly headers = signal<SmartTableColumn[]>([]);
  readonly records = signal<SmartTableRow[]>([]);
  readonly chosen = signal<string[]>([]);
  readonly search = signal('');
  readonly filters = signal<Record<string, string>>({});
  readonly sort = signal<{ key: string; direction: SortDirection } | null>(null);
  readonly size = signal(0);
  readonly page = signal(0);

  readonly allChosen = computed(() => {
    const rows = this.records();
    return rows.length > 0 && rows.every((row) => this.chosen().includes(row.id));
  });
  /** True while some but not all rows are chosen, which the header box shows as mixed. */
  readonly someChosen = computed(() => this.chosen().length > 0 && !this.allChosen());

  /** The rows that pass the search and the column filters, in the chosen order. */
  readonly matching = computed(() => {
    const columns = this.headers();
    const term = this.search().trim().toLowerCase();
    const filters = Object.entries(this.filters()).filter(([, text]) => text.trim()).map(([key, text]) => [key, text.trim().toLowerCase()] as const);
    const rows = this.records().filter((row) =>
      (!term || columns.some((column) => this.text(row, column).includes(term)))
      && filters.every(([key, text]) => {
        const column = columns.find((item) => item.key === key);
        return !column || this.passes(row, column, text);
      }));
    const sort = this.sort();
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column) return rows;
    const sign = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => sign * this.compare(this.sortValue(a, column), this.sortValue(b, column)));
  });
  readonly pages = computed(() => (this.size() ? Math.max(1, Math.ceil(this.matching().length / this.size())) : 1));
  /** The rows shown: the current page of the matching rows. */
  readonly view = computed(() => {
    const size = this.size();
    if (!size) return this.matching();
    const page = Math.min(this.page(), this.pages() - 1);
    return this.matching().slice(page * size, page * size + size);
  });

  isChosen(id: string) { return this.chosen().includes(id); }
  icon(row: SmartTableRow, column: SmartTableColumn) { return column.iconKey ? String(row[column.iconKey] ?? '') : ''; }
  iconTitle(row: SmartTableRow, column: SmartTableColumn) { return column.iconTitleKey ? String(row[column.iconTitleKey] ?? '') : ''; }
  tone(row: SmartTableRow, column: SmartTableColumn) { return column.toneKey ? String(row[column.toneKey] ?? '') : ''; }
  value(row: SmartTableRow, key: string) { return String(row[key] ?? ''); }
  note(row: SmartTableRow, column: SmartTableColumn) {
    return column.noteKey ? String(row[column.noteKey] ?? '') : '';
  }
  private text(row: SmartTableRow, column: SmartTableColumn) {
    return (this.value(row, column.key) + ' ' + this.note(row, column)).toLowerCase();
  }
  /** Whether a row passes the filter of a column, after the kind of filter the column has. */
  private passes(row: SmartTableRow, column: SmartTableColumn, filter: string): boolean {
    if (column.filter === 'choice') return this.value(row, column.key).toLowerCase() === filter;
    if (column.filter === 'minimum') {
      const minimum = Number(filter), value = Number(this.sortValue(row, column));
      return !Number.isFinite(minimum) || (Number.isFinite(value) && value >= minimum);
    }
    if (column.filter === 'period') {
      const raw = this.sortValue(row, column), instant = raw ? Date.parse(String(raw)) : NaN;
      if (filter === 'never') return Number.isNaN(instant);
      if (Number.isNaN(instant)) return false;
      const age = this.now() - instant, day = 86_400_000;
      return filter === 'older' ? age > 365 * day : age <= Number(filter) * day;
    }
    return this.text(row, column).includes(filter);
  }
  /** The values a choice filter offers: those the column holds, in order. */
  choices(column: SmartTableColumn): string[] {
    return [...new Set(this.records().map((row) => this.value(row, column.key)).filter((value) => value))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  filterValue(key: string) { return this.filters()[key] ?? ''; }
  title(row: SmartTableRow, column: SmartTableColumn) {
    if (column.titleKey) return String(row[column.titleKey] ?? '') || null;
    return column.ellipsis ? this.value(row, column.key) || null : null;
  }
  private sortValue(row: SmartTableRow, column: SmartTableColumn): unknown {
    return row[column.sortKey ?? column.key];
  }
  /** Numbers by value, empty values last, text in the order of the language. */
  private compare(a: unknown, b: unknown) {
    const empty = (value: unknown) => value === null || value === undefined || value === '';
    if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  toggle(id: string, checked: boolean) {
    const next = checked ? [...new Set([...this.chosen(), id])] : this.chosen().filter((entry) => entry !== id);
    this.chosen.set(next);
    this.selectedChange.emit(next);
  }
  toggleAll(checked: boolean) {
    const next = checked ? this.records().map((row) => row.id) : [];
    this.chosen.set(next);
    this.selectedChange.emit(next);
  }
  setSearch(text: string) { this.search.set(text); this.page.set(0); }
  setFilter(key: string, text: string) {
    const column = this.headers().find((item) => item.key === key);
    this.filters.update((filters) => ({ ...filters, [key]: column?.filter === 'choice' ? text.toLowerCase() : text }));
    this.page.set(0);
  }
  /** A heading orders by its column, first ascending, then descending. */
  sortBy(key: string) {
    const current = this.sort();
    this.sort.set({ key, direction: current?.key === key && current.direction === 'ascending' ? 'descending' : 'ascending' });
  }
  /** The buttons of a heading set its direction; pressing the active one again removes the order. */
  sortDirection(key: string, direction: SortDirection) {
    const current = this.sort();
    this.sort.set(current?.key === key && current.direction === direction ? null : { key, direction });
  }
  /** The general order above the table: a column and a direction, or no order. */
  setSort(key: string, direction: SortDirection = this.sort()?.direction ?? 'ascending') {
    this.sort.set(key ? { key, direction } : null);
  }
  ariaSort(key: string) {
    const sort = this.sort();
    return sort?.key === key ? sort.direction : 'none';
  }
  goTo(page: number) { this.page.set(Math.max(0, Math.min(page, this.pages() - 1))); }
  choose(id: string) { if (this.activatable) this.activate.emit(id); }
}
