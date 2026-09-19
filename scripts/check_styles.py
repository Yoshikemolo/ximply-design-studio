"""Verify production styles load without script execution under the packaged CSP."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class StylesheetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stylesheets: list[str] = []
        self.noscript = False

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if any(name.lower().startswith('on') for name in attributes):
            raise ValueError('Inline event handlers are blocked by the packaged CSP')
        if tag == 'noscript':
            self.noscript = True
        if tag == 'link' and 'stylesheet' in attributes.get('rel', '').split() and not self.noscript:
            if attributes.get('media', 'all').strip().lower() not in ('', 'all', 'screen'):
                return
            href = attributes.get('href', '')
            url = urlsplit(href)
            if not href or url.scheme or url.netloc or '..' in url.path.split('/'):
                raise ValueError('Expected a local stylesheet asset')
            self.stylesheets.append(href)

    def handle_endtag(self, tag):
        if tag == 'noscript':
            self.noscript = False


def screen_stylesheets(html: str) -> list[str]:
    parser = StylesheetParser()
    parser.feed(html)
    if not parser.stylesheets:
        raise ValueError('No directly applicable screen stylesheet in production HTML')
    return parser.stylesheets


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1] / 'dist/studio/browser'
    for stylesheet in screen_stylesheets((root / 'index.html').read_text()):
        if not (root / urlsplit(stylesheet).path.lstrip('/')).is_file():
            raise ValueError('Missing production stylesheet asset')
    print('Production stylesheet loading is compatible with the packaged CSP.')
