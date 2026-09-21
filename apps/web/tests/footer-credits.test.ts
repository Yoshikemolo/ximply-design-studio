// @vitest-environment happy-dom
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const template = readFileSync('apps/web/src/app/app.component.html', 'utf-8');
const footer = template.slice(template.indexOf('<footer>'), template.indexOf('</footer>'));

describe('footer credits', () => {
  it('carries the credits, the version and the links, in that order', () => {
    expect(footer.indexOf('class="credits"')).toBeGreaterThan(-1);
    expect(footer.indexOf('class="credits"')).toBeLessThan(footer.indexOf('class="version"'));
    expect(footer.indexOf('class="version"')).toBeLessThan(footer.indexOf('class="socials"'));
    // The copyright names the company and the author, each one a link of its own.
    expect(footer).toContain('&copy; {{ year }}');
    expect(footer).toContain('>Ximplicity Software Solutions</a');
    expect(footer).toContain('by Jorge Rodriguez Rengel');
    expect(footer).toContain('>Yoshikemolo</a');
    expect(footer).toContain("t(\"All Rights Reserved.\")");
  });

  it('keeps the version and the about screen working', () => {
    // The version is the button that opens the about screen, and it names this product.
    expect(footer).toContain('XIMPLY DESIGN STUDIO v{{ currentVersion() }}');
    expect(footer).toContain('(click)="openAbout()"');
    expect(footer).not.toContain('EVIDENT');
    const source = readFileSync('apps/web/src/app/app.component.ts', 'utf-8');
    expect(source).toContain('readonly year = new Date().getFullYear();');
  });

  it('links LinkedIn, Ximplicity and the repository, each in its own tab', () => {
    const socials = footer.slice(footer.indexOf('class="socials"'));
    expect(socials).toContain('https://www.linkedin.com/in/jorge-rodriguez-rengel/');
    expect(socials).toContain('https://ximplicity.es');
    expect(socials).toContain('https://github.com/Yoshikemolo/ximply-design-studio');
    expect(socials.indexOf('linkedin.svg')).toBeLessThan(socials.indexOf('ximplicity.svg'));
    expect(socials.indexOf('ximplicity.svg')).toBeLessThan(socials.indexOf('github.svg'));
    // Every link opens in another tab and tells the browser not to hand over this one.
    expect((socials.match(/target="_blank"/g) ?? [])).toHaveLength(3);
    expect((socials.match(/rel="noopener noreferrer"/g) ?? [])).toHaveLength(3);
    for (const icon of ['linkedin', 'ximplicity', 'github']) {
      expect(existsSync(`apps/web/public/assets/icons/${icon}.svg`)).toBe(true);
    }
  });
});
