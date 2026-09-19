"""Build application-shipped release data from versioned Markdown sources."""
from __future__ import annotations
import argparse
from datetime import date
from functools import cmp_to_key
import json
from pathlib import Path
import re
import subprocess

try:
    from harness.knowledge import read_document
except ModuleNotFoundError:
    from knowledge import read_document

ROOT = Path(__file__).resolve().parents[1]
SECTIONS = {'Breaking changes': None, 'New features': 'Feature', 'Improvements': 'Improvement',
            'Fixes': 'Fix', 'Security': 'Security', 'Engineering': 'Engineering'}
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?')


def version_parts(version: str):
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('Invalid release version')
    suffix = match[4].split('.') if match[4] else []
    if any(x.isdigit() and len(x) > 1 and x.startswith('0') for x in suffix):
        raise ValueError('Invalid numeric prerelease identifier')
    return tuple(int(match[x]) for x in (1, 2, 3)), suffix


def compare_versions(left: str, right: str) -> int:
    a, ap = version_parts(left)
    b, bp = version_parts(right)
    if a != b:
        return (a > b) - (a < b)
    if not ap or not bp:
        return (not ap) - (not bp)
    for x, y in zip(ap, bp):
        if x != y:
            if x.isdigit() and y.isdigit():
                return (int(x) > int(y)) - (int(x) < int(y))
            if x.isdigit() != y.isdigit():
                return -1 if x.isdigit() else 1
            return (x > y) - (x < y)
    return (len(ap) > len(bp)) - (len(ap) < len(bp))


def sections(body: str) -> dict:
    chunks = re.split(r'^## (.+)\n', body, flags=re.M)
    result = {}
    for index in range(1, len(chunks), 2):
        heading, content = chunks[index], chunks[index + 1].strip()
        if heading not in SECTIONS or heading in result:
            raise ValueError('Unknown or repeated changelog section')
        lines = content.splitlines()
        if content == 'None.':
            result[heading] = []
        elif lines and all(line.startswith('- ') and line[2:].strip() for line in lines):
            result[heading] = [line[2:] for line in lines]
        else:
            raise ValueError('Use one Markdown bullet per entry or explicit None.')
    if set(result) != set(SECTIONS):
        raise ValueError('Every release must include all changelog sections')
    return result


def build(root: Path) -> dict[str, str]:
    entries, outputs = [], {}
    for path in sorted((root/'doc/changelog').glob('*.md')):
        metadata, body = read_document(path)
        version = metadata['version']
        groups = sections(body)
        breaking = metadata['breaking_changes']
        if type(breaking) is not bool or breaking != bool(groups['Breaking changes']):
            raise ValueError('Breaking-change flag and notes must agree')
        if version == 'Unreleased':
            if path.name != 'Unreleased.md':
                raise ValueError('Unreleased source has the wrong filename')
            continue
        version_parts(version)
        if path.stem != version or any(x['version'] == version for x in entries):
            raise ValueError('Duplicate or mismatched release version')
        date.fromisoformat(metadata['date'])
        if not metadata['summary'] or not metadata['capability_status']:
            raise ValueError('Release summary and capability status required')
        if breaking and not any('migration:' in note.lower() for note in groups['Breaking changes']):
            raise ValueError('Breaking releases require explicit Migration: instructions')
        changes = [{'type': kind, 'description': note} for heading, kind in SECTIONS.items()
                   if kind for note in groups[heading]]
        if not changes and not breaking:
            raise ValueError('Empty release notes are not a release')
        entries.append({'version': version, 'date': metadata['date'], 'summary': metadata['summary'],
                        'breakingChanges': groups['Breaking changes'], 'changes': changes,
                        'capabilityStatus': metadata['capability_status'],
                        'markdown': f'{version}.md', 'source': f'doc/changelog/{version}.md'})
        outputs[f'apps/web/public/assets/changelog/{version}.md'] = body.lstrip()
    entries.sort(key=cmp_to_key(lambda a, b: compare_versions(a['version'], b['version'])), reverse=True)
    current = json.loads((root/'release/version.json').read_text())['version']
    if current not in [entry['version'] for entry in entries]:
        raise ValueError('Current version has no Markdown release notes')
    data = json.dumps({'currentVersion': current, 'entries': entries}, indent=2) + '\n'
    outputs['release/changelog.json'] = data
    outputs['apps/web/public/assets/changelog/index.json'] = data
    links = ['# Changelog', '', 'Authoritative notes are versioned Markdown under doc/changelog.',
             'Application data and bundled Markdown are generated; do not edit them.', '',
             '[Unreleased](doc/changelog/Unreleased.md)', '']
    links += [f"- [{entry['version']} — {entry['summary']}]({entry['source']})" for entry in entries]
    outputs['CHANGELOG.md'] = '\n'.join(links) + '\n'
    return outputs


def require_note_update(paths: list[str]) -> None:
    implementation = any(path.startswith(('apps/', 'packages/', 'services/', 'harness/', 'scripts/', 'infra/', 'contracts/'))
                         and not path.startswith('apps/web/public/assets/changelog/') for path in paths)
    notes = any(path.startswith('doc/changelog/') and path.endswith('.md') for path in paths)
    if implementation and not notes:
        raise ValueError('Implementation changes require a Markdown release-note update')


def check_changes(base: str, head: str) -> None:
    if not all(re.fullmatch(r'[0-9a-f]{40}', value) for value in (base, head)):
        raise ValueError('Changelog impact checks require full commit SHAs')
    result = subprocess.run(['git', 'diff', '--name-only', f'{base}...{head}'],
                            capture_output=True, text=True, check=True)
    require_note_update(result.stdout.splitlines())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--base')
    parser.add_argument('--head')
    args = parser.parse_args()
    try:
        outputs = build(ROOT)
        if args.base or args.head:
            check_changes(args.base or '', args.head or '')
        stale = []
        for filename, content in outputs.items():
            path = ROOT/filename
            if args.write:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            elif not path.is_file() or path.read_text() != content:
                stale.append(filename)
        if stale:
            raise ValueError('Stale generated changelog: ' + ', '.join(stale))
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f'Changelog validation failed: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
