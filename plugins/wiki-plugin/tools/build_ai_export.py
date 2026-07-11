#!/usr/bin/env python3
"""Build the AI-consumption layer from the knowledge index + `list`.

An external AI given a task should be able to (1) discover this wiki, (2) fetch
ONE self-contained file to traverse the whole knowledge graph, and (3) reach any
document's raw text by URL. This script generates that layer deterministically
from the same source as the site (tools/doc-entries.ko.json via build_index +
the `list` nav tree), so it always matches the published knowledge graph.

Outputs:
  - llms.txt                     root sign-post (llmstxt.org convention) — the
                                 wiki's purpose, machine-file pointers, and every
                                 document grouped by System with title/summary/URL.
  - data/knowledge-graph.json    self-contained graph: each node carries
                                 {name,title,summary,concepts,section,url,route,
                                 related} — index fields + the doc's fetchable URL
                                 inlined, so one fetch is enough to traverse.

Usage:  python3 tools/build_ai_export.py           # build + write
        python3 tools/build_ai_export.py --check    # verify outputs match on disk
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'list')
LANG = 'ko'   # source-of-truth language; the graph is fetched from ko docs.
GUIDE_NAME = 'ai-guide'   # the public traversal-contract doc (nonum meta page).


def _config():
    try:
        return json.load(open(os.path.join(ROOT, 'config.json'), encoding='utf-8'))
    except (OSError, ValueError):
        return {}


# Site root URL from config.json ("url"); trailing slash normalized. All
# absolute links (llms.txt, graph node urls, sitemap) hang off this, so the
# tool is site-agnostic — set config.url and it retargets.
def _base():
    u = (_config().get('url') or 'https://example.github.io/').strip()
    return u if u.endswith('/') else u + '/'


BASE = _base()


def _load_build_index():
    """Reuse build_index.build()/load_sections()/CLUSTER_LABELS without running its CLI."""
    path = os.path.join(ROOT, 'tools', 'build_index.py')
    spec = importlib.util.spec_from_file_location('build_index_ref', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_paths():
    """name -> physical path under docs/<lang>/, from the `list` tree (leaf nodes)."""
    tree = json.load(open(LIST, encoding='utf-8'))
    paths = {}

    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                walk(n['children'])
            elif n.get('name') and n.get('path') and not n.get('route'):
                paths[n['name']] = n['path']
    walk(tree if isinstance(tree, list) else tree.get('children', tree))
    return paths


def doc_url(name, paths):
    return BASE + 'docs/' + LANG + '/' + paths[name] if name in paths else ''


def _site_meta():
    cfg = _config()
    title = cfg.get('title') or 'Wiki'
    # One-line description from config (mirrors index.html <meta description>).
    desc = cfg.get('description') or (title + ' — AI 지식 그래프 위키.')
    return title, desc


def build_graph():
    """Self-contained knowledge graph: index docs + inlined fetchable URLs."""
    bi = _load_build_index()
    idx = bi.build(LANG)
    paths = load_paths()
    nodes = []
    for d in idx['docs']:
        nodes.append({
            'name': d['name'],
            'title': d['title'],
            'summary': d['summary'],
            'section': d['section'],
            'concepts': d['concepts'],
            'url': doc_url(d['name'], paths),
            'route': BASE + '#!' + d['name'],
            'related': d['related'],
            'relations': d.get('relations', []),
        })
    return {
        'schemaVersion': 2,
        'note': ('자기완결 지식 그래프 — 노드=문서(name), 엣지=related '
                 '(via:concept 희소성 가중 개념 중복 / via:folder 같은 폴더 보완), '
                 'concepts=조인 키, url=원문(HTML 조각) fetch 주소. 계층은 '
                 'section("World · Domain · System · Document")과 stats.clusters. '
                 '순회 가이드: ' + BASE + 'docs/' + LANG + '/ai/map/' + GUIDE_NAME),
        'base': BASE,
        'docCount': idx['docCount'],
        'stats': idx['stats'],
        'nodes': nodes,
    }


def build_llms():
    """Root llms.txt — sign-post + machine pointers + docs grouped by System."""
    bi = _load_build_index()
    idx = bi.build(LANG)
    _, folder_docs = bi.load_sections()
    paths = load_paths()
    by_name = {d['name']: d for d in idx['docs']}
    title, desc = _site_meta()
    st = idx['stats']

    lines = []
    lines.append('# ' + title)
    lines.append('')
    lines.append('> ' + desc)
    lines.append('')
    lines.append('이 위키는 문서를 **개념(concepts)** 과 **연관 문서(related)** 로 잇는 지식 '
                 '그래프다. AI에게 업무를 줄 때 이곳을 먼저 참고하고 연관관계로 분석하도록, '
                 '아래 기계 판독용 파일과 순회 규칙을 제공한다. 계층: World → Domain → '
                 'System → Document. 현재 %d개 문서 · %d개 개념.'
                 % (st['docCount'], st['conceptCount']))
    lines.append('')

    lines.append('## 기계 판독용 (Machine-readable — AI는 여기부터)')
    lines.append('- [지식 그래프 (단일 파일)](%sdata/knowledge-graph.json): 모든 노드(문서)와 '
                 '엣지(related)·개념·문서 URL·통계를 담은 자기완결 JSON. **먼저 이 파일을 '
                 'fetch해 그래프를 순회하라.**' % BASE)
    lines.append('- [AI 순회 가이드](%sdocs/%s/ai/map/%s): 그래프를 어떻게 질의·순회·분석하는지의 '
                 '계약(노드·엣지·개념 조인·계층).' % (BASE, LANG, GUIDE_NAME))
    lines.append('- [지식 인덱스](%sdata/knowledge-index.%s.json) · [내비 트리](%slist) · '
                 '[문서 날짜](%sdata/doc-dates.json)' % (BASE, LANG, BASE, BASE))
    lines.append('')

    # Docs grouped by System, in the map's cluster order; leftover sections after.
    cluster_order = [s for s, _ in bi.CLUSTER_LABELS]
    label_of = dict(bi.CLUSTER_LABELS)
    seen = set()
    ordered_sections = [s for s in cluster_order if s in folder_docs]
    for s in folder_docs:
        if s and s not in ordered_sections:
            ordered_sections.append(s)

    for section in ordered_sections:
        names = [n for n in folder_docs.get(section, []) if n in by_name]
        if not names:
            continue
        seen.update(names)
        label = label_of.get(section, section.split(' · ')[-1] or section)
        lines.append('## %s (%s)' % (label, section))
        for n in names:
            d = by_name[n]
            url = doc_url(n, paths)
            summ = d['summary'].replace('\n', ' ').strip()
            lines.append('- [%s](%s): %s' % (d['title'], url, summ))
        lines.append('')

    # Hubs are the most-referenced docs — a good analysis entry point.
    if st.get('hubs'):
        lines.append('## 허브 문서 (가장 많이 참조됨 — 분석 진입점)')
        for h in st['hubs']:
            url = doc_url(h['name'], paths)
            lines.append('- [%s](%s): 피참조 %d회' % (h['title'], url, h['refs']))
        lines.append('')

    return '\n'.join(lines).rstrip() + '\n'


def build_sitemap():
    """sitemap.xml — homepage + machine files + every doc's raw fragment URL.

    Built from `list` (all leaf paths, incl. nonum meta pages) in nav order, so
    new docs appear automatically. No <lastmod> (would churn --check daily)."""
    paths = load_paths()
    tree = json.load(open(LIST, encoding='utf-8'))
    order = []

    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                walk(n['children'])
            elif n.get('name') and n.get('path') and not n.get('route'):
                order.append(n['name'])
    walk(tree if isinstance(tree, list) else tree.get('children', tree))

    locs = [BASE, BASE + 'llms.txt', BASE + 'data/knowledge-graph.json']
    locs += [BASE + 'docs/' + LANG + '/' + paths[n] for n in order if n in paths]
    body = ''.join('  <url><loc>%s</loc></url>\n' % u for u in locs)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + body + '</urlset>\n')


def _dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1)


def _emit(rel_path, text, check):
    target = os.path.join(ROOT, rel_path)
    if check:
        cur = open(target, encoding='utf-8').read() if os.path.exists(target) else ''
        if cur.strip() == text.strip():
            print('OK: %s is up to date' % rel_path)
            return True
        print('DRIFT: %s differs from a fresh build. Run without --check to rewrite.' % rel_path)
        return False
    open(target, 'w', encoding='utf-8').write(text)
    print('wrote %s' % rel_path)
    return True


if __name__ == '__main__':
    check = '--check' in sys.argv
    ok = True
    ok = _emit('data/knowledge-graph.json', _dump(build_graph()), check) and ok
    ok = _emit('llms.txt', build_llms(), check) and ok
    ok = _emit('sitemap.xml', build_sitemap(), check) and ok
    sys.exit(0 if ok else 1)
