#!/usr/bin/env python3
"""Build static prerendered snapshots of every indexed document.

The wiki is a hash-routed SPA: a crawler that does not run JavaScript sees an
empty shell at `#!name`. The AI layer (llms.txt / knowledge-graph.json) already
hands machines the raw fragments, but ordinary search engines index *pages*,
not fragment files. This script closes that gap by emitting one real HTML page
per document — body inlined, title/description/canonical/hreflang/JSON-LD in
the head — so the wiki is discoverable without JS while the SPA stays the
canonical reading experience for people.

Outputs (deterministic — same inputs, same bytes; CI verifies with --check):
  p/index.html               Korean hub — every snapshot, grouped by section
  p/en/index.html            English hub
  p/<name>/index.html        Korean snapshot of every indexed document
  p/en/<name>/index.html     English snapshot (only where docs/en/<path> exists)

Each snapshot:
  - <title> = the document's first <h2>, <meta name="description"> = its summary
  - <link rel="canonical"> to itself + hreflang alternates (ko / en / x-default)
  - Open Graph + Twitter card so a shared link unfurls with title, summary and
    an image (the document's own hero when it has one, else the site card)
  - Article JSON-LD with the CC BY 4.0 license and the doc's dates
  - the document fragment inlined, with #! links rewritten to sibling snapshots
  - a visible "open it in the wiki" link to the SPA route

The snapshot deliberately does NOT bounce visitors to the SPA. An earlier
version put `location.replace('/#!name')` in the head, which threw away the
very thing this script exists to create: a stable per-document URL. Someone
arriving from a search result or a shared link would watch the address turn
into `/#!name`, so bookmarking or re-sharing lost the page identity, and a
crawler's JS-rendering pass saw a redirect where the raw fetch saw an article.
The snapshot is now a real landing page; the wiki is one click away.

Usage:  python3 tools/build_prerender.py          # build + write
        python3 tools/build_prerender.py --check   # verify outputs on disk
"""
import html as _html
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'list')
KO = 'ko'
LANGS = ['ko', 'en', 'ja']
OUT_DIR = 'p'

LICENSE_NAME = 'CC BY 4.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
# Default share card (1200×630). A document with its own hero image uses that
# instead — see hero_for(). Kept at the site root so index.html can reuse it.
OG_IMAGE = 'og-image.png'

# Pages that are not `list` documents but are worth a crawlable, shareable URL.
# `about` is the one page an international visitor most wants to land on, and
# it already has a full English translation — it just never had a page.
EXTRA_PAGES = {
    'about': {
        'path': 'about',
        'section': {'ko': '소개', 'en': 'About', 'ja': '紹介'},
        'summary': {
            'ko': '곽영진 — 더존비즈온 책임연구원. 복잡한 일을 구조화하고 반복된 경험을 '
                  '시스템과 지식으로 바꾸는 일을 합니다.',
            'ja': '郭永珍（クァク・ヨンジン）— ダウンビジョン主任研究員。複雑な仕事を構造化し、'
                  '繰り返した経験をシステムと知識に変える仕事をしています。',
            'en': 'Youngjin Kwak — Principal Researcher at Douzone Bizon. I structure '
                  'complex work and turn repeated experience into systems and knowledge.',
        },
    },
    # 지도·순회 가이드 3편. `list`에는 있지만 doc-entries(지식 인덱스)에는
    # 없다 — 인덱스 대상 콘텐츠가 아니라 위키를 **읽는 법**을 설명하는
    # 메타 문서이기 때문이다. 그래서 2026-07-28까지 스냅샷이 없었는데,
    # 사이트맵은 `list`를 보고 URL을 실었다 → /p/ai-guide/ 등 9개가 404.
    # 특히 ai-guide는 llms.txt가 "AI 순회 가이드"로 링크하는 계약 문서라
    # JS 없는 크롤러에게 반드시 실물 페이지여야 한다.
    'ai-map': {
        'path': 'ai/map/ai-map',
        'section': {'ko': '지식지도', 'en': 'Knowledge Map', 'ja': '知識の地図'},
        'summary': {
            'ko': 'AI World의 지식 지도 — System별 문서 수·허브 문서와 '
                  '여러 System을 잇는 브리지 개념을 한눈에.',
            'en': 'The knowledge map of the AI World — documents and hub pages per '
                  'System, plus the bridge concepts that span several Systems.',
            'ja': 'AI World の知識の地図 — System ごとの文書の数・ハブ文書と、'
                  'いくつもの System をつなぐ橋の概念を一目で。',
        },
    },
    'ai-guide': {
        'path': 'ai/map/ai-guide',
        'section': {'ko': '지식지도', 'en': 'Knowledge Map', 'ja': '知識の地図'},
        'summary': {
            'ko': '외부 AI가 이 위키를 순회·분석하는 계약 — 어떤 파일을 어떤 '
                  '순서로 fetch하고 노드·엣지·개념을 어떻게 읽는지.',
            'en': 'The contract for an external AI traversing this wiki — which files '
                  'to fetch in what order, and how to read nodes, edges and concepts.',
            'ja': '外部の AI がこのウィキを巡回・分析するための契約 — どのファイルを'
                  'どの順に fetch し、ノード・エッジ・概念をどう読むか。',
        },
    },
    'dz-map': {
        'path': 'douzone/map/dz-map',
        'section': {'ko': '지식지도', 'en': 'Knowledge Map', 'ja': '知識の地図'},
        'summary': {
            'ko': 'Douzone World의 지식 지도 — 제안 시리즈별 문서 수·허브 문서와 '
                  'AI World로 이어지는 개념 다리.',
            'en': 'The knowledge map of the Douzone World — documents and hub pages per '
                  'proposal series, and the concept bridges reaching into the AI World.',
            'ja': 'Douzone World の知識の地図 — 提案のシリーズごとの文書の数・ハブ文書と、'
                  'AI World へつながる概念の橋。',
        },
    },
}


def snapshot_names():
    """스냅샷이 실제로 생성되는 문서 이름 — **사이트맵이 이 목록을 정본으로 읽는다.**

    두 생성기가 서로 다른 규칙으로 문서를 고르면 사이트맵에 404가 실린다:
    2026-07-28까지 build_sitemap은 `list` 전체를, 여기는 인덱스 문서만
    대상으로 삼아 **워크로그 63편의 /p/<name>/ 가 죽은 URL로 제출되고
    있었다**. 선택 규칙은 한 군데(여기)에만 둔다."""
    bi = _load_build_index()
    return {d['name'] for d in bi.build(KO)['docs']} | set(EXTRA_PAGES)

# og:locale — 언어를 늘릴 때 STR와 함께 채운다(빠지면 그 언어 스냅샷이
# en_US로 나간다: 2026-07-28까지 ja 116쪽이 그랬다).
OG_LOCALE = {'ko': 'ko_KR', 'en': 'en_US', 'ja': 'ja_JP'}

# UI strings for the snapshot chrome, per language (kept tiny on purpose —
# the snapshot is a reading fallback, not a second implementation of the app).
STR = {
    'ko': {
        'live': '이 페이지는 정적 스냅샷입니다 — 위키에서 열기',
        'section': '분류',
        'created': '생성일자',
        'updated': '수정일자',
        'related': '연관 문서',
        'other_lang': 'English',
        'self_name': '한국어',
        'hub_title': '문서 전체 목록',
        'hub_desc': '이 위키의 모든 문서를 한 페이지에 — 분류별 목록.',
        'hub_lead': '위키의 모든 문서입니다. 각 링크는 JS 없이 읽히는 정적 페이지로 이어집니다.',
        'home': '위키 홈',
    },
    'ja': {
        'live': 'これは静的スナップショットです — ウィキで開く',
        'section': '分類',
        'created': '作成日',
        'updated': '更新日',
        'related': '関連文書',
        'other_lang': '한국어',
        'self_name': '日本語',
        'hub_title': '全文書一覧',
        'hub_desc': 'このウィキの全文書を1ページに — 分類別の一覧。',
        'hub_lead': 'ウィキの全文書です。各リンクは JavaScript なしで読める静的ページに繋がります。',
        'home': 'ウィキのホーム',
    },
    'en': {
        'live': 'This is a static snapshot — open it in the wiki',
        'section': 'Section',
        'created': 'Created',
        'updated': 'Updated',
        'related': 'Related documents',
        'other_lang': '한국어',
        'self_name': 'English',
        'hub_title': 'All documents',
        'hub_desc': 'Every document in this wiki on one page, grouped by section.',
        'hub_lead': 'Every document in the wiki. Each link is a static page that reads without JavaScript.',
        'home': 'Wiki home',
    },
}


def _config():
    try:
        return json.load(open(os.path.join(ROOT, 'config.json'), encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def _base():
    u = (_config().get('url') or 'https://example.github.io/').strip()
    return u if u.endswith('/') else u + '/'


BASE = _base()
# 리다이렉트·본문 링크는 호스트에 묶이지 않게 루트 상대 경로를 쓴다 —
# 로컬 서버·프리뷰 배포에서도 그대로 동작해야 검증이 성립한다.
# (canonical·hreflang·JSON-LD는 규격상 절대 URL이므로 BASE를 유지.)
BASE_PATH = re.sub(r'^https?://[^/]+', '', BASE) or '/'


def _load_build_index():
    path = os.path.join(ROOT, 'tools', 'build_index.py')
    spec = importlib.util.spec_from_file_location('build_index_ref', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_paths():
    """name -> physical path under docs/<lang>/ (leaf document nodes)."""
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


def list_order():
    """Document names in nav order, with the EXTRA_PAGES appended.

    The hub lists documents the way the sidebar does, so a reader (and a
    crawler) meets them in the order the wiki intends."""
    tree = json.load(open(LIST, encoding='utf-8'))
    order = []

    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                walk(n['children'])
            elif n.get('name') and n.get('path') and not n.get('route'):
                order.append(n['name'])
    walk(tree if isinstance(tree, list) else tree.get('children', tree))
    return order + [n for n in EXTRA_PAGES if n not in order]


def _doc_dates():
    p = os.path.join(ROOT, 'data', 'doc-dates.json')
    try:
        return json.load(open(p, encoding='utf-8')).get('docs', {})
    except (OSError, ValueError):
        return {}


_H2_RE = re.compile(r'<h2[^>]*>(.*?)</h2>', re.I | re.S)
_TAG_RE = re.compile(r'<[^>]+>')
_GLYPHS = re.compile(r'^[\s❖✦§·\-–—•*#>:]+')


def first_h2(raw):
    """The document's own title — same extraction as validate_docs."""
    m = _H2_RE.search(raw)
    if not m:
        return None
    text = _html.unescape(_TAG_RE.sub(' ', m.group(1)))
    return _GLYPHS.sub('', re.sub(r'\s+', ' ', text)).strip()


def esc(s):
    return _html.escape(s or '', quote=True)


def snapshot_url(name, lang):
    """Absolute — for canonical / hreflang / JSON-LD."""
    return BASE + OUT_DIR + '/' + ('' if lang == KO else lang + '/') + name + '/'


def snapshot_path(name, lang):
    """Root-relative — for in-page navigation (host-independent)."""
    return BASE_PATH + OUT_DIR + '/' + ('' if lang == KO else lang + '/') + name + '/'


def route_path(name):
    """Root-relative SPA route for this document."""
    return BASE_PATH + '#!' + name


def hub_url(lang):
    return BASE + OUT_DIR + '/' + ('' if lang == KO else lang + '/')


def hub_path(lang):
    return BASE_PATH + OUT_DIR + '/' + ('' if lang == KO else lang + '/')


def hero_for(rel_path):
    """A document's own share image, if it committed one.

    Doc images live at assets/<the doc's path>/<role>.webp (language-neutral),
    so a hero is a plain file check — no index lookup, no guessing."""
    if not rel_path:
        return None
    rel = os.path.join('assets', rel_path, 'hero.webp')
    return rel if os.path.isfile(os.path.join(ROOT, rel)) else None


def social_tags(title, desc, url, image, lang, kind='article'):
    """Open Graph + Twitter card.

    Without these a shared link renders as a bare grey URL everywhere that
    unfurls (X, Slack, Discord, LinkedIn, KakaoTalk) — and unfurlers do not
    run JavaScript, so the SPA cannot supply them at share time. Only the
    static pages can, which is the other half of why they exist."""
    site, _ = _site_title_desc()
    return [
        '<meta property="og:type" content="%s">' % kind,
        '<meta property="og:title" content="%s">' % esc(title),
        '<meta property="og:description" content="%s">' % esc(desc),
        '<meta property="og:url" content="%s">' % esc(url),
        '<meta property="og:image" content="%s">' % esc(image),
        '<meta property="og:site_name" content="%s">' % esc(site),
        '<meta property="og:locale" content="%s">' % OG_LOCALE.get(lang, 'en_US'),
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="%s">' % esc(title),
        '<meta name="twitter:description" content="%s">' % esc(desc),
        '<meta name="twitter:image" content="%s">' % esc(image),
    ]


def _site_title_desc():
    cfg = _config()
    return (cfg.get('title') or 'Wiki'), (cfg.get('description') or '')


def icon_links():
    """Favicon links, absolute via BASE_PATH so they resolve from any /p/ depth.
    Mirrors index.html: theme-following SVG + night-teal raster fallbacks."""
    return [
        '<link rel="icon" href="%sfavicon.svg" type="image/svg+xml">' % BASE_PATH,
        '<link rel="icon" href="%sfavicon.ico" sizes="48x48">' % BASE_PATH,
        '<link rel="apple-touch-icon" href="%sapple-touch-icon.png">' % BASE_PATH,
    ]


def rewrite_links(body, lang):
    """`href="#!other"` -> the sibling snapshot, so a JS-less crawler can walk
    the whole wiki through static pages. Same-language target; unknown targets
    fall back to the SPA route (they are validated elsewhere, so this is just
    defensive)."""
    def sub(m):
        target = m.group(1)
        return 'href="%s"' % snapshot_path(target, lang)
    return re.sub(r'href="#!([A-Za-z0-9._-]+)"', sub, body)


def page_style():
    """Snapshot chrome. The page loads the site's style.css for the body, so
    this only positions the wrapper and the small metadata lines."""
    return ('<style>'
            'body{max-width:760px;margin:0 auto;padding:24px 18px 64px;'
            'font-family:Pretendard,system-ui,sans-serif;line-height:1.7}'
            '.pr-live{font-size:13px;margin:0 0 18px}'
            '.pr-meta{font-size:12.5px;color:#666;margin:0 0 24px}'
            '.pr-k{color:#999;margin-right:4px}'
            '.pr-rel{margin-top:40px;font-size:14px}'
            '.pr-hub h3{margin:28px 0 6px;font-size:15px}'
            '.pr-hub ul{margin:0;padding-left:20px;font-size:14px}'
            '</style>')


def page_html(name, lang, meta, body, dates, paths, langs):
    """One snapshot page. Self-contained head, site CSS by absolute URL."""
    title = meta['title']
    desc = meta['summary']
    s = STR[lang]
    route = route_path(name)              # in-page navigation (host-independent)
    route_abs = BASE + '#!' + name        # canonical/JSON-LD form
    self_url = snapshot_url(name, lang)
    d = dates.get(name, {})

    alts = ['    <link rel="canonical" href="%s">' % self_url,
            '    <link rel="alternate" hreflang="ko" href="%s">' % snapshot_url(name, 'ko')]
    for other in langs:
        if other != KO:
            alts.append('    <link rel="alternate" hreflang="%s" href="%s">'
                        % (other, snapshot_url(name, other)))
    alts.append('    <link rel="alternate" hreflang="x-default" href="%s">' % snapshot_url(name, 'ko'))

    ld = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': title,
        'description': desc,
        'inLanguage': lang,
        'url': self_url,
        'mainEntityOfPage': route_abs,
        'license': LICENSE_URL,
        'author': {'@type': 'Person', 'name': 'dewytear'},
        'publisher': {'@type': 'Person', 'name': 'dewytear'},
        'isAccessibleForFree': True,
    }
    if d.get('c'):
        ld['datePublished'] = d['c']
    if d.get('u'):
        ld['dateModified'] = d['u']

    dl = []
    if meta.get('section'):
        dl.append('<span class="pr-k">%s</span> %s' % (esc(s['section']), esc(meta['section'])))
    if d.get('c'):
        dl.append('<span class="pr-k">%s</span> %s' % (esc(s['created']), d['c'][:10]))
    if d.get('u'):
        dl.append('<span class="pr-k">%s</span> %s' % (esc(s['updated']), d['u'][:10]))

    rel = ''
    if meta.get('related'):
        items = ''.join(
            '<li><a href="%s">%s</a></li>' % (snapshot_path(r['name'], lang), esc(r['title']))
            for r in meta['related'])
        rel = ('\n<nav class="pr-rel"><h2>%s</h2>\n<ul>%s</ul>\n</nav>'
               % (esc(s['related']), items))

    # 이 문서가 존재하는 다른 언어들로 가는 상호링크 — 언어가 셋 이상이면
    # "다른 언어" 하나로 표현할 수 없으므로 각 언어의 자기 이름을 쓴다.
    other = ''.join('  &middot; <a href="%s" hreflang="%s">%s</a>\n'
                    % (snapshot_path(name, ol), ol, esc(STR[ol]['self_name']))
                    for ol in langs if ol != lang)

    out = []
    out.append('<!doctype html>')
    out.append('<html lang="%s">' % lang)
    out.append('<head>')
    out.append('<meta charset="utf-8">')
    out.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    out.append('<title>%s</title>' % esc(title))
    out.append('<meta name="description" content="%s">' % esc(desc))
    out.append('<meta name="robots" content="index, follow">')
    out.extend(alts)
    out.append('    <link rel="license" href="%s">' % LICENSE_URL)
    hero = hero_for(meta.get('rel_path'))
    out.extend(social_tags(title, desc, self_url, BASE + (hero or OG_IMAGE), lang))
    out.extend(icon_links())
    out.append('<link rel="stylesheet" href="%sstyle.css">' % BASE_PATH)
    out.append('<script type="application/ld+json">')
    out.append(json.dumps(ld, ensure_ascii=False, indent=1))
    out.append('</script>')
    out.append(page_style())
    out.append('</head>')
    out.append('<body class="day prerender">')
    out.append('<p class="pr-live"><a href="%s">%s &#8599;</a>' % (route, esc(s['live'])))
    out.append(other + '</p>')
    out.append('<article>')
    out.append(body.strip())
    out.append('</article>')
    if dl:
        out.append('<p class="pr-meta">' + ' &middot; '.join(dl) + '</p>')
    if rel:
        out.append(rel)
    out.append('</body>')
    out.append('</html>')
    return '\n'.join(out) + '\n'


def hub_html(lang, entries, langs):
    """The one page that makes the whole wiki walkable without JavaScript.

    index.html is an empty SPA shell: a crawler that reads the raw HTML finds
    no link to any document, so the snapshots were reachable only through the
    sitemap. This hub is a plain <ul> of every one of them, linked from the
    home page, so discovery no longer depends on the sitemap being read."""
    s = STR[lang]
    self_url = hub_url(lang)
    title, _ = _site_title_desc()
    head_title = '%s — %s' % (s['hub_title'], title)

    alts = ['    <link rel="canonical" href="%s">' % self_url,
            '    <link rel="alternate" hreflang="ko" href="%s">' % hub_url(KO)]
    for other in langs:
        if other != KO:
            alts.append('    <link rel="alternate" hreflang="%s" href="%s">' % (other, hub_url(other)))
    alts.append('    <link rel="alternate" hreflang="x-default" href="%s">' % hub_url(KO))

    out = []
    out.append('<!doctype html>')
    out.append('<html lang="%s">' % lang)
    out.append('<head>')
    out.append('<meta charset="utf-8">')
    out.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    out.append('<title>%s</title>' % esc(head_title))
    out.append('<meta name="description" content="%s">' % esc(s['hub_desc']))
    out.append('<meta name="robots" content="index, follow">')
    out.extend(alts)
    out.append('    <link rel="license" href="%s">' % LICENSE_URL)
    out.extend(social_tags(head_title, s['hub_desc'], self_url,
                           BASE + OG_IMAGE, lang, kind='website'))
    out.extend(icon_links())
    out.append('<link rel="stylesheet" href="%sstyle.css">' % BASE_PATH)
    out.append(page_style())
    out.append('</head>')
    out.append('<body class="day prerender">')
    out.append('<p class="pr-live"><a href="%s">%s &#8599;</a>'
               % (BASE_PATH, esc(s['home'])))
    for ol in langs:
        if ol == lang:
            continue
        out.append('  &middot; <a href="%s" hreflang="%s">%s</a>'
                   % (hub_path(ol), ol, esc(STR[ol]['self_name'])))
    out.append('</p>')
    out.append('<h2>%s</h2>' % esc(s['hub_title']))
    out.append('<p>%s</p>' % esc(s['hub_lead']))
    out.append('<div class="pr-hub">')
    for section, items in entries:
        out.append('<h3>%s</h3>' % esc(section))
        out.append('<ul>')
        for name, doc_title in items:
            out.append('<li><a href="%s">%s</a></li>'
                       % (snapshot_path(name, lang), esc(doc_title)))
        out.append('</ul>')
    out.append('</div>')
    out.append('</body>')
    out.append('</html>')
    return '\n'.join(out) + '\n'


def _extra_meta(name, lang, raw):
    """Meta for a non-`list` page (see EXTRA_PAGES) — no index entry to read."""
    x = EXTRA_PAGES[name]
    return {
        'title': first_h2(raw) or name,
        'summary': x['summary'].get(lang, x['summary'][KO]),
        'section': x['section'].get(lang, x['section'][KO]),
        'related': [],
        'rel_path': x['path'],
    }


def build_pages():
    """rel_path -> html for every snapshot page (hubs included)."""
    bi = _load_build_index()
    paths = load_paths()
    dates = _doc_dates()
    pages = {}
    hubs = {}
    order = list_order()
    for lang in LANGS:
        idx = bi.build(lang)
        by_name = {d['name']: d for d in idx['docs']}
        hub = []            # [(section, [(name, title), …])] in nav order
        for name in order:
            doc = by_name.get(name)
            rel = paths.get(name) or (EXTRA_PAGES.get(name) or {}).get('path')
            if not rel or (doc is None and name not in EXTRA_PAGES):
                continue
            src = os.path.join(ROOT, 'docs', lang, rel)
            if not os.path.isfile(src):
                continue          # untranslated in this language — no snapshot
            raw = open(src, encoding='utf-8').read()
            # 이 문서가 실제로 존재하는 언어들 — hreflang·상호링크의 근거.
            langs = [l for l in LANGS
                     if os.path.isfile(os.path.join(ROOT, 'docs', l, rel))]
            if doc is None:
                meta = _extra_meta(name, lang, raw)
            else:
                meta = {
                    'title': first_h2(raw) or doc['title'],
                    'summary': doc['summary'],
                    # section은 언어 무관 canonical 조인 키라 그대로 쓰면
                    # en·ja 스냅샷에 한국어 분류가 박힌다(허브 <h3> 16건 · 문서
                    # '분류' 줄). SPA는 이미 sectionL을 쓴다 — 스냅샷도 맞춘다.
                    'section': doc.get('sectionL') or doc['section'],
                    'related': doc.get('related', []),
                    'rel_path': rel,
                }
            out_rel = os.path.join(OUT_DIR, '' if lang == KO else lang, name, 'index.html')
            pages[out_rel] = page_html(name, lang, meta, rewrite_links(raw, lang),
                                       dates, paths, langs)
            sec = meta['section'] or STR[lang]['hub_title']
            if not hub or hub[-1][0] != sec:
                hub.append((sec, []))
            hub[-1][1].append((name, meta['title']))
        hubs[lang] = hub
    # 허브는 모든 언어를 다 돈 뒤에 만든다 — 상호링크가 "실제로 문서가 있는
    # 언어"만 가리켜야 하기 때문(빈 허브를 광고하지 않는다).
    live = [l for l in LANGS if hubs.get(l)]
    for lang in live:
        pages[os.path.join(OUT_DIR, '' if lang == KO else lang, 'index.html')] = \
            hub_html(lang, hubs[lang], live)
    return pages


def build_404():
    """GitHub Pages 404 -> the SPA, preserving the requested route.

    A visitor landing on /p/<name>/ that no longer exists (renamed doc) still
    reaches the wiki instead of a dead end."""
    return (
        '<!doctype html>\n<html lang="ko">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<title>Not Found</title>\n'
        + '\n'.join(icon_links()) + '\n'
        '<script>\n'
        '// /p/<name>/ (or /p/en/<name>/) -> the SPA route for that document;\n'
        '// anything else -> the wiki home. A dead /p/en/ URL keeps its\n'
        '// language by asking the SPA for English (?lang=en), so an English\n'
        '// reader whose bookmark rotted does not land in Korean.\n'
        'var m = location.pathname.match(/\\/p\\/(?:([a-z]{2})\\/)?([A-Za-z0-9._-]+)\\/?$/);\n'
        'var q = m && m[1] && m[1] !== "ko" ? "?lang=" + m[1] : "";\n'
        'location.replace(m ? "/" + q + "#!" + m[2] : "/");\n'
        '</script>\n</head>\n<body>\n'
        '<p><a href="/">Aaron\'s Claude Wiki</a></p>\n'
        '</body>\n</html>\n')


def _emit(rel_path, text, check):
    target = os.path.join(ROOT, rel_path)
    if check:
        cur = open(target, encoding='utf-8').read() if os.path.exists(target) else ''
        if cur.strip() == text.strip():
            return True, None
        return False, rel_path
    os.makedirs(os.path.dirname(target), exist_ok=True)
    open(target, 'w', encoding='utf-8').write(text)
    return True, None


def _stale_snapshots(pages):
    """Snapshot files on disk that the current index no longer produces
    (a renamed or removed document) — they would rot silently otherwise."""
    root = os.path.join(ROOT, OUT_DIR)
    if not os.path.isdir(root):
        return []
    live = set(pages)
    stale = []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
            if rel not in live:
                stale.append(rel)
    return sorted(stale)


if __name__ == '__main__':
    check = '--check' in sys.argv
    pages = build_pages()
    pages['404.html'] = build_404()
    drift = []
    for rel, text in sorted(pages.items()):
        ok, bad = _emit(rel, text, check)
        if not ok:
            drift.append(bad)
    stale = _stale_snapshots({k: v for k, v in pages.items() if k != '404.html'})
    if check:
        if drift or stale:
            for d in drift[:10]:
                print('DRIFT: %s differs from a fresh build.' % d)
            if len(drift) > 10:
                print('DRIFT: … and %d more' % (len(drift) - 10))
            for s in stale[:10]:
                print('STALE: %s is no longer produced — delete it.' % s)
            print('Run tools/build_prerender.py without --check to rewrite.')
            sys.exit(1)
        print('OK: %d prerender pages + 404.html are up to date' % (len(pages) - 1))
    else:
        for s in stale:
            os.remove(os.path.join(ROOT, s))
        print('wrote %d prerender pages + 404.html%s'
              % (len(pages) - 1, (' (removed %d stale)' % len(stale)) if stale else ''))
