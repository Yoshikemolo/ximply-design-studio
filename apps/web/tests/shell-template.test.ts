import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_FAMILIES } from '../src/app/tools';

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

  it('shows the mode badge, Demo or Pro, after the logo as a button into the local service settings', () => {
    const badge = section('class="preview-badge"', '</button>');
    expect(badge).toContain('(click)="openServerSettings()"');
    expect(badge).toContain('session.licensed() ? "Pro" : "Demo"');
    expect(template.indexOf('class="preview-badge"')).toBeGreaterThan(template.indexOf('class="brand"'));
    expect(template.indexOf('class="preview-badge"')).toBeLessThan(template.indexOf('<nav class="menus"'));
    expect(badge).toContain('[title]="modeExplanation()"');
  });

  it('names every typography measure by an icon and a tooltip, in line with its control', () => {
    const fields = section("<div class=\"property-grid typography-fields\">", "t('Text language')");
    const icons = ['text-size', 'text-weight', 'text-leading', 'text-letter-spacing', 'text-word-spacing',
      'text-paragraph-spacing', 'text-baseline-shift', 'text-horizontal-scale', 'text-vertical-scale'];
    for (const icon of icons) expect(existsSync(`apps/web/public/assets/icons/${icon}.svg`)).toBe(true);
    for (const icon of ['text-size', 'text-weight', 'text-horizontal-scale', 'text-vertical-scale']) {
      expect(fields).toContain(`/assets/icons/${icon}.svg`);
    }
    expect(fields).toContain("[title]=\"t('Size')\"");
    expect(fields).toContain("[title]=\"t(field.label) + ' · ' + t(field.hint)\"");
    // The name is carried by the tooltip and the accessible name, not by visible text.
    expect(fields).not.toContain(">{{ t('Size') }}<");
    expect(fields).toContain("[attr.aria-label]=\"t(field.label)\"");
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf-8');
    const rule = styles.slice(styles.indexOf('.typography-fields label {'), styles.indexOf('.typography-note'));
    expect(rule).toContain('flex-direction: row');
    expect(rule).toContain('align-items: center');
    expect(rule).toContain('.typography-fields .field-icon');
  });

  it('keeps every dropdown on the theme colors so its option list is never white', () => {
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf-8');
    const start = styles.indexOf('optgroup {');
    const options = styles.slice(start, styles.indexOf('}', start));
    expect(options).toContain('background-color: var(--panel-raised)');
    expect(options).toContain('color: var(--text)');
    // No select may fall back to the browser colors by painting no background of its own.
    const transparent = [...styles.matchAll(/select[^{]*\{[^}]*\}/g)].filter((match) => /background(-color)?:\s*(none|transparent)/.test(match[0]));
    expect(transparent).toEqual([]);
  });

  it('lays out every panel header the same way, chevron and name first', () => {
    // Each panel header carries its name in an element, so none of them drifts to the right edge.
    for (const name of ['t("Drawing tools")', "t('Blend objects')"]) {
      expect(template).toContain(`<summary><span>{{ ${name} }}</span></summary>`);
    }
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf-8');
    const header = styles.slice(styles.indexOf('.panel > summary,'), styles.indexOf('.panel-grip {'));
    expect(header).toContain('align-items: center');
    expect(header).not.toContain('justify-content: space-between');
    expect(header).toContain('/assets/icons/panel-chevron.svg');
    expect(header).toContain('margin-left: auto');
    // An open panel is closed off by a rule, and its header sits on the raised band.
    expect(header).toContain('background: var(--panel-raised)');
    expect(header).toContain('.panel[open] > summary {');
    expect(existsSync('apps/web/public/assets/icons/panel-chevron.svg')).toBe(true);
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
    const group = section("t('Snap to ruler ticks')", '</div>');
    expect(group).toContain("t('Major')");
    expect(group).toContain("t('Minor')");
    expect((group.match(/toggle-switch/g) ?? []).length).toBe(2);
    expect(template).not.toContain("t('Snap major ruler ticks')");
  });

  it('shows the painting controls with each field where it applies', () => {
    const bar = section('brush-controls', '</section>');
    for (const field of ["t('Pressure')", "t('Opacity')", "t('Cadence')", "t('Diffusion')", "t('Speed variation')"]) expect(bar).toContain(field);
    // The eraser always removes paint, and a round tip has no angle, so both fields are conditional.
    expect(bar.slice(bar.indexOf("t('Blend')") - 140, bar.indexOf("t('Blend')"))).toContain("painting === 'brush'");
    expect(bar.slice(bar.indexOf("t('Tip angle')") - 140, bar.indexOf("t('Tip angle')"))).toContain("brush().type !== 'round'");
    expect(bar).toContain('class="brush-preview"');
    expect(bar).toContain('speed-mark small');
    expect(bar).toContain('speed-mark large');
  });

  it('keeps the workspace choice in the header and the brush appearance on fill alone', () => {
    const header = section('<header class="menubar">', '</header>');
    expect(header).toContain('class="header-workspace"');
    expect(header.indexOf('header-workspace')).toBeLessThan(header.indexOf('class="language"'));
    const appearance = section("t('Appearance')", "t('Style transfer scope')");
    expect(appearance).toContain("editor.tool() === 'brush' ? fillOnly : paintTargets");
  });

  it('keeps one icon per Bézier and brush subtool', () => {
    for (const id of ['pen', 'addAnchor', 'deleteAnchor', 'convertAnchor', 'brush', 'brushFlat', 'brushCalligraphy', 'brushMarker', 'brushAirbrush', 'brushPencil']) {
      const tool = TOOLS.find((entry) => entry.id === id)!;
      expect(tool, id).toBeDefined();
      expect(existsSync(`apps/web/public/assets/icons/${tool.icon}.svg`), tool.icon).toBe(true);
    }
    expect(TOOLS.find((tool) => tool.id === 'pen')!.label).toBe('Bézier');
    expect(TOOL_FAMILIES.find((family) => family.id === 'pen')!.label).toBe('Bézier tools');
  });
});
