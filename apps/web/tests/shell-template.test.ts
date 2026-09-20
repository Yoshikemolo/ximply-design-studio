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

  it('shows the local preview badge as a button into the local service settings', () => {
    const badge = section('class="preview-badge"', '</button>');
    expect(badge).toContain('(click)="openServerSettings()"');
    expect(badge).toContain("t('Local preview explanation')");
  });

  it('gives the dimension lock the same styled toggle as the guide lock', () => {
    expect(template).toContain('class="dimension-lock"');
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf-8');
    expect(styles).toContain('.guide-lock.active, .dimension-lock.active');
  });
});
