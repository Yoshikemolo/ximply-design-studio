import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';

/**
 * A generic table for the lists of the shell. It renders rows of data with optional
 * multiple selection, so the same component serves the export document list today and
 * any other list of records later. The table owns the layout and the selection rules;
 * what a row means belongs to whoever fills it.
 */
export interface SmartTableColumn {
  /** Key of the value in the row record. */
  key: string;
  /** Column heading, already translated by the caller. */
  label: string;
  align?: 'start' | 'end';
  /** Secondary text shown beside the value, such as a tag for the current document. */
  noteKey?: string;
}
export interface SmartTableRow {
  id: string;
  /** Rows of a table are plain records; the columns say which keys are shown. */
  [key: string]: unknown;
}

@Component({
  selector: 'xds-smart-table',
  standalone: true,
  templateUrl: './smart-table.component.html',
})
export class SmartTableComponent {
  @Input({ required: true }) columns: readonly SmartTableColumn[] = [];
  @Input({ required: true }) set rows(value: readonly SmartTableRow[]) { this.records.set([...value]); }
  /** Multiple selection is a feature of the table: the column appears only when it is on. */
  @Input() selectable = false;
  @Input() set selected(value: readonly string[]) { this.chosen.set([...value]); }
  @Input() label = '';
  @Input() selectionLabel = 'Select';
  @Input() selectAllLabel = 'Select all';
  @Output() readonly selectedChange = new EventEmitter<string[]>();

  readonly records = signal<SmartTableRow[]>([]);
  readonly chosen = signal<string[]>([]);
  readonly allChosen = computed(() => {
    const rows = this.records();
    return rows.length > 0 && rows.every((row) => this.chosen().includes(row.id));
  });
  /** True while some but not all rows are chosen, which the header box shows as mixed. */
  readonly someChosen = computed(() => this.chosen().length > 0 && !this.allChosen());

  isChosen(id: string) { return this.chosen().includes(id); }
  value(row: SmartTableRow, key: string) { return String(row[key] ?? ''); }
  note(row: SmartTableRow, column: SmartTableColumn) {
    return column.noteKey ? String(row[column.noteKey] ?? '') : '';
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
}
