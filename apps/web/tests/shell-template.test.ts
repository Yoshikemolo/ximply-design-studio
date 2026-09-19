import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
const section = (start: string, end: string) => template.slice(template.indexOf(start), template.indexOf(end, template.indexOf(start)));

describe('shell template', () => {
  it('keeps only the overlapping fill and stroke squares in the tool rail palette', () => {
    const palette = section('<div class="rail-palette"', '</aside>');
    expect(palette).toContain('paint-trigger');
    expect(palette).toContain('swap-paint');
    expect(palette).not.toContain('quick-paints');
    expect(palette).not.toContain('rail-width');
  });

  it('offers Clear in the File menu and renders one tab per open document', () => {
    const file = section('<summary>{{ t("File") }}</summary>', '</details>');
    expect(file).toContain('(click)="newDocument()"');
    expect(file).toContain('(click)="clearDocument()"');
    const tabs = section('<div class="document-tabs"', '<div class="header-spacer">');
    expect(tabs).toContain('@for (tab of editor.tabs(); track tab.id)');
    expect(tabs).toContain('closeDocument(tab.id)');
    expect(template).not.toMatch(/\bconfirm\(\s*["']/);
  });
});
