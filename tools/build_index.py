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
import glob, json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'list')
NOTE = {
    'ko': ('AI가 각 문서를 읽어 만든 구조적 지식 인덱스(요약·핵심개념·연관문서). '
           'related는 희소성 가중 개념 중복(via:concept) + 같은 폴더 보완(via:folder)으로 계산.'),
}
NOTE_DEFAULT = ('Structured knowledge index built by AI from every doc (summary, key '
                'concepts, related docs). related = idf-weighted concept overlap '
                '(via:concept) topped up with same-folder neighbours (via:folder).')


def langs():
    """Languages that have a raw-entries file: tools/doc-entries.<lang>.json."""
    out = []
    for p in sorted(glob.glob(os.path.join(ROOT, 'tools', 'doc-entries.*.json'))):
        out.append(os.path.basename(p).split('.')[1])
    return out


def entries_path(lang):
    return os.path.join(ROOT, 'tools', 'doc-entries.%s.json' % lang)


def out_path(lang):
    return os.path.join(ROOT, 'data', 'knowledge-index.%s.json' % lang)


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


def build(lang='ko'):
    # Non-Korean entry files are OVERLAYS: they carry only the docs (and
    # fields) that are translated; everything else inherits from Korean.
    # Concepts stay shared across languages so related[] and stats keep an
    # identical structure — only display fields (title, summary) localize.
    entries = json.load(open(entries_path('ko'), encoding='utf-8'))
    if lang != 'ko':
        overlay = {e['name']: e for e in json.load(open(entries_path(lang), encoding='utf-8'))}
        entries = [dict(base, **{k: v for k, v in overlay.get(base['name'], {}).items() if k != 'name'})
                   for base in entries]
    docs = [{'name': e['name'], 'title': e['title'].strip(),
             'summary': e['summary'].strip(),
             'concepts': [c.strip() for c in e['concepts'] if c.strip()],
             # Curated semantic relations (additive passthrough) — DISTINCT from
             # the computed `related` below. Author-declared {target,type,
             # evidenceRef,source}; omit key when a doc has none.
             **({'relations': e['relations']} if e.get('relations') else {})}
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
            # Deterministic shared order: heaviest concept first, ties by name
            # (set iteration is hash-randomized, so an explicit tiebreak is
            # required for a reproducible build).
            shared_sorted = sorted(shared, key=lambda c: (-weight(c), c))
            # Sum in that FIXED order — float addition is order-sensitive, and
            # summing over the raw set made near-ties flip between runs.
            score = sum(weight(c) for c in shared_sorted)
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

    labels = CLUSTER_LABELS_BY_LANG.get(lang, CLUSTER_LABELS)
    stats = build_stats(docs, labels)
    # Per-galaxy stats: the same aggregation scoped to one top-level category
    # (the section's first segment — "AI", "Douzone", …). Galaxy map pages
    # (data-section-prefix) hydrate every block from their own galaxy here,
    # while the graph and cross-galaxy views keep using the global stats.
    galaxies = {}
    for d in docs:
        g = d['section'].split(' · ')[0] if d['section'] else ''
        if g:
            galaxies.setdefault(g, []).append(d)
    stats['galaxies'] = {g: build_stats(members, labels)
                         for g, members in sorted(galaxies.items())}
    return {'schemaVersion': 2, 'note': NOTE.get(lang, NOTE_DEFAULT),
            'docCount': len(docs), 'stats': stats, 'docs': docs}


# Cluster display names for the Knowledge Map page, keyed by section path.
# Per-wiki config in tools/clusters.json — {lang: [[section, label], …]};
# new clusters must be added to EVERY language there. A missing file just
# means no named clusters (fresh wikis bootstrap fine without one), so the
# plugin bundle ships the engine without dewytear-specific section names.
def _load_cluster_labels():
    path = os.path.join(ROOT, 'tools', 'clusters.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


CLUSTER_LABELS_BY_LANG = _load_cluster_labels()
# Backward-compatible alias (Korean is the source language).
CLUSTER_LABELS = CLUSTER_LABELS_BY_LANG.get('ko', [])


def build_stats(docs, cluster_labels=None):
    """Deterministic aggregation the site renders live on the 지식 지도 page.

    Everything here derives from the entries alone (no clock, no randomness),
    so the same inputs always produce the same stats and --check stays valid.
    """
    if cluster_labels is None:
        cluster_labels = CLUSTER_LABELS
    by_name = {d['name']: d for d in docs}
    label_of = dict(cluster_labels)

    # In-degree over related links = "how often docs point here".
    indeg = {}
    for d in docs:
        for r in d['related']:
            indeg[r['name']] = indeg.get(r['name'], 0) + 1

    # Clusters in the fixed display order, each with its own top hub.
    clusters = []
    for section, label in cluster_labels:
        members = [d for d in docs if d['section'] == section]
        if not members:
            continue
        hub = max(members, key=lambda d: (indeg.get(d['name'], 0), d['name']))
        clusters.append({'label': label, 'section': section, 'count': len(members),
                         'hub': {'name': hub['name'], 'title': hub['title'],
                                 'refs': indeg.get(hub['name'], 0)}})

    # Overall hubs: most-referenced docs (ties by name for determinism).
    # related[] may point outside the given doc subset (cross-galaxy links
    # when building per-galaxy stats) — only docs in the subset qualify.
    hubs = sorted(((n, c) for n, c in indeg.items()), key=lambda t: (-t[1], t[0]))
    hubs = [{'name': n, 'title': by_name[n]['title'], 'refs': c}
            for n, c in hubs if c >= 6 and n in by_name]

    # Concept frequency + cluster spread (bridges connect 3+ clusters).
    freq, spread = {}, {}
    for d in docs:
        cl = label_of.get(d['section'], d['section'])
        for c in set(d['concepts']):
            freq[c] = freq.get(c, 0) + 1
            spread.setdefault(c, set()).add(cl)
    top_concepts = sorted(freq.items(), key=lambda t: (-t[1], t[0]))[:16]
    bridges = sorted(((c, n) for c, n in freq.items() if len(spread[c]) >= 3),
                     key=lambda t: (-len(spread[t[0]]), -t[1], t[0]))[:8]

    return {
        'docCount': len(docs),
        'conceptCount': len(freq),
        'clusters': clusters,
        'hubs': hubs,
        'topConcepts': [{'c': c, 'n': n} for c, n in top_concepts],
        'bridges': [{'c': c, 'n': freq[c],
                     'clusters': sorted(spread[c])} for c, n in bridges],
    }


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    # Every language with a doc-entries file gets its own index; --check
    # verifies all of them (any drift fails the run).
    failed = False
    for lang in langs():
        out = build(lang)
        text = dump(out)
        target = out_path(lang)
        if '--check' in sys.argv:
            cur = open(target, encoding='utf-8').read() if os.path.exists(target) else ''
            if cur.strip() == text.strip():
                print('OK: %s is up to date (%d docs)' % (os.path.basename(target), out['docCount']))
            else:
                print('DRIFT: %s differs from a fresh build. Run without --check to rewrite.'
                      % os.path.basename(target))
                failed = True
        else:
            open(target, 'w', encoding='utf-8').write(text)
            print('wrote %s (%d docs)' % (os.path.basename(target), out['docCount']))
    sys.exit(1 if failed else 0)
