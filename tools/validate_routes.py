#!/usr/bin/env python3
"""Validate the `list` nav tree against the docs/ tree and internal hash-links.

Catches the class of regression that breaks navigation or dead-ends a click:
a doc removed from `list` but left on disk (or vice versa), a link to a route
that no longer exists, a translated file with no Korean twin at the same path.

Usage:  python3 tools/validate_routes.py [--repo PATH]

Exposes run(root) -> list[finding] for tools/validate_all.py to compose with
the other validators; finding = {"level", "check", "name", "message"}.
"""
import argparse
import json
import os
import re
import sys

SPECIAL_ROUTES = {'cosmos', 'tags', 'settings', 'search', 'about'}
SPECIAL_PREFIXES = ('tag:', 'folder:')
# Deliberately nav-less doc files (reachable by dedicated UI, not the list
# tree): the About page opens from the sidebar profile photo.
UNLISTED_DOCS = {'about'}
LINK_RE = re.compile(r'href="#!([^"]*)"')


def iter_nodes(nodes):
    """Recursively yield every dict node in the `list` tree (docs, branches,
    the route node) in document order."""
    for n in nodes:
        if not isinstance(n, dict):
            continue
        yield n
        children = n.get('children')
        if isinstance(children, list):
            yield from iter_nodes(children)


def load_list(root):
    """Parse the `list` file. Returns (tree_or_None, findings)."""
    list_path = os.path.join(root, 'list')
    try:
        with open(list_path, encoding='utf-8') as f:
            raw = f.read()
    except OSError as e:
        return None, [_f('ERROR', 'list-json', '-', 'cannot read list file: %s' % e)]
    try:
        tree = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, [_f('ERROR', 'list-json', '-', 'list is not valid JSON: %s' % e)]
    return tree, []


def _f(level, check, name, message):
    return {'level': level, 'check': check, 'name': name, 'message': message}


def walk_files(base_dir):
    """relpath (forward slashes, no extension logic - files have none here) ->
    absolute path, for every regular file under base_dir."""
    out = {}
    if not os.path.isdir(base_dir):
        return out
    for dirpath, _dirnames, filenames in os.walk(base_dir):
        for fn in filenames:
            abspath = os.path.join(dirpath, fn)
            rel = os.path.relpath(abspath, base_dir).replace(os.sep, '/')
            out[rel] = abspath
    return out


def run(root):
    findings = []
    tree, load_findings = load_list(root)
    findings.extend(load_findings)
    if tree is None:
        return findings

    top_nodes = tree if isinstance(tree, list) else tree.get('children', [])
    all_nodes = list(iter_nodes(top_nodes))
    docs = [n for n in all_nodes if 'name' in n]

    # 1. list-json: every doc node needs name + label + path (the name/path
    # pair is the CLAUDE.md contract: name = immutable hash route, path =
    # physical location under docs/<lang>/ — always recorded together).
    for n in docs:
        if not n.get('label'):
            findings.append(_f('ERROR', 'list-json', n.get('name', '-'),
                                "doc node is missing 'label'"))
        if not n.get('path'):
            findings.append(_f('ERROR', 'list-json', n.get('name', '-'),
                                "doc node is missing 'path' (name/path must be recorded together)"))

    # 2. dup-name: duplicate `name` across the tree.
    seen = {}
    for n in docs:
        seen.setdefault(n['name'], 0)
        seen[n['name']] += 1
    for name, count in seen.items():
        if count > 1:
            findings.append(_f('ERROR', 'dup-name', name,
                                "name appears %d times in list" % count))

    ko_dir = os.path.join(root, 'docs', 'ko')
    en_dir = os.path.join(root, 'docs', 'en')
    ko_files = walk_files(ko_dir)

    # path -> name lookup, used to give broken-link / orphan findings a
    # meaningful `name` even when the file itself has no list entry.
    path_to_name = {}
    for n in docs:
        rel = n.get('path', n['name'])
        path_to_name.setdefault(rel, n['name'])

    # 3. missing-file: list node with no docs/ko/<path> on disk.
    doc_paths = set()
    for n in docs:
        rel = n.get('path', n['name'])
        doc_paths.add(rel)
        if rel not in ko_files:
            findings.append(_f('ERROR', 'missing-file', n['name'],
                                "docs/ko/%s not found" % rel))

    # 4. orphan-file: file under docs/ko/** not referenced by any list path.
    # Work Log docs are held to a stricter bar (ERROR, not WARN): an unlisted
    # work-log file never appears in the nav tree, so the log silently fails
    # to "accumulate" — exactly the CLAUDE.md 규칙 4 gap this guards against
    # (add a doc → always register a list node). A work-log file on disk with
    # no list node is never intentional, so it must fail the merge, not warn.
    for rel in sorted(ko_files):
        if rel in UNLISTED_DOCS:
            continue
        if rel not in doc_paths:
            level = 'ERROR' if rel.startswith('work-log/') else 'WARN'
            findings.append(_f(level, 'orphan-file', rel,
                                "docs/ko/%s is not referenced by any list node" % rel))

    # 5. broken-link: href="#!..." targets that resolve to nothing.
    names = {n['name'] for n in docs}
    for lang, base in (('ko', ko_dir), ('en', en_dir)):
        for rel, abspath in sorted(walk_files(base).items()):
            try:
                with open(abspath, encoding='utf-8') as f:
                    text = f.read()
            except OSError as e:
                findings.append(_f('ERROR', 'broken-link', path_to_name.get(rel, rel),
                                    "could not read docs/%s/%s: %s" % (lang, rel, e)))
                continue
            doc_name = path_to_name.get(rel, '%s:%s' % (lang, rel))
            for m in LINK_RE.finditer(text):
                target = m.group(1)
                if (target in SPECIAL_ROUTES
                        or target.startswith(SPECIAL_PREFIXES)
                        or target in names):
                    continue
                findings.append(_f('ERROR', 'broken-link', doc_name,
                                    'href="#!%s" has no matching route' % target))

    # 6. path-name-mismatch: path basename should equal the logical name.
    for n in docs:
        rel = n.get('path', n['name'])
        base = rel.rsplit('/', 1)[-1]
        if base != n['name']:
            findings.append(_f('WARN', 'path-name-mismatch', n['name'],
                                "path '%s' basename '%s' != name '%s'" % (rel, base, n['name'])))

    # 7. en-orphan: docs/en file whose relative path has no ko list node.
    for rel in sorted(walk_files(en_dir)):
        if rel in UNLISTED_DOCS:
            continue
        if rel not in doc_paths:
            findings.append(_f('ERROR', 'en-orphan', path_to_name.get(rel, rel),
                                "docs/en/%s has no matching path in list" % rel))

    return findings


LEVEL_ORDER = {'ERROR': 0, 'WARN': 1, 'INFO': 2}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser.add_argument('--repo', default=default_repo)
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding='utf-8')
    findings = run(args.repo)
    findings.sort(key=lambda f: (LEVEL_ORDER.get(f['level'], 9), f['check'], f['name']))
    for f in findings:
        print('[%s] %s | %s | %s' % (f['level'], f['check'], f['name'], f['message']))

    counts = {'ERROR': 0, 'WARN': 0, 'INFO': 0}
    for f in findings:
        counts[f['level']] = counts.get(f['level'], 0) + 1
    print('validate_routes: %d errors, %d warnings, %d infos'
          % (counts['ERROR'], counts['WARN'], counts['INFO']))
    return 1 if counts['ERROR'] else 0


if __name__ == '__main__':
    sys.exit(main())
