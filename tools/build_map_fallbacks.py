#!/usr/bin/env python3
"""build_map_fallbacks.py — 지식 지도의 정적 폴백 블록을 인덱스에서 생성한다.

지식 지도(ai-map·dz-map)는 km-clusters·km-hubs·km-bridges·km-top·km-totals
다섯 블록을 **정적 HTML로도** 들고 있다. 화면에서는 app.js의 hydrateAiMap()이
knowledge-index로 이 블록들을 덮어쓰므로 방문자는 항상 최신값을 보지만, 정적
쪽이 그대로 나가는 자리가 둘 있다 — /p/ 프리렌더 스냅샷(크롤러·SNS 미리보기·
JS 비활성)과 하이드레이션 직전의 첫 페인트.

그래서 이 폴백은 손으로 맞춰 왔고, 예상대로 낡았다(2026-08-11 감사):
  - 브리지 '스킬'이 8개·22편에 멈춰 있었다(실제 9개·23편), CLAUDE.md는 6/6
    (실제 7/7), 상위 8의 구성 자체가 바뀌어 검증·RAG가 빠져 있었다.
  - 허브 목록에서 gdb-graphrag가 6회 무리에 남아 있었다(실제 7회).
  - **영문 지도의 브리지 개념명 7개가 한국어 그대로**였다(스킬·서브에이전트…).
기존 게이트(validate_docs의 map-fallback-drift)는 clusters·km-top·km-totals만
보고 있어 이 셋을 놓쳤다.

해법은 폴백을 사람이 쓰지 않는 것이다. 이 스크립트가 hydrateAiMap과 같은 소스
(knowledge-index.<lang>.json)·같은 표시명(tools/concepts.<lang>.json)·같은 문구
(i18n.js STRINGS)로 다섯 블록을 만들어 문서에 적는다. --check는 CI·check_all에서
드리프트를 잡는다.

  python3 tools/build_map_fallbacks.py            # 문서에 기록
  python3 tools/build_map_fallbacks.py --check    # 어긋나면 exit 1

문서에서 사람이 쓰는 부분은 그대로 둔다 — 클러스터 표의 '중심 주제' 열은
여전히 문서의 data-topics 속성에서 읽어 쓴다(설명문은 손으로 쓰는 글이다).
"""
import argparse
import html
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'tools'))

# 대상 목록은 validate_docs가 이미 들고 있다 — 언어를 늘릴 때 두 곳을 고치는
# 사고를 막으려고 그쪽을 정본으로 가져다 쓴다.
from validate_docs import MAP_FALLBACKS  # noqa: E402


def esc(s):
    """app.js의 escapeHtml과 같은 규칙(& < > ")."""
    return (str(s).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def load_strings(repo):
    """i18n.js의 STRINGS에서 지도 문구 템플릿만 언어별로 읽는다.

    JS를 파싱하지 않고 키 리터럴만 정규식으로 집는다 — 이 다섯 키는 한 줄에
    모여 있고(i18n.js), 형태가 바뀌면 여기서 KeyError로 바로 드러난다.
    """
    src = open(os.path.join(repo, 'i18n.js'), encoding='utf-8').read()
    keys = ('kmEach', 'kmRefs', 'kmBridgeN', 'kmDocsN', 'kmTotals')
    out = {}
    # 언어 블록은 STRINGS = { ko: {...}, en: {...}, ja: {...} } 순서로 나온다.
    for lang in ('ko', 'en', 'ja'):
        m = re.search(r'\b%s\s*:\s*\{' % lang, src)
        if not m:
            continue
        start = m.end() - 1
        depth, end = 0, len(src)
        for i in range(start, len(src)):
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
                if depth == 0:
                    end = i
                    break
        body = src[start:end]
        vals = {}
        for k in keys:
            km = re.search(r"\b%s\s*:\s*'((?:[^'\\]|\\.)*)'" % k, body)
            if km:
                vals[k] = km.group(1).replace("\\'", "'")
        if len(vals) == len(keys):
            out[lang] = vals
    return out


def strf(tpl, **kw):
    for k, v in kw.items():
        tpl = tpl.replace('{%s}' % k, str(v))
    return tpl


def concept_labels(repo, lang):
    if lang == 'ko':
        return {}
    path = os.path.join(repo, 'tools', 'concepts.%s.json' % lang)
    try:
        with open(path, encoding='utf-8') as f:
            return (json.load(f) or {}).get('labels') or {}
    except (OSError, ValueError):
        return {}


def doc_link(name, title):
    return '<a href="#!%s">%s</a>' % (name, esc(title))


# ---- 블록 생성 (hydrateAiMap과 1:1) ----

def render_clusters(g, topics, indent):
    rows = []
    for c in g.get('clusters', []):
        rows.append(
            '%s<tr><td><strong>%s</strong></td><td>%d</td><td>%s</td><td>%s</td></tr>'
            % (indent, esc(c['label']), c['count'],
               esc(topics.get(c['label'], '')), doc_link(c['hub']['name'], c['hub']['title'])))
    return rows


def render_hubs(g, S, indent):
    by_refs = {}
    for h in g.get('hubs', []):
        by_refs.setdefault(h['refs'], []).append(h)
    rows = []
    for n in sorted(by_refs, key=lambda x: -int(x)):
        group = by_refs[n]
        links = ' · '.join(doc_link(h['name'], h['title']) for h in group)
        label = strf(S['kmEach'] if len(group) > 1 else S['kmRefs'], n=n)
        rows.append('%s<li>%s <span class="scn-sub">· %s</span></li>'
                    % (indent, links, esc(label)))
    return rows


def render_bridges(g, S, labels, indent):
    rows = []
    for b in g.get('bridges', []):
        name = labels.get(b['c'], b['c'])
        rows.append(
            '%s<tr><td><strong>%s</strong></td><td>%s%s</td><td>%s</td></tr>'
            % (indent, esc(name),
               esc(strf(S['kmBridgeN'], n=len(b['clusters']))),
               ' · '.join(esc(c) for c in b['clusters']),
               esc(strf(S['kmDocsN'], n=b['n']))))
    return rows


def render_top(g, labels):
    top = [t for t in (g.get('topConcepts') or []) if t.get('n', 0) >= 5]
    return ' · '.join('%s %d' % (esc(labels.get(t['c'], t['c'])), t['n']) for t in top)


def render_totals(g, S):
    return esc(strf(S['kmTotals'], d=g.get('docCount', 0), c=g.get('conceptCount', 0)))


# ---- 문서에 써넣기 ----

BLOCK_RE = {
    'km-clusters': re.compile(r'(?P<open><tbody id="km-clusters".*?>)(?P<body>.*?)(?P<close></tbody>)', re.S),
    'km-hubs':     re.compile(r'(?P<open><ul id="km-hubs">)(?P<body>.*?)(?P<close></ul>)', re.S),
    'km-bridges':  re.compile(r'(?P<open><tbody id="km-bridges">)(?P<body>.*?)(?P<close></tbody>)', re.S),
    'km-top':      re.compile(r'(?P<open><p class="scn-sub" id="km-top">)(?P<body>.*?)(?P<close></p>)', re.S),
    'km-totals':   re.compile(r'(?P<open><p class="scn-sub" id="km-totals">)(?P<body>.*?)(?P<close></p>)', re.S),
}


def indent_of(doc, pos):
    """블록 여는 태그가 놓인 줄의 들여쓰기 + 4칸(자식 줄용)."""
    line_start = doc.rfind('\n', 0, pos) + 1
    base = doc[line_start:pos]
    base = base[:len(base) - len(base.lstrip())]
    return base + '    '


def rebuild(doc, g, S, labels):
    """문서의 다섯 블록을 다시 만든다(없는 블록은 건너뛴다)."""
    # 클러스터 표의 '중심 주제'는 문서가 들고 있는 data-topics에서 읽는다.
    topics = {}
    tm = re.search(r"<tbody id=\"km-clusters\"[^>]*data-topics='(.*?)'", doc, re.S)
    if tm:
        try:
            topics = json.loads(html.unescape(tm.group(1)))
        except ValueError:
            topics = {}

    for key, rx in BLOCK_RE.items():
        m = rx.search(doc)
        if not m:
            continue
        ind = indent_of(doc, m.start('open'))
        if key == 'km-clusters':
            rows = render_clusters(g, topics, ind)
        elif key == 'km-hubs':
            rows = render_hubs(g, S, ind)
        elif key == 'km-bridges':
            rows = render_bridges(g, S, labels, ind)
        elif key == 'km-top':
            rows = None
            body = render_top(g, labels)
        else:
            rows = None
            body = render_totals(g, S)
        if rows is not None:
            body = '\n' + '\n'.join(rows) + '\n' + ind[:-4]
        doc = doc[:m.start('body')] + body + doc[m.end('body'):]
    return doc


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true',
                    help='기록하지 않고 어긋난 문서만 보고(어긋나면 exit 1)')
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')

    strings = load_strings(REPO)
    if len(strings) < 3:
        print('ERROR: i18n.js에서 지도 문구 템플릿을 읽지 못했습니다 — '
              'kmEach·kmRefs·kmBridgeN·kmDocsN·kmTotals 형태 확인')
        return 1

    stale, written = [], 0
    for rel, idx_file, galaxy in MAP_FALLBACKS:
        fpath = os.path.join(REPO, 'docs', rel)
        ipath = os.path.join(REPO, 'data', idx_file)
        if not (os.path.isfile(fpath) and os.path.isfile(ipath)):
            continue
        lang = rel.split('/')[0]
        with open(fpath, encoding='utf-8') as f:
            doc = f.read()
        with open(ipath, encoding='utf-8') as f:
            stats = json.load(f).get('stats') or {}
        g = (stats.get('galaxies') or {}).get(galaxy, stats)
        out = rebuild(doc, g, strings[lang], concept_labels(REPO, lang))
        if out == doc:
            continue
        if args.check:
            stale.append(rel)
        else:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(out)
            written += 1
            print('  updated: %s' % rel)

    if args.check:
        if stale:
            print('ERROR: 지도 폴백이 인덱스와 어긋납니다 (%d문서)' % len(stale))
            for r in stale:
                print('  - %s' % r)
            print('→ python3 tools/build_map_fallbacks.py 로 재생성하세요.')
            return 1
        print('OK: 지식 지도 폴백 %d문서 모두 인덱스와 일치' % len(MAP_FALLBACKS))
        return 0
    print('OK: 지식 지도 폴백 재생성 — %d문서 갱신' % written)
    return 0


if __name__ == '__main__':
    sys.exit(main())
