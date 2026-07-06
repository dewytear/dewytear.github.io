#!/usr/bin/env python3
"""Validate the i18n side-channels described in tools/i18n.md stay in sync:
translated bodies mirror the Korean path, derived data (label_<lang>, doc
index overlays, map data-topics, STRINGS) travels with the body translation
it belongs to, per the "docs/i18n" rules in CLAUDE.md.

Usage:  python3 tools/validate_i18n.py [--repo PATH]

Exposes run(root) -> list[finding] for tools/validate_all.py to compose with
the other validators; finding = {"level", "check", "name", "message"}.
"""
import argparse
import importlib.util
import json
import os
import re
import sys


def _f(level, check, name, message):
    return {'level': level, 'check': check, 'name': name, 'message': message}


def iter_nodes(nodes):
    for n in nodes:
        if not isinstance(n, dict):
            continue
        yield n
        children = n.get('children')
        if isinstance(children, list):
            yield from iter_nodes(children)


def load_list(root):
    try:
        tree = json.load(open(os.path.join(root, 'list'), encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        return None, [_f('ERROR', 'en-mirror', '-', 'cannot parse list: %s' % e)]
    top = tree if isinstance(tree, list) else tree.get('children', [])
    return [n for n in iter_nodes(top) if 'name' in n], []


def walk_files(base_dir):
    out = set()
    if not os.path.isdir(base_dir):
        return out
    for dirpath, _dirnames, filenames in os.walk(base_dir):
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), base_dir).replace(os.sep, '/')
            out.add(rel)
    return out


def load_cluster_labels(root):
    """Import tools/build_index.py (it has an __main__ guard, so this is
    side-effect-free) and read CLUSTER_LABELS_BY_LANG off it."""
    path = os.path.join(root, 'tools', 'build_index.py')
    spec = importlib.util.spec_from_file_location('build_index_for_validate', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, 'CLUSTER_LABELS_BY_LANG', {})


def galaxy_labels(cluster_labels, lang, galaxy):
    return {label for section, label in cluster_labels.get(lang, [])
            if section.split(' · ')[0] == galaxy}


# --- string-aware brace matcher, used for extracting the STRINGS.<lang>
# object literals out of index.html without a JS parser. ---
def extract_balanced(text, open_brace_index):
    depth = 0
    i = open_brace_index
    in_str = None
    n = len(text)
    while i < n:
        c = text[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == in_str:
                in_str = None
        else:
            if c in ('"', "'"):
                in_str = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return text[open_brace_index:i + 1]
        i += 1
    return None


def extract_strings_keys(index_html_text):
    """Return {lang: set(keys)} parsed from `var STRINGS = {...}`, or None if
    the shape can't be located (best-effort, per the contract)."""
    m = re.search(r'var\s+STRINGS\s*=\s*\{', index_html_text)
    if not m:
        return None
    block = extract_balanced(index_html_text, m.end() - 1)
    if block is None:
        return None
    result = {}
    for lang_m in re.finditer(r'[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{', block):
        lang = lang_m.group(1)
        sub = extract_balanced(block, lang_m.end() - 1)
        if sub is None:
            continue
        keys = set(re.findall(r'[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:', sub))
        result[lang] = keys
    return result or None


def run(root):
    findings = []
    docs, load_findings = load_list(root)
    findings.extend(load_findings)
    if docs is None:
        return findings

    ko_files = walk_files(os.path.join(root, 'docs', 'ko'))
    en_files = walk_files(os.path.join(root, 'docs', 'en'))
    doc_by_name = {n['name']: n for n in docs}
    path_by_name = {n['name']: n.get('path', n['name']) for n in docs}

    # 1. en-mirror: every docs/en file must sit at a docs/ko-relative path
    # that actually exists on disk.
    for rel in sorted(en_files):
        if rel not in ko_files:
            findings.append(_f('ERROR', 'en-mirror', rel,
                                "docs/en/%s has no docs/ko/%s twin" % (rel, rel)))

    # 2 & 3: label_en <-> en body presence.
    for n in docs:
        rel = n.get('path', n['name'])
        has_body = rel in en_files
        has_label = 'label_en' in n
        if has_body and not has_label:
            findings.append(_f('WARN', 'en-body-without-label', n['name'],
                                "docs/en/%s exists but list node has no label_en" % rel))
        if has_label and not has_body:
            findings.append(_f('INFO', 'label-without-en-body', n['name'],
                                "list node has label_en but docs/en/%s is missing" % rel))

    # 4. en-entry-orphan: doc-entries.en.json entries must reference a real
    # ko entry name that also has an en body.
    ko_entries_path = os.path.join(root, 'tools', 'doc-entries.ko.json')
    en_entries_path = os.path.join(root, 'tools', 'doc-entries.en.json')
    try:
        ko_entry_names = {e['name'] for e in json.load(open(ko_entries_path, encoding='utf-8'))}
    except (OSError, json.JSONDecodeError) as e:
        ko_entry_names = None
        findings.append(_f('ERROR', 'en-entry-orphan', '-',
                            'cannot parse tools/doc-entries.ko.json: %s' % e))
    if ko_entry_names is not None:
        try:
            en_entries = json.load(open(en_entries_path, encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as e:
            en_entries = []
            findings.append(_f('ERROR', 'en-entry-orphan', '-',
                                'cannot parse tools/doc-entries.en.json: %s' % e))
        for e in en_entries:
            name = e.get('name', '-')
            if name not in ko_entry_names:
                findings.append(_f('WARN', 'en-entry-orphan', name,
                                    'doc-entries.en.json entry has no ko counterpart'))
                continue
            rel = path_by_name.get(name)
            if rel is None or rel not in en_files:
                findings.append(_f('WARN', 'en-entry-orphan', name,
                                    'doc-entries.en.json entry has no en body file'))

    # 5. data-topics: map docs' data-topics keys vs. that language's cluster
    # labels for the relevant galaxy.
    try:
        cluster_labels = load_cluster_labels(root)
    except Exception as e:
        cluster_labels = None
        findings.append(_f('ERROR', 'data-topics', '-',
                            'cannot load CLUSTER_LABELS_BY_LANG from build_index.py: %s' % e))

    if cluster_labels is not None:
        topics_re = re.compile(r'data-topics=\'(\{.*?\})\'', re.DOTALL)

        def check_map_doc(lang, rel, doc_label, expected_labels):
            path = os.path.join(root, 'docs', lang, rel)
            if not os.path.isfile(path):
                return  # missing-file is validate_routes' job
            text = open(path, encoding='utf-8').read()
            m = topics_re.search(text)
            if not m:
                findings.append(_f('ERROR', 'data-topics', doc_label,
                                    'no data-topics attribute found'))
                return
            try:
                topics = json.loads(m.group(1))
            except json.JSONDecodeError as e:
                findings.append(_f('ERROR', 'data-topics', doc_label,
                                    'data-topics is not valid JSON: %s' % e))
                return
            keys = set(topics.keys())
            for k in keys - expected_labels:
                findings.append(_f('ERROR', 'data-topics', doc_label,
                                    "data-topics key '%s' is not a known cluster label" % k))
            for k in expected_labels - keys:
                findings.append(_f('WARN', 'data-topics', doc_label,
                                    "cluster label '%s' missing from data-topics" % k))

        check_map_doc('ko', 'ai/map/ai-map', 'ai-map(ko)', galaxy_labels(cluster_labels, 'ko', 'AI'))
        check_map_doc('en', 'ai/map/ai-map', 'ai-map(en)', galaxy_labels(cluster_labels, 'en', 'AI'))
        dz_expected = (galaxy_labels(cluster_labels, 'ko', 'Douzone')
                       | galaxy_labels(cluster_labels, 'en', 'Douzone'))
        check_map_doc('ko', 'douzone/map/dz-map', 'dz-map', dz_expected)

    # 6. strings-parity: STRINGS.ko vs STRINGS.en key sets in index.html.
    index_path = os.path.join(root, 'index.html')
    try:
        index_text = open(index_path, encoding='utf-8').read()
    except OSError as e:
        findings.append(_f('INFO', 'strings-parity', '-', 'cannot read index.html: %s' % e))
        index_text = None

    if index_text is not None:
        parsed = extract_strings_keys(index_text)
        if not parsed or 'ko' not in parsed or 'en' not in parsed:
            findings.append(_f('INFO', 'strings-parity', '-',
                                'could not locate/parse STRINGS.ko / STRINGS.en in index.html; skipped'))
        else:
            ko_keys, en_keys = parsed['ko'], parsed['en']
            for k in sorted(en_keys - ko_keys):
                findings.append(_f('WARN', 'strings-parity', k,
                                    'STRINGS.en has key not present in STRINGS.ko'))
            for k in sorted(ko_keys - en_keys):
                findings.append(_f('INFO', 'strings-parity', k,
                                    'STRINGS.ko has key not present in STRINGS.en (falls back to ko)'))

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
    print('validate_i18n: %d errors, %d warnings, %d infos'
          % (counts['ERROR'], counts['WARN'], counts['INFO']))
    return 1 if counts['ERROR'] else 0


if __name__ == '__main__':
    sys.exit(main())
