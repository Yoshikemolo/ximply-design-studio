"""Validate the project's explicit metadata profile and document reachability."""
from __future__ import annotations
import json
from pathlib import Path
import re
from urllib.parse import unquote

CATEGORIES = ('adr', 'feat', 'sc', 'sec', 'po')


def is_source(path: Path, root: Path) -> bool:
    relative = path.relative_to(root / 'doc')
    return relative.parts[0] != 'templates' and relative.as_posix() != 'CATALOG.md' and not (relative.parts[0] in CATEGORIES and path.name == 'INDEX.md')


def read_document(path: Path) -> tuple[dict, str]:
    text = path.read_text()
    if not text.startswith('---\n'):
        raise ValueError(f'Missing metadata: {path}')
    header, body = text[4:].split('\n---\n', 1)
    metadata = {}
    for line in header.splitlines():
        key, value = line.split(':', 1)
        if key in metadata:
            raise ValueError(f'Duplicate metadata field: {key}')
        metadata[key] = json.loads(value.strip())
    return metadata, body


def documents(root: Path) -> dict:
    result = {}
    for path in sorted((root / 'doc').rglob('*.md')):
        if is_source(path, root):
            metadata, body = read_document(path)
            identifier = metadata['id']
            if identifier in result:
                raise ValueError(f'Duplicate document ID: {identifier}')
            result[identifier] = {'metadata': metadata, 'body': body, 'path': path.relative_to(root).as_posix()}
    return result


def headings(text: str) -> set[str]:
    result = set()
    counts = {}
    for title in re.findall(r'^#{1,6}\s+(.+)$', text, re.M):
        base = re.sub(r'[^\w\- ]', '', title.lower()).replace(' ', '-')
        count = counts.get(base, 0)
        counts[base] = count + 1
        result.add(base + (f'-{count}' if count else ''))
    return result


def check(root: Path) -> list[str]:
    errors = []
    try:
        corpus = documents(root)
    except (ValueError, KeyError, TypeError) as error:
        return [str(error)]
    for identifier, document in corpus.items():
        metadata = document['metadata']
        path = document['path']
        for field in ('id', 'title', 'status', 'domain', 'owners', 'applies_to', 'related', 'source'):
            if field not in metadata:
                errors.append(f'{identifier}: missing {field}')
        if not re.fullmatch(r'[A-Z][A-Z0-9-]*-\d{4}', identifier):
            errors.append(f'{identifier}: invalid identifier')
        if metadata.get('status') not in ('proposed', 'accepted', 'deprecated', 'superseded', 'rejected', 'planned', 'implementing', 'verified', 'released', 'blocked'):
            errors.append(f'{identifier}: invalid status')
        domain = Path(path).parent.relative_to('doc').as_posix()
        if metadata.get('domain') != domain:
            errors.append(f'{identifier}: domain mismatch')
        for field in ('owners', 'applies_to', 'source'):
            if not isinstance(metadata.get(field), list) or not metadata[field]:
                errors.append(f'{identifier}: empty or invalid {field}')
        related = metadata.get('related', [])
        if not isinstance(related, list) or not all(isinstance(x, str) for x in related):
            errors.append(f'{identifier}: invalid related list')
            related = []
        declared = re.search(r'^Status: (\w+)', document['body'], re.M)
        if declared and declared[1].lower() != metadata.get('status'):
            errors.append(f'{identifier}: narrative status mismatch')
        if domain in CATEGORIES and Path(path).name != 'README.md' and Path(path).stem != identifier:
            errors.append(f'{identifier}: filename mismatch')
        for target in related:
            if target not in corpus:
                errors.append(f'{identifier}: unknown related ID {target}')
    adjacency = {}
    for path in [root/'README.md', *(root/'doc').rglob('*.md')]:
        links = []
        for href in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text()):
            if '://' in href or href.startswith('mailto:'):
                continue
            target, _, fragment = unquote(href).partition('#')
            dest = (path.parent/target).resolve() if target else path.resolve()
            if not dest.exists():
                errors.append(f'{path.relative_to(root)}: broken link {href}')
            elif dest.is_file():
                links.append(dest)
                if fragment and dest.suffix == '.md' and fragment not in headings(dest.read_text()):
                    errors.append(f'{path.relative_to(root)}: broken anchor {href}')
        adjacency[path.resolve()] = links
    reached, pending = set(), [(root/'README.md').resolve()]
    while pending:
        path = pending.pop()
        if path not in reached:
            reached.add(path)
            pending.extend(adjacency.get(path, []))
    for document in corpus.values():
        if (root/document['path']).resolve() not in reached:
            errors.append(f"Unreachable document: {document['path']}")
    return errors


if __name__ == '__main__':
    failures = check(Path(__file__).resolve().parents[1])
    print('\n'.join(failures) if failures else 'Knowledge metadata, IDs, links, anchors and reachability passed.')
    raise SystemExit(int(bool(failures)))
