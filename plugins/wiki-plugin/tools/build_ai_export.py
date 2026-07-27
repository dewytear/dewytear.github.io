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
  - llms-full.txt                full-corpus dump (llms.txt companion): every
                                 indexed doc's title/section/URL + plain-text body
                                 in one fetch, so an agent can load the whole wiki
                                 into context without crawling.
  - feed.xml                     Atom feed of the newest indexed docs. All dates
                                 come from data/doc-dates.json (git-derived, so
                                 the build stays deterministic — never "now").
  - robots.txt                   generated (BASE from config.json — no hardcoded
                                 host): explicit welcome for AI crawlers, the
                                 content license, and pointers to every machine
                                 entry point above.
  - data/knowledge-graph.json    self-contained graph: each node carries
                                 {name,title,summary,concepts,section,url,route,
                                 page,related} — index fields + the doc's fetchable
                                 URL and its static snapshot page inlined, so one
                                 fetch is enough to traverse.

Sitemap note: documents are advertised as prerendered snapshot pages
(/p/<name>/, built by tools/build_prerender.py) because those are real indexable
pages; the raw fragments stay reachable through the graph's `url` field.

Usage:  python3 tools/build_ai_export.py           # build + write
        python3 tools/build_ai_export.py --check    # verify outputs match on disk
"""
import html as _html
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'list')
LANG = 'ko'   # source-of-truth language; the graph is fetched from ko docs.
GUIDE_NAME = 'ai-guide'   # the public traversal-contract doc (nonum meta page).

# Content license — the legal signal that lets people and AI systems quote,
# index, and reuse the wiki with confidence. Declared in robots.txt, llms.txt,
# llms-full.txt and the site footer; keep the four in sync via this constant.
LICENSE_NAME = 'CC BY 4.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

# AI/LLM crawlers we explicitly welcome in robots.txt. `User-agent: *` already
# allows everyone; naming the big ones is a deliberate, machine-visible
# invitation (some operators treat an explicit Allow as a stronger signal).
AI_CRAWLERS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
    'ClaudeBot', 'Claude-Web', 'Claude-User', 'anthropic-ai',
    'PerplexityBot', 'Perplexity-User',
    'Google-Extended', 'Applebot-Extended',
    'CCBot', 'meta-externalagent', 'Bytespider', 'Amazonbot',
]


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


def _load_prerender():
    """The snapshot builder owns the list of extra (non-`list`) pages —
    load it rather than restating it here, so the two can't drift."""
    path = os.path.join(ROOT, 'tools', 'build_prerender.py')
    spec = importlib.util.spec_from_file_location('build_prerender_ref', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_build_index():
    """Reuse build_index.build()/load_sections()/CLUSTER_LABELS without running its CLI."""
    path = os.path.join(ROOT, 'tools', 'build_index.py')
    spec = importlib.util.spec_from_file_location('build_index_ref', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def translated_langs():
    """LANG(원본) 외의 번역 언어들 — 정본은 스냅샷 빌더의 LANGS."""
    return [l for l in _load_prerender().LANGS if l != LANG]


def langs_with_body(rel_path):
    """이 문서가 실제 본문을 가진 번역 언어들. 부분 번역 상태에서 없는 URL을
    광고하지 않기 위해 파일 존재로만 판정한다."""
    return [l for l in translated_langs() if _has_lang(rel_path, l)]


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


# 번역 파일 존재 여부 — en 본문이 있는 문서만 sitemap hreflang·llms 표기에
# 편입된다(부분 번역 상태에서 없는 URL을 광고하지 않는다).
def _has_lang(rel_path, lang):
    return os.path.isfile(os.path.join(ROOT, 'docs', lang, rel_path))


def doc_url_lang(name, paths, lang):
    return BASE + 'docs/' + lang + '/' + paths[name] if name in paths else ''


# 프리렌더 스냅샷 주소(tools/build_prerender.py가 생성) — 사람·검색엔진이
# JS 없이 읽는 정식 페이지. 사이트맵이 광고하는 URL이자 그래프 노드의 page.
def page_url(name, lang='ko'):
    return BASE + 'p/' + ('' if lang == 'ko' else lang + '/') + name + '/'


def _site_meta(lang=LANG):
    cfg = _config()
    title = cfg.get('title') or 'Wiki'
    # One-line description from config (mirrors index.html <meta description>).
    desc = cfg.get('description') or (title + ' — AI 지식 그래프 위키.')
    if lang != LANG:
        desc = cfg.get('description_' + lang) or desc
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
            # 정적 스냅샷(JS 없이 읽히는 페이지) — url(원문 조각)·route(SPA)와 병존.
            'page': page_url(d['name']),
            'related': d['related'],
            'relations': d.get('relations', []),
            # 본문 #!링크의 역인덱스(백링크) — 인덱스와 동일한 계산 필드 통과.
            'citedBy': d.get('citedBy', []),
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
    _, folder_docs, _secl = bi.load_sections()
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

    lines.append('License: %s (%s) — 출처를 밝히면 자유롭게 인용·재사용할 수 있다.'
                 % (LICENSE_NAME, LICENSE_URL))
    lines.append('')

    lines.append('## 기계 판독용 (Machine-readable — AI는 여기부터)')
    lines.append('- [지식 그래프 (단일 파일)](%sdata/knowledge-graph.json): 모든 노드(문서)와 '
                 '엣지(related)·개념·문서 URL·통계를 담은 자기완결 JSON. **먼저 이 파일을 '
                 'fetch해 그래프를 순회하라.**' % BASE)
    lines.append('- [전체 코퍼스 llms-full.txt](%sllms-full.txt): 모든 문서의 본문 텍스트를 '
                 '한 파일에 담은 덤프 — fetch 한 번으로 위키 전체를 컨텍스트에 적재.' % BASE)
    lines.append('- 정적 스냅샷 `%sp/<name>/`(영어는 `%sp/en/<name>/`): JS 없이 읽히는 '
                 '문서 페이지 — 그래프 노드의 `page` 필드가 같은 주소를 가리킨다.' % (BASE, BASE))
    lines.append('- [AI 순회 가이드](%sdocs/%s/ai/map/%s): 그래프를 어떻게 질의·순회·분석하는지의 '
                 '계약(노드·엣지·개념 조인·계층).' % (BASE, LANG, GUIDE_NAME))
    lines.append('- [지식 인덱스](%sdata/knowledge-index.%s.json) · [내비 트리](%slist) · '
                 '[문서 날짜](%sdata/doc-dates.json) · [Atom 피드](%sfeed.xml)'
                 % (BASE, LANG, BASE, BASE, BASE))
    en_count = sum(1 for n in by_name if n in paths and _has_lang(paths[n], 'en'))
    if en_count:
        lines.append('- English: %d/%d개 문서에 영어 본문이 있다 — 아래 목록의 [EN] 링크, '
                     '경로는 docs/en/<같은 상대 경로>.' % (en_count, st['docCount']))
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
            en = ''.join(' · [%s](%s)' % (l.upper(), doc_url_lang(n, paths, l))
                         for l in (langs_with_body(paths[n]) if n in paths else []))
            lines.append('- [%s](%s): %s%s' % (d['title'], url, summ, en))
        lines.append('')

    # Hubs are the most-referenced docs — a good analysis entry point.
    if st.get('hubs'):
        lines.append('## 허브 문서 (가장 많이 참조됨 — 분석 진입점)')
        for h in st['hubs']:
            url = doc_url(h['name'], paths)
            lines.append('- [%s](%s): 피참조 %d회' % (h['title'], url, h['refs']))
        lines.append('')

    return '\n'.join(lines).rstrip() + '\n'


def _doc_dates():
    """name -> {'c','u'} from data/doc-dates.json (git-derived, committed —
    deterministic across builds, unlike wall-clock time)."""
    p = os.path.join(ROOT, 'data', 'doc-dates.json')
    try:
        return json.load(open(p, encoding='utf-8')).get('docs', {})
    except (OSError, ValueError):
        return {}


_TAG_RE = re.compile(r'<[^>]+>')


def _doc_text(rel_path):
    """HTML fragment -> readable plain text (tags stripped, entities unescaped,
    whitespace collapsed per line). Unlike validate_docs.normalize_text this
    keeps case and line structure — it feeds humans-and-LLMs, not comparators."""
    fp = os.path.join(ROOT, 'docs', LANG, rel_path)
    try:
        raw = open(fp, encoding='utf-8').read()
    except OSError:
        return ''
    # Block-ish tags become line breaks so headings/list items stay separated.
    raw = re.sub(r'</(p|li|h[1-6]|tr|figcaption|blockquote|div)>', '\n', raw)
    raw = re.sub(r'<(br|hr)\s*/?>', '\n', raw)
    # Inline SVG diagrams: keep only their text labels (geometry is noise).
    raw = re.sub(r'<svg[^>]*>.*?</svg>',
                 lambda m: ' '.join(re.findall(r'<text[^>]*>([^<]*)</text>', m.group(0))),
                 raw, flags=re.S)
    text = _html.unescape(_TAG_RE.sub('', raw))
    lines = [re.sub(r'[ \t]+', ' ', ln).strip() for ln in text.splitlines()]
    out, blank = [], False
    for ln in lines:
        if ln:
            out.append(ln)
            blank = False
        elif not blank:
            out.append('')
            blank = True
    return '\n'.join(out).strip()


def build_llms_full():
    """llms-full.txt — the whole indexed corpus in one plain-text file.

    Order mirrors llms.txt (cluster order, then leftovers) so the two files
    read as summary/full versions of the same walk."""
    bi = _load_build_index()
    idx = bi.build(LANG)
    _, folder_docs, _secl = bi.load_sections()
    paths = load_paths()
    by_name = {d['name']: d for d in idx['docs']}
    title, desc = _site_meta()
    st = idx['stats']

    cluster_order = [s for s, _ in bi.CLUSTER_LABELS]
    ordered_sections = [s for s in cluster_order if s in folder_docs]
    for s in folder_docs:
        if s and s not in ordered_sections:
            ordered_sections.append(s)

    lines = []
    lines.append('# %s — full corpus (llms-full.txt)' % title)
    lines.append('')
    lines.append('> %s' % desc)
    lines.append('> License: %s (%s) — cite the source when quoting.' % (LICENSE_NAME, LICENSE_URL))
    lines.append('> %d documents · %d concepts. Summary/index version: %sllms.txt · '
                 'Knowledge graph: %sdata/knowledge-graph.json'
                 % (st['docCount'], st['conceptCount'], BASE, BASE))
    for section in ordered_sections:
        names = [n for n in folder_docs.get(section, []) if n in by_name]
        for n in names:
            d = by_name[n]
            body = _doc_text(paths.get(n, n))
            lines.append('')
            lines.append('---')
            lines.append('')
            lines.append('# %s' % d['title'])
            lines.append('Section: %s' % d['section'])
            lines.append('URL: %s' % doc_url(n, paths))
            lines.append('')
            lines.append(body)
    return '\n'.join(lines).rstrip() + '\n'


def build_feed(lang=LANG):
    """feed.xml / feed.en.xml (Atom) — newest indexed docs by creation date.

    Entries link to the **snapshot page** (/p/<name>/), not the hash route.
    Feed readers and aggregators do not run JavaScript, so `#!name` handed
    them the empty SPA shell — the feed advertised the wiki and then showed
    nothing. The snapshot is a real page with the body in it.

    Every timestamp comes from data/doc-dates.json; the channel <updated> is
    the max doc `u`, never the build clock, so --check stays deterministic."""
    bi = _load_build_index()
    idx = bi.build(lang)
    paths = load_paths()
    dates = _doc_dates()
    title, desc = _site_meta(lang)
    fname = 'feed.xml' if lang == LANG else 'feed.%s.xml' % lang

    docs = [d for d in idx['docs'] if d['name'] in dates and d['name'] in paths]
    if lang != LANG:
        # Only advertise entries that really have a page in this language —
        # a partly translated wiki must not link to snapshots that don't exist.
        docs = [d for d in docs if _has_lang(paths[d['name']], lang)]
    docs.sort(key=lambda d: dates[d['name']]['c'], reverse=True)
    docs = docs[:30]
    if not docs:
        return ''
    feed_updated = max(dates[d['name']]['u'] for d in docs)

    def esc(s):
        return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))

    e = []
    e.append('<?xml version="1.0" encoding="utf-8"?>')
    e.append('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="%s">' % lang)
    e.append('  <title>%s</title>' % esc(title))
    e.append('  <subtitle>%s</subtitle>' % esc(desc))
    e.append('  <link href="%s"/>' % BASE)
    e.append('  <link rel="self" href="%s%s"/>' % (BASE, fname))
    # Atom <id> is the feed's permanent identity — the Korean feed keeps the
    # one it has always had so existing subscribers are not handed a "new" feed.
    e.append('  <id>%s</id>' % (BASE if lang == LANG else BASE + fname))
    e.append('  <updated>%s</updated>' % feed_updated)
    e.append('  <rights>%s — %s</rights>' % (LICENSE_NAME, LICENSE_URL))
    e.append('  <author><name>dewytear</name></author>')
    for d in docs:
        n = d['name']
        e.append('  <entry>')
        e.append('    <title>%s</title>' % esc(d['title']))
        e.append('    <link href="%s"/>' % page_url(n, lang))
        e.append('    <id>%s</id>' % doc_url_lang(n, paths, lang))
        e.append('    <published>%s</published>' % dates[n]['c'])
        e.append('    <updated>%s</updated>' % dates[n]['u'])
        e.append('    <summary>%s</summary>' % esc(d['summary']))
        e.append('    <category term="%s"/>' % esc(d['section']))
        e.append('  </entry>')
    e.append('</feed>')
    return '\n'.join(e) + '\n'


def build_robots():
    """robots.txt — generated so BASE lives in config.json only.

    Everyone is allowed; the named AI crawlers are an explicit, machine-visible
    welcome, and the license line tells them reuse-with-attribution is fine."""
    lines = []
    lines.append('# All crawlers welcome — including AI/LLM crawlers (explicitly below).')
    lines.append('# License: %s (%s) — quote and reuse with attribution.' % (LICENSE_NAME, LICENSE_URL))
    lines.append('User-agent: *')
    lines.append('Allow: /')
    lines.append('')
    for ua in AI_CRAWLERS:
        lines.append('User-agent: %s' % ua)
    lines.append('Allow: /')
    lines.append('')
    lines.append('Sitemap: %ssitemap.xml' % BASE)
    lines.append('')
    lines.append('# AI/LLM entry points')
    lines.append('# Sign-post (llmstxt.org):        %sllms.txt' % BASE)
    lines.append('# Full corpus (one fetch):        %sllms-full.txt' % BASE)
    lines.append('# Self-contained knowledge graph: %sdata/knowledge-graph.json' % BASE)
    langs = [l for l in translated_langs()
             if os.path.isdir(os.path.join(ROOT, 'docs', l))]
    feeds = ''.join('  (%s: %sfeed.%s.xml)' % (l, BASE, l) for l in langs)
    hubs = ''.join('  (%s: %sp/%s/)' % (l, BASE, l) for l in langs)
    lines.append('# Atom feed (newest docs):        %sfeed.xml%s' % (BASE, feeds))
    lines.append('# All documents, one page:        %sp/%s' % (BASE, hubs))
    lines.append('# Traversal guide:                %sdocs/%s/ai/map/%s' % (BASE, LANG, GUIDE_NAME))
    return '\n'.join(lines) + '\n'


def build_sitemap():
    """sitemap.xml — homepage + machine files + every doc's snapshot page.

    Documents are advertised as their prerendered pages (/p/<name>/), not the
    raw fragments: a snapshot is a real indexable page with title, description
    and canonical, whereas the fragment is a body-less HTML chunk. Machines
    that want the raw text still get it from llms-full.txt and the graph's
    `url` field. Built from `list` in nav order, so new docs appear
    automatically. No <lastmod> (would churn --check daily)."""
    paths = load_paths()
    pr = _load_prerender()
    tree = json.load(open(LIST, encoding='utf-8'))
    order = []

    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                walk(n['children'])
            elif n.get('name') and n.get('path') and not n.get('route'):
                order.append(n['name'])
    walk(tree if isinstance(tree, list) else tree.get('children', tree))
    # Pages that live outside `list` but still get a snapshot (About, …).
    for extra, cfg in pr.EXTRA_PAGES.items():
        if extra not in paths:
            paths[extra] = cfg['path']
            order.append(extra)

    body = ''
    fixed = [BASE, BASE + 'p/']
    live = [l for l in translated_langs()
            if any(_has_lang(paths[n], l) for n in order if n in paths)]
    fixed += [BASE + 'p/' + l + '/' for l in live]
    fixed += [BASE + 'llms.txt', BASE + 'llms-full.txt', BASE + 'feed.xml']
    fixed += [BASE + 'feed.%s.xml' % l for l in live]
    fixed += [BASE + 'data/knowledge-graph.json']
    for u in fixed:
        body += '  <url><loc>%s</loc></url>\n' % u
    # 문서 URL: en 번역이 있으면 ko/en 두 URL을 모두 싣고, 각각에
    # hreflang alternate(ko·en·x-default=원본 ko)를 단다 — 검색엔진이
    # 언어별 원문을 정확히 매칭하게(부분 번역 상태 안전).
    for n in order:
        if n not in paths:
            continue
        ko = page_url(n, 'ko')
        others = langs_with_body(paths[n])
        if others:
            alts = '    <xhtml:link rel="alternate" hreflang="ko" href="%s"/>\n' % ko
            for l in others:
                alts += ('    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>\n'
                         % (l, page_url(n, l)))
            alts += '    <xhtml:link rel="alternate" hreflang="x-default" href="%s"/>\n' % ko
            for u in [ko] + [page_url(n, l) for l in others]:
                body += '  <url><loc>%s</loc>\n%s  </url>\n' % (u, alts)
        else:
            body += '  <url><loc>%s</loc></url>\n' % ko
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
            '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
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
    ok = _emit('llms-full.txt', build_llms_full(), check) and ok
    ok = _emit('feed.xml', build_feed(), check) and ok
    for l in translated_langs():
        text = build_feed(l)
        if text.strip():
            ok = _emit('feed.%s.xml' % l, text, check) and ok
    ok = _emit('robots.txt', build_robots(), check) and ok
    ok = _emit('sitemap.xml', build_sitemap(), check) and ok
    sys.exit(0 if ok else 1)
