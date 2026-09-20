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

  it('keeps switch controls at switch proportions inside label rows', () => {
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf-8');
    const rule = styles.slice(styles.indexOf('.wide-label input.toggle-switch'), styles.indexOf('.toggle-switch::after'));
    expect(rule).toContain('max-width: 34px');
    expect(rule).toContain('flex: 0 0 auto');
    expect(template).toContain('class="toggle-switch"');
  });

  it('groups opening leaves in their own block with short field names', () => {
    const leaves = section("<div class=\"section-label\">{{ t('Leaves') }}</div>", 'Changing a leaf width');
    expect(leaves).toContain("t('Number')");
    expect(leaves).toContain('class="leaf-rows"');
    expect(leaves).toContain("t('Type')");
    expect(leaves).not.toContain("t('Number of leaves')");
    expect(template).not.toContain("t('Leaf type')");
    for (const field of ["t('Angle')", "t('Hinge')", "t('Opening')"]) expect(template).toContain(field);
  });

  it('groups both ruler tick switches under one settings label', () => {
    const group = section('class="tick-snapping"', '</div>');
    expect(group).toContain("t('Snap to ruler ticks')");
    expect(group).toContain("t('Major')");
    expect(group).toContain("t('Minor')");
    expect((group.match(/toggle-switch/g) ?? []).length).toBe(2);
    expect(template).not.toContain("t('Snap major ruler ticks')");
  });
});
