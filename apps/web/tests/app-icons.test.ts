import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadImage } from '@napi-rs/canvas';

const html = readFileSync('apps/web/src/index.html', 'utf8');
const publicFile = (href: string) => `apps/web/public${href}`;
const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon|manifest)"([^>]*)>/g)].map(([, rel, attributes]) => ({
  rel, href: /href="([^"]+)"/.exec(attributes)![1], sizes: /sizes="([^"]+)"/.exec(attributes)?.[1],
}));

describe('the icons of the application', () => {
  it('gives the browser a favicon, so the request for /favicon.ico no longer fails', () => {
    expect(links.find((link) => link.rel === 'icon' && link.href === '/favicon.ico')).toBeTruthy();
    expect(existsSync(publicFile('/favicon.ico'))).toBe(true);
  });

  it('points every icon link at a picture of the size it declares', async () => {
    for (const link of links.filter((link) => link.rel !== 'manifest' && link.sizes && link.sizes !== 'any')) {
      const [width, height] = link.sizes!.split('x').map(Number);
      const image = await loadImage(readFileSync(publicFile(link.href)));
      expect([image.width, image.height], link.href).toEqual([width, height]);
    }
    expect(links.find((link) => link.rel === 'apple-touch-icon')?.sizes).toBe('180x180');
  });

  it('lets a phone add the studio to its home screen with the Ximplicity icon', async () => {
    const manifestLink = links.find((link) => link.rel === 'manifest')!;
    const manifest = JSON.parse(readFileSync(publicFile(manifestLink.href), 'utf8'));
    expect(manifest).toMatchObject({ name: 'Ximply Design Studio', start_url: '/', display: 'standalone' });
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) {
      const [width] = icon.sizes.split('x').map(Number);
      expect((await loadImage(readFileSync(publicFile(icon.src)))).width).toBe(width);
    }
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
  });
});
