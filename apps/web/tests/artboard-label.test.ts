import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('the name of the page', () => {
  it('belongs to the page and stands above the rulers, which are 25 pixels tall', () => {
    const html = readFileSync('apps/web/src/app/app.component.html', 'utf8');
    const page = html.slice(html.indexOf('class="artboard"'));
    // The label is inside the page, so it follows the page wherever the view puts it.
    expect(page.indexOf('class="artboard-label"')).toBeGreaterThan(0);
    expect(page.indexOf('class="artboard-label"')).toBeLessThan(page.indexOf('<canvas'));
    const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
    const withRulers = /\.artboard\.with-rulers \.artboard-label \{\s*bottom: calc\(100% \+ (\d+)px\);/.exec(styles);
    const ruler = /\.horizontal-ruler \{[^}]*height: (\d+)px; top: -(\d+)px;/.exec(styles);
    expect(Number(withRulers![1])).toBeGreaterThan(Number(ruler![2]));
    // It still fits in the 50 pixels of margin around the page.
    expect(Number(withRulers![1]) + 12).toBeLessThanOrEqual(50);
  });
});
