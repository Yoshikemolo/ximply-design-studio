"""Generate navigable documentation and retrieve bounded feature context."""
from __future__ import annotations
import argparse
import json
import os
try:
    from harness.knowledge import read_document, documents
except ModuleNotFoundError:
    from knowledge import read_document, documents
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = '\n<!-- navigation:generated -->\n'


def graph(root: Path) -> dict:
    """Use stable identifiers and recorded paths, never inferred implementation claims."""
    registry = json.loads((root / 'doc/planning/traceability.json').read_text())
    nodes = {}
    for category in ('adr', 'feat', 'sc', 'sec', 'po'):
        for path in sorted((root / 'doc' / category).glob('*.md')):
            if path.name in ('INDEX.md', 'README.md'):
                continue
            metadata, content = read_document(path)
            title = metadata['title']
            identifier = path.stem
            nodes[identifier] = {'id': identifier, 'title': title, 'path': path.relative_to(root).as_posix(), 'links': [], 'implementation': [], 'tests': []}
    def connect(left, right):
        if left not in nodes or right not in nodes:
            raise ValueError(f'Unknown document relationship: {left} -> {right}')
        for a, b in ((left, right), (right, left)):
            if b not in nodes[a]['links']:
                nodes[a]['links'].append(b)
    for feature in registry['features']:
        node = nodes[feature['id']]
        for key in ('implementation', 'tests'):
            node[key] = feature[key]
            for path in node[key]:
                if not (root / path).is_file():
                    raise ValueError(f'Missing {key} path: {path}')
        for target in feature['adrs'] + feature['scenarios'] + feature['dependsOn']:
            connect(feature['id'], target)
    for identifier, node in list(nodes.items()):
        metadata, _ = read_document(root/node['path'])
        for target in metadata['related']:
            if target in nodes:
                connect(identifier, target)
    return nodes


def relative_link(source: str, target: str, label: str) -> str:
    return f'[{label}]({os.path.relpath(target, Path(source).parent)})'


def generated(root: Path) -> dict[str, str]:
    nodes = graph(root)
    outputs = {}
    for category in ('adr', 'feat', 'sc', 'sec', 'po'):
        path = f'doc/{category}/INDEX.md'
        rows = [f'# {category.upper()} index', '', '[Context entry](../INDEX.md)', '', '| ID and title |', '| --- |']
        for node in nodes.values():
            if node['path'].startswith(f'doc/{category}/'):
                rows.append('| ' + relative_link(path, node['path'], node['title']) + ' |')
        outputs[path] = '\n'.join(rows) + '\n'
    for node in nodes.values():
        path = node['path']
        base = (root/path).read_text().split(MARKER)[0].rstrip()
        links = ['[Category index](INDEX.md)', '[Context entry](../INDEX.md)']
        links.extend(relative_link(path, nodes[x]['path'], x) for x in sorted(node['links']))
        for key in ('implementation', 'tests'):
            links.extend(relative_link(path, x, f'{key}: {x}') for x in node[key])
        outputs[path] = base + MARKER + '\n## Navigation\n\n' + ' | '.join(links) + '\n'
    catalog = ['# Documentation catalog', '', '[Context entry](INDEX.md)', '', 'Generated titles and paths only; authoritative content remains in each linked document.', '']
    for identifier, document in documents(root).items():
        catalog.append('- ' + relative_link('doc/CATALOG.md', document['path'], identifier + ' — ' + document['metadata']['title']))
    outputs['doc/CATALOG.md'] = '\n'.join(catalog) + '\n'
    return outputs


def packet(root: Path, identifier: str) -> dict:
    nodes = graph(root)
    if identifier not in nodes:
        corpus = documents(root)
        if identifier not in corpus:
            raise ValueError(f'Unknown context ID: {identifier}')
        for key, document in corpus.items():
            nodes[key] = {'id': key, 'title': document['metadata']['title'], 'path': document['path'], 'links': document['metadata']['related'], 'implementation': [], 'tests': []}
    node = nodes[identifier]
    return {'entry': node, 'related': [{'id': x, 'path': nodes[x]['path'], 'title': nodes[x]['title']} for x in sorted(node['links'])], 'rule': 'Read entry first, then only relevant linked documents. Empty implementation/tests means not implemented; use doc/code-map.md for planned boundaries.'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('identifier', nargs='?')
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.identifier:
        print(json.dumps(packet(ROOT, args.identifier), indent=2))
        return 0
    outputs = generated(ROOT)
    if args.write:
        for path, content in outputs.items():
            (ROOT/path).write_text(content)
        print(f'Updated {len(outputs)} navigation files.')
        return 0
    stale = [path for path, content in outputs.items() if not (ROOT/path).is_file() or (ROOT/path).read_text() != content]
    for path in stale:
        print(f'Stale navigation: {path}')
    return int(bool(stale))


if __name__ == '__main__':
    raise SystemExit(main())
