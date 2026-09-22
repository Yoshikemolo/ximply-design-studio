import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const styles = readFileSync('packages/design-system/styles/studio.scss', 'utf8');
/** Every active state painted in the solid accent, and whether its icons are drawn white. */
function accentActives() {
  return [...styles.matchAll(/([^{}\n]*\.active[^{}\n]*)\{[^}]*background:\s*var\(--accent\)[^}]*\}/g)].map((m) => m[1].trim());
}

describe('icons on an active control', () => {
  it('are white wherever the active state is the solid accent, in either theme', () => {
    const selectors = accentActives();
    expect(selectors).toContain('.aid-pair button.active');
    for (const selector of selectors.filter((s) => s.includes('button'))) {
      // The reference locator has no icons; every other accent button with icons turns them white.
      if (selector.includes('reference-locator') || selector === 'button.active') continue;
      expect(styles, selector).toContain(`${selector} img { filter: brightness(0) invert(1); }`);
    }
  });
});
