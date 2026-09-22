import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
const about = html.slice(html.indexOf('class="about-dialog"'), html.indexOf('</section>\n  </div>', html.indexOf('class="about-dialog"')));

describe('the about screen', () => {
  it('shows the logo of the header beside the name of the product', () => {
    const brand = about.slice(about.indexOf('class="about-brand"'), about.indexOf('id="about-title"'));
    expect(brand).toContain('src="/assets/icons/ximplicity-x.svg"');
  });

  it('shows the SHA-256 of the licence the build carries, counted with LF line endings', () => {
    expect(about).toContain('licence.sha256');
    const data = JSON.parse(readFileSync('apps/web/public/assets/changelog/index.json', 'utf8'));
    const text = readFileSync('LICENSE', 'utf8').replace(/\r\n/g, '\n');
    expect(data.licence.sha256).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(data.licence.name).toBe(text.split('\n')[0].trim());
  });

  it('ends with the credits of the footer, the same template the footer uses', () => {
    expect(about).toContain('<footer class="about-credits"><ng-container *ngTemplateOutlet="footerCredits">');
    const credits = html.slice(html.indexOf('<ng-template #footerCredits>'), html.indexOf('</ng-template>', html.indexOf('<ng-template #footerCredits>')));
    for (const icon of ['linkedin.svg', 'ximplicity.svg', 'github.svg']) expect(credits).toContain(icon);
    expect(credits).toContain('Jorge Rodriguez Rengel');
  });
});

describe('an empty page', () => {
  it('shows the brand of the header above its call to action instead of a blue x', () => {
    const welcome = html.slice(html.indexOf('class="canvas-welcome"'), html.indexOf('Try a sample'));
    expect(welcome).toContain('class="welcome-brand"');
    expect(welcome).toContain('/assets/icons/ximplicity-x.svg');
    expect(welcome).toContain('design studio');
    expect(welcome).not.toContain('welcome-mark');
  });

  it('keeps the name, the licence and the version picker above the line and the credits at the foot, scrolling only the notes', () => {
    const head = about.slice(about.indexOf('class="about-head"'), about.indexOf('class="release-notes"'));
    expect(head).toContain('id="about-title"');
    expect(head).toContain('class="licence-hash"');
    expect(head).toContain('aria-label="Release version"');
    expect(about.indexOf('class="release-notes"')).toBeLessThan(about.indexOf('class="about-credits"'));
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    expect(styles).toMatch(/\.about-dialog \{\s*display: flex;\s*flex-direction: column;\s*overflow: hidden;/);
    expect(styles).toMatch(/\.about-head \{[^}]*border-bottom: 1px solid var\(--border\);/);
    expect(styles).toMatch(/\.about-dialog > \.release-notes \{[^}]*overflow-y: auto;/);
    expect(styles).toMatch(/@media \(max-height: 560px\) \{\s*\.about-dialog \{ overflow-y: auto; \}/);
  });
});
