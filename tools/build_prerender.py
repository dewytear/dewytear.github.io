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
  p/<name>/index.html        Korean snapshot of every indexed document
  p/en/<name>/index.html     English snapshot (only where docs/en/<path> exists)

Each snapshot:
  - <title> = the document's first <h2>, <meta name="description"> = its summary
  - <link rel="canonical"> to itself + hreflang alternates (ko / en / x-default)
  - Article JSON-LD with the CC BY 4.0 license and the doc's dates
  - the document fragment inlined, with #! links rewritten to sibling snapshots
  - a visible "this is a snapshot -> open the live wiki" link, and a JS redirect
    to the SPA route so a human who lands here gets the real thing
    (crawlers without JS keep the static text; noscript keeps the link visible)

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
LANGS = ['ko', 'en']
OUT_DIR = 'p'

LICENSE_NAME = 'CC BY 4.0'
LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

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
    },
    'en': {
        'live': 'This is a static snapshot — open it in the wiki',
        'section': 'Section',
        'created': 'Created',
        'updated': 'Updated',
        'related': 'Related documents',
        'other_lang': '한국어',
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


def rewrite_links(body, lang):
    """`href="#!other"` -> the sibling snapshot, so a JS-less crawler can walk
    the whole wiki through static pages. Same-language target; unknown targets
    fall back to the SPA route (they are validated elsewhere, so this is just
    defensive)."""
    def sub(m):
        target = m.group(1)
        return 'href="%s"' % snapshot_path(target, lang)
    return re.sub(r'href="#!([A-Za-z0-9._-]+)"', sub, body)


def page_html(name, lang, meta, body, dates, paths, has_en):
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
    if has_en:
        alts.append('    <link rel="alternate" hreflang="en" href="%s">' % snapshot_url(name, 'en'))
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

    other = ''
    if has_en:
        ol = 'en' if lang == KO else KO
        other = ('  &middot; <a href="%s" hreflang="%s">%s</a>\n'
                 % (snapshot_path(name, ol), ol, esc(s['other_lang'])))

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
    out.append('<link rel="stylesheet" href="%sstyle.css">' % BASE_PATH)
    out.append('<script type="application/ld+json">')
    out.append(json.dumps(ld, ensure_ascii=False, indent=1))
    out.append('</script>')
    # Humans get the interactive wiki; crawlers (no JS) keep the static text.
    out.append('<script>if(!location.search.includes("static")){'
               'location.replace(%s);}</script>' % json.dumps(route))
    out.append('<style>'
               'body{max-width:760px;margin:0 auto;padding:24px 18px 64px;'
               'font-family:Pretendard,system-ui,sans-serif;line-height:1.7}'
               '.pr-live{font-size:13px;margin:0 0 18px}'
               '.pr-meta{font-size:12.5px;color:#666;margin:0 0 24px}'
               '.pr-k{color:#999;margin-right:4px}'
               '.pr-rel{margin-top:40px;font-size:14px}'
               '</style>')
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


def build_pages():
    """rel_path -> html for every snapshot page."""
    bi = _load_build_index()
    paths = load_paths()
    dates = _doc_dates()
    pages = {}
    for lang in LANGS:
        idx = bi.build(lang)
        by_name = {d['name']: d for d in idx['docs']}
        for name, doc in by_name.items():
            rel = paths.get(name)
            if not rel:
                continue
            src = os.path.join(ROOT, 'docs', lang, rel)
            if not os.path.isfile(src):
                continue          # untranslated in this language — no snapshot
            raw = open(src, encoding='utf-8').read()
            has_en = os.path.isfile(os.path.join(ROOT, 'docs', 'en', rel))
            meta = {
                'title': first_h2(raw) or doc['title'],
                'summary': doc['summary'],
                'section': doc['section'],
                'related': doc.get('related', []),
            }
            out_rel = os.path.join(OUT_DIR, '' if lang == KO else lang, name, 'index.html')
            pages[out_rel] = page_html(name, lang, meta, rewrite_links(raw, lang),
                                       dates, paths, has_en)
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
        '<script>\n'
        '// /p/<name>/ (or /p/en/<name>/) -> the SPA route for that document;\n'
        '// anything else -> the wiki home.\n'
        'var m = location.pathname.match(/\\/p\\/(?:[a-z]{2}\\/)?([A-Za-z0-9._-]+)\\/?$/);\n'
        'location.replace(m ? "/#!" + m[1] : "/");\n'
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
