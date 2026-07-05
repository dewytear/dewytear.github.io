#!/usr/bin/env python3
"""Deterministically build knowledge-index.json from tools/doc-entries.json + list.

The LLM-authored raw data lives in tools/doc-entries.json — one object per doc
with {name, title, summary, concepts}. This script adds the *computed* fields
(section, related) and writes the site's knowledge-index.json. Given the same
inputs it always produces the same output, so the daily curator only needs to
add/update entries for new or changed docs and re-run this.

Usage:  python3 tools/build_index.py           # build + write
        python3 tools/build_index.py --check    # verify output matches on disk

related[]: rarity-weighted (idf) concept overlap. Two docs sharing rare concepts
rank higher than docs sharing common ones. Docs with little concept overlap are
topped up with same-folder neighbours (via: "folder") so every doc gets 2-4.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(ROOT, 'tools', 'doc-entries.json')
LIST = os.path.join(ROOT, 'list')
OUT = os.path.join(ROOT, 'knowledge-index.json')
NOTE = ('AI가 각 문서를 읽어 만든 구조적 지식 인덱스(요약·핵심개념·연관문서). '
        'related는 희소성 가중 개념 중복(via:concept) + 같은 폴더 보완(via:folder)으로 계산.')


def load_sections():
    """section path + nav order + folder groupings, from the `list` tree."""
    tree = json.load(open(LIST, encoding='utf-8'))
    sec_of, order = {}, []

    def walk(nodes, path):
        for n in nodes:
            if n.get('children'):
                walk(n['children'], path + [n['title']] if n.get('title') else path)
            elif n.get('name') and not n.get('route'):
                sec_of[n['name']] = ' · '.join(path)
                order.append(n['name'])
    walk(tree if isinstance(tree, list) else tree.get('children', tree), [])
    folder_docs = {}
    for nm in order:
        folder_docs.setdefault(sec_of.get(nm, ''), []).append(nm)
    return sec_of, folder_docs


def build():
    entries = json.load(open(ENTRIES, encoding='utf-8'))
    docs = [{'name': e['name'], 'title': e['title'].strip(),
             'summary': e['summary'].strip(),
             'concepts': [c.strip() for c in e['concepts'] if c.strip()]}
            for e in entries]

    sec_of, folder_docs = load_sections()
    for d in docs:
        d['section'] = sec_of.get(d['name'], '')

    # idf: rarer concepts weigh more when scoring shared-concept overlap.
    df = {}
    for d in docs:
        for c in set(d['concepts']):
            df[c] = df.get(c, 0) + 1
    N = len(docs)
    def weight(c):
        return math.log((N + 1) / df.get(c, 1))

    by_name = {d['name']: d for d in docs}
    for d in docs:
        dc = set(d['concepts'])
        scored = []
        for o in docs:
            if o['name'] == d['name']:
                continue
            shared = dc & set(o['concepts'])
            if not shared:
                continue
            score = sum(weight(c) for c in shared)
            # Deterministic shared order: heaviest concept first, ties by name
            # (set iteration is hash-randomized, so an explicit tiebreak is
            # required for a reproducible build).
            shared_sorted = sorted(shared, key=lambda c: (-weight(c), c))
            scored.append((score, len(shared), o['name'], shared_sorted))
        scored.sort(key=lambda t: (-t[0], -t[1], t[2]))
        rel, picked = [], set()
        for score, ns, nm, sh in scored:
            if ns >= 2 or (ns == 1 and df[sh[0]] <= 3):
                rel.append({'name': nm, 'title': by_name[nm]['title'],
                            'shared': sh[:3], 'via': 'concept'})
                picked.add(nm)
            if len(rel) >= 4:
                break
        if len(rel) < 2 and d.get('section'):
            for nm in folder_docs.get(d['section'], []):
                if nm == d['name'] or nm in picked:
                    continue
                rel.append({'name': nm, 'title': by_name[nm]['title'],
                            'shared': [], 'via': 'folder'})
                picked.add(nm)
                if len(rel) >= 3:
                    break
        d['related'] = rel

    return {'schemaVersion': 1, 'note': NOTE, 'docCount': len(docs), 'docs': docs}


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    out = build()
    text = dump(out)
    if '--check' in sys.argv:
        cur = open(OUT, encoding='utf-8').read()
        if cur.strip() == text.strip():
            print('OK: knowledge-index.json is up to date (%d docs)' % out['docCount'])
            sys.exit(0)
        print('DRIFT: knowledge-index.json differs from a fresh build. Run without --check to rewrite.')
        sys.exit(1)
    open(OUT, 'w', encoding='utf-8').write(text)
    print('wrote knowledge-index.json (%d docs)' % out['docCount'])
