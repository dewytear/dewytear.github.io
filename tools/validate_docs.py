#!/usr/bin/env python3
"""Validate the ko doc corpus for duplication, staleness, and metadata drift.

Cross-checks three sources of truth that must stay consistent by hand:
  - `list`                      nav tree (doc nodes carry tags/labels)
  - `docs/ko/<path>`            HTML-fragment doc bodies (117 files)
  - `tools/doc-entries.ko.json` AI-authored index entries (title/summary/concepts)

Usage:  python tools/validate_docs.py [--repo PATH] [--stale-days N]

Exposes run(root) -> list[dict] so validate_all.py can compose this with
other validators. Each finding is
  {"level": "ERROR"|"WARN"|"INFO", "check": "<kebab-id>", "name": "<doc name or '-'>",
   "message": "<one line>"}
"""
import argparse
import difflib
import html
import json
import os
import re
import subprocess
import sys

LEVEL_RANK = {'ERROR': 0, 'WARN': 1, 'INFO': 2}

# Doc names intentionally absent from doc-entries.ko.json: work-log entries
# (they document themselves) and the two knowledge-map pages (meta, not content).
UNINDEXED_PREFIXES = ('wl-',)
UNINDEXED_NAMES = {'ai-map', 'dz-map'}


def is_unindexed(name):
    return name in UNINDEXED_NAMES or any(name.startswith(p) for p in UNINDEXED_PREFIXES)


# ---------------------------------------------------------------------------
# Loading

def load_list_tree(root):
    with open(os.path.join(root, 'list'), encoding='utf-8') as f:
        return json.load(f)


def iter_doc_nodes(tree):
    """Yield every leaf doc node ({name, path, label, tags, ...}) in `list`."""
    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                yield from walk(n['children'])
            elif n.get('name') and not n.get('route'):
                yield n
    yield from walk(tree if isinstance(tree, list) else tree.get('children', tree))


def normalize_text(raw):
    """HTML fragment -> comparable plain text: strip tags, unescape entities,
    collapse whitespace, lowercase."""
    text = re.sub(r'<[^>]+>', ' ', raw)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text.lower()


def load_doc_bodies(root, doc_nodes):
    """name -> (raw_html, normalized_text). Missing files are skipped silently;
    that's a broken-link concern for a different check, not this one."""
    bodies = {}
    for n in doc_nodes:
        if not n.get('path'):
            continue   # validate_routes flags the missing field; don't crash here
        fpath = os.path.join(root, 'docs', 'ko', n['path'])
        if not os.path.isfile(fpath):
            continue
        with open(fpath, encoding='utf-8') as f:
            raw = f.read()
        bodies[n['name']] = (raw, normalize_text(raw))
    return bodies


def load_entries(root):
    path = os.path.join(root, 'tools', 'doc-entries.ko.json')
    if not os.path.isfile(path):
        return []
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Checks

def check_duplicate_doc(bodies):
    """Exact duplicates: identical normalized body text between two docs."""
    findings = []
    by_text = {}
    for name, (_, norm) in bodies.items():
        if not norm:
            continue
        by_text.setdefault(norm, []).append(name)
    for norm, names in by_text.items():
        if len(names) < 2:
            continue
        names_sorted = sorted(names)
        for i in range(len(names_sorted)):
            for j in range(i + 1, len(names_sorted)):
                a, b = names_sorted[i], names_sorted[j]
                findings.append({
                    'level': 'ERROR', 'check': 'duplicate-doc', 'name': a,
                    'message': '%s 와(과) 본문이 완전히 동일함' % b,
                })
    return findings


def check_similar_doc(bodies):
    """Near-duplicates via difflib ratio, quick_ratio() prefiltered.

    wl-* logs legitimately share boilerplate structure, so they're only
    compared against other wl-* logs, at a stricter 0.95/WARN threshold.
    Non-wl-* docs use 0.90 WARN / 0.75 INFO, prefiltered at quick_ratio()>0.75.
    """
    findings = []
    names = sorted(bodies.keys())
    wl_names = [n for n in names if n.startswith('wl-')]
    other_names = [n for n in names if not n.startswith('wl-')]

    def pairs(group):
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                yield group[i], group[j]

    for a, b in pairs(other_names):
        text_a, text_b = bodies[a][1], bodies[b][1]
        if not text_a or not text_b:
            continue
        sm = difflib.SequenceMatcher(None, text_a, text_b, autojunk=False)
        if sm.quick_ratio() <= 0.75:
            continue
        ratio = sm.ratio()
        if ratio >= 0.90:
            findings.append({'level': 'WARN', 'check': 'similar-doc', 'name': a,
                              'message': '%s 와(과) 거의 동일 (유사도 %.2f)' % (b, ratio)})
        elif ratio >= 0.75:
            findings.append({'level': 'INFO', 'check': 'similar-doc', 'name': a,
                              'message': '%s 와(과) 유사 (유사도 %.2f)' % (b, ratio)})

    for a, b in pairs(wl_names):
        text_a, text_b = bodies[a][1], bodies[b][1]
        if not text_a or not text_b:
            continue
        sm = difflib.SequenceMatcher(None, text_a, text_b, autojunk=False)
        if sm.quick_ratio() <= 0.75:
            continue
        ratio = sm.ratio()
        if ratio >= 0.95:
            findings.append({'level': 'WARN', 'check': 'similar-doc', 'name': a,
                              'message': '%s 와(과) 거의 동일 (Work Log, 유사도 %.2f)' % (b, ratio)})

    return findings


def git_last_commit_ts(root):
    """name(relative path under docs/ko) -> newest commit unix timestamp.

    A single `git log --name-only --format=%ct` over docs/ko, keeping the
    newest timestamp seen per file. Renames aren't followed (files were
    bulk-moved during the 2026-07-06 restructuring), so results reflect that
    restructuring date rather than true content history for moved files.
    """
    try:
        out = subprocess.run(
            ['git', 'log', '--name-only', '--format=%ct', '--', 'docs/ko'],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout
    except Exception:
        return None

    ts_by_path = {}
    current_ts = None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.isdigit():
            current_ts = int(line)
            continue
        if current_ts is not None and line.startswith('docs/ko/'):
            rel = line[len('docs/ko/'):]
            if rel not in ts_by_path or current_ts > ts_by_path[rel]:
                ts_by_path[rel] = current_ts
    return ts_by_path


def check_stale_doc(root, doc_nodes, stale_days):
    findings = []
    ts_by_path = git_last_commit_ts(root)
    if ts_by_path is None:
        return [{'level': 'INFO', 'check': 'stale-doc', 'name': '-',
                  'message': 'git unavailable'}]

    now = None
    try:
        now = int(subprocess.run(['git', 'log', '-1', '--format=%ct'], cwd=root,
                                  capture_output=True, text=True, check=True).stdout.strip())
    except Exception:
        import time
        now = int(time.time())

    stale_seconds = stale_days * 86400
    for n in doc_nodes:
        ts = ts_by_path.get(n['path'])
        if ts is None:
            continue
        age_days = (now - ts) / 86400
        if now - ts > stale_seconds:
            findings.append({
                'level': 'INFO', 'check': 'stale-doc', 'name': n['name'],
                'message': '마지막 커밋 %d일 전 (2026-07-06 구조 개편으로 이동된 문서는 실제 최신화일이 아닐 수 있음)' % age_days,
            })
    return findings


TAG_HYPHEN_RE = re.compile(r'[-\s]+')
# 띄어쓰기·하이픈 차이("지식지도" vs "지식 지도", "omc-doctor" vs "omcdoctor")로
# 인한 오탐을 없애기 위해, 공백·하이픈류를 전부 제거한 평탄 문자열끼리도 비교한다.
FLAT_RE = re.compile(r'[\s\-–—·]+')


def flatten(text):
    return FLAT_RE.sub('', text)


def tag_in_text(tag, text, flat):
    t = tag.lower()
    if t in text:
        return True
    return flatten(t) in flat


def check_tag_content_mismatch(doc_nodes, bodies):
    findings = []
    for n in doc_nodes:
        tags = n.get('tags') or []
        if not tags:
            continue
        body = bodies.get(n['name'])
        if body is None:
            continue
        text = body[1]
        flat = flatten(text)
        present = [t for t in tags if tag_in_text(t, text, flat)]
        missing = [t for t in tags if t not in present]
        if len(present) < len(tags) / 2:
            findings.append({
                'level': 'WARN', 'check': 'tag-content-mismatch', 'name': n['name'],
                'message': '태그 %d/%d개만 본문에서 발견, 누락: %s' % (
                    len(present), len(tags), ', '.join(missing)),
            })
    return findings


GLYPH_STRIP_RE = re.compile(r'^[\s❖✦§·\-–—•*#>:]+')


def extract_first_h2(raw_html):
    m = re.search(r'<h2[^>]*>(.*?)</h2>', raw_html, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    text = re.sub(r'<[^>]+>', ' ', m.group(1))
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    text = GLYPH_STRIP_RE.sub('', text).strip()
    return text


def tokenize(text):
    return set(re.findall(r'[\w가-힣]+', text.lower()))


def jaccard(a, b):
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def check_title_mismatch(entries, bodies):
    findings = []
    for e in entries:
        name = e['name']
        body = bodies.get(name)
        if body is None:
            continue
        h2 = extract_first_h2(body[0])
        if h2 is None:
            findings.append({'level': 'WARN', 'check': 'title-mismatch', 'name': name,
                              'message': '본문에서 <h2> 제목을 찾지 못함'})
            continue
        title_norm = e['title'].strip().lower()
        h2_norm = h2.lower()
        if title_norm in h2_norm or h2_norm in title_norm:
            continue
        overlap = jaccard(tokenize(e['title']), tokenize(h2))
        if overlap < 0.4:
            findings.append({
                'level': 'WARN', 'check': 'title-mismatch', 'name': name,
                'message': '엔트리 제목 "%s" 이(가) 본문 <h2> "%s" 와(과) 매칭되지 않음 (중복도 %.2f)' % (
                    e['title'], h2, overlap),
            })
    return findings


PUNCT_RE = re.compile(r'[^\w가-힣]+')


def summary_tokens(summary):
    raw_tokens = re.split(r'\s+', summary.strip())
    out = []
    for t in raw_tokens:
        t = PUNCT_RE.sub('', t)
        if len(t) >= 2:
            out.append(t)
    return out


def token_in_body(token, body_text, flat):
    t = token.lower()
    if t in body_text:
        return True
    ft = flatten(t)
    # 조사("에서"·"으로")나 어미("한다")가 붙은 토큰도 어근이 본문에 있으면 인정.
    for cut in (0, 1, 2):
        s = ft[:-cut] if cut else ft
        if len(s) >= 2 and s in flat:
            return True
    return False


def check_summary_content_mismatch(entries, bodies):
    findings = []
    for e in entries:
        name = e['name']
        body = bodies.get(name)
        if body is None:
            continue
        text = body[1]
        flat = flatten(text)
        tokens = summary_tokens(e['summary'])
        if not tokens:
            continue
        found = [t for t in tokens if token_in_body(t, text, flat)]
        ratio = len(found) / len(tokens)
        if ratio < 0.30:
            missing = [t for t in tokens if t not in found]
            findings.append({
                'level': 'WARN', 'check': 'summary-content-mismatch', 'name': name,
                'message': '요약 토큰 %d/%d개(%.0f%%)만 본문에서 발견, 누락 예: %s' % (
                    len(found), len(tokens), ratio * 100, ', '.join(missing[:6])),
            })
    return findings


def check_orphan_entries(doc_nodes, entries):
    """ERROR: a doc-entries.ko.json entry whose `name` matches no doc node.
    Such an entry is dead data — build_index walks `list`, so the entry never
    reaches the knowledge index, and if the name is a typo the doc it was
    written for silently loses its title/summary/concept links."""
    findings = []
    known = {n['name'] for n in doc_nodes}
    for e in entries:
        name = e.get('name', '')
        if name not in known:
            findings.append({
                'level': 'ERROR', 'check': 'orphan-entry', 'name': name or '-',
                'message': "doc-entries.ko.json 엔트리가 list의 어떤 doc 노드와도 매칭되지 않음 (오타 또는 삭제된 문서의 잔재)",
            })
    return findings


# CLAUDE.md 디자인 규칙: 지식 계층 표기는 World→Domain→System→Document,
# 천문 은유(우주·갤럭시·성단·은하) 표현 금지 — 2026-07-06 개편(300dc4f) 이전에
# 실제로 쓰이다 사후 금지된 이력이 있어, 재발을 기계적으로 잡는다.
BANNED_METAPHORS = ('우주', '갤럭시', '성단', '은하')


def check_banned_astronomy_metaphor(doc_nodes, entries, bodies):
    """ERROR: 천문 은유 단어가 살아있는 콘텐츠(label/tags/summary/concepts/본문)에
    등장. work-log/ 문서는 제외 — 개편 이전/개편 과정 자체를 서술한 불변 역사
    기록이라 CLAUDE.md의 "옛 로그는 소급 수정하지 않는다" 원칙이 적용된다."""
    findings = []

    def hits(text):
        return sorted({w for w in BANNED_METAPHORS if w in (text or '')})

    for n in doc_nodes:
        if (n.get('path') or '').startswith('work-log/'):
            continue
        fields = {
            'label': n.get('label', ''), 'label_en': n.get('label_en', ''),
            'tags': ' '.join(n.get('tags') or []), 'tags_en': ' '.join(n.get('tags_en') or []),
        }
        for field, text in fields.items():
            for w in hits(text):
                findings.append({
                    'level': 'ERROR', 'check': 'banned-astronomy-metaphor', 'name': n['name'],
                    'message': f'list의 {field}에 금지된 천문 은유 "{w}" 사용',
                })
        body = bodies.get(n['name'])
        if body:
            _, normalized = body
            for w in hits(normalized):
                findings.append({
                    'level': 'ERROR', 'check': 'banned-astronomy-metaphor', 'name': n['name'],
                    'message': f'본문에 금지된 천문 은유 "{w}" 사용',
                })

    worklog_names = {n['name'] for n in doc_nodes if (n.get('path') or '').startswith('work-log/')}
    for e in entries:
        if e.get('name') in worklog_names:
            continue
        fields = {'title': e.get('title', ''), 'summary': e.get('summary', ''),
                   'concepts': ' '.join(e.get('concepts') or [])}
        for field, text in fields.items():
            for w in hits(text):
                findings.append({
                    'level': 'ERROR', 'check': 'banned-astronomy-metaphor', 'name': e.get('name', '-'),
                    'message': f'doc-entries.ko.json의 {field}에 금지된 천문 은유 "{w}" 사용',
                })
    return findings


# Map pages carry a static fallback table (for no-JS / index-load-failure)
# that mirrors stats hydrateAiMap would render live. Fallback numbers rot
# silently when docs are added, so cross-check them against the index.
MAP_FALLBACKS = [
    # (doc path under docs/, index file under data/, stats galaxy key)
    ('ko/ai/map/ai-map', 'knowledge-index.ko.json', 'AI'),
    ('en/ai/map/ai-map', 'knowledge-index.en.json', 'AI'),
    ('ko/douzone/map/dz-map', 'knowledge-index.ko.json', 'Douzone'),
]


def check_map_fallback_drift(root):
    """WARN: static fallback numbers in the knowledge-map pages disagree with
    the generated index (cluster counts, hub doc, or the km-totals line)."""
    findings = []
    for rel, idx_file, galaxy in MAP_FALLBACKS:
        fpath = os.path.join(root, 'docs', rel)
        ipath = os.path.join(root, 'data', idx_file)
        if not (os.path.isfile(fpath) and os.path.isfile(ipath)):
            continue
        with open(fpath, encoding='utf-8') as f:
            doc = f.read()
        with open(ipath, encoding='utf-8') as f:
            stats = json.load(f).get('stats') or {}
        g = (stats.get('galaxies') or {}).get(galaxy, stats)
        want = {c['label']: c for c in g.get('clusters', [])}
        name = rel.split('/')[-1] + ' (' + rel.split('/')[0] + ')'

        # Fallback rows: <tr><td><strong>LABEL</strong></td><td>N</td>...#!hub
        rows = re.findall(
            r'<tr><td><strong>(.*?)</strong></td><td>(\d+)</td>.*?#!([\w-]+)', doc)
        seen = set()
        for raw_label, count, hub in rows:
            label = html.unescape(raw_label)
            seen.add(label)
            c = want.get(label)
            if c is None:
                findings.append({'level': 'WARN', 'check': 'map-fallback-drift', 'name': name,
                    'message': f"fallback 행 '{label}'이 인덱스 클러스터에 없음"})
            else:
                if int(count) != c['count']:
                    findings.append({'level': 'WARN', 'check': 'map-fallback-drift', 'name': name,
                        'message': f"'{label}' fallback 편수 {count} ≠ 인덱스 {c['count']}"})
                if hub != c['hub']['name']:
                    findings.append({'level': 'WARN', 'check': 'map-fallback-drift', 'name': name,
                        'message': f"'{label}' fallback 허브 {hub} ≠ 인덱스 {c['hub']['name']}"})
        for label in want:
            if label not in seen:
                findings.append({'level': 'WARN', 'check': 'map-fallback-drift', 'name': name,
                    'message': f"인덱스 클러스터 '{label}'의 fallback 행이 없음"})

        # Totals line: the two numbers in #km-totals (docs, then concepts).
        m = re.search(r'id="km-totals"[^>]*>([^<]*)<', doc)
        if m:
            nums = [int(x) for x in re.findall(r'\d+', m.group(1))]
            expect = [g.get('docCount'), g.get('conceptCount')]
            if len(nums) >= 2 and nums[:2] != expect:
                findings.append({'level': 'WARN', 'check': 'map-fallback-drift', 'name': name,
                    'message': f"km-totals fallback {nums[:2]} ≠ 인덱스 {expect}"})
    return findings


def check_unindexed_sanity(doc_nodes, entries):
    """INFO-level sanity note: doc nodes that are neither indexed nor in the
    known-unindexed allowlist. Cheap cross-check that doesn't fit the other
    checks but is useful signal without inventing a new required check id."""
    findings = []
    indexed = {e['name'] for e in entries}
    for n in doc_nodes:
        name = n['name']
        if name in indexed or is_unindexed(name):
            continue
        findings.append({
            'level': 'INFO', 'check': 'unindexed-doc', 'name': name,
            'message': 'doc-entries.ko.json에 없고 허용 목록(wl-*, ai-map, dz-map)에도 없음',
        })
    return findings


# ---------------------------------------------------------------------------

def run(root):
    tree = load_list_tree(root)
    doc_nodes = list(iter_doc_nodes(tree))
    bodies = load_doc_bodies(root, doc_nodes)
    entries = load_entries(root)

    findings = []
    findings += check_duplicate_doc(bodies)
    findings += check_similar_doc(bodies)
    findings += check_stale_doc(root, doc_nodes, run.stale_days if hasattr(run, 'stale_days') else 90)
    findings += check_tag_content_mismatch(doc_nodes, bodies)
    findings += check_title_mismatch(entries, bodies)
    findings += check_summary_content_mismatch(entries, bodies)
    findings += check_unindexed_sanity(doc_nodes, entries)
    findings += check_orphan_entries(doc_nodes, entries)
    findings += check_banned_astronomy_metaphor(doc_nodes, entries, bodies)
    findings += check_map_fallback_drift(root)
    return findings


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    default_repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default=default_repo)
    parser.add_argument('--stale-days', type=int, default=90)
    args = parser.parse_args()

    run.stale_days = args.stale_days
    findings = run(args.repo)

    findings.sort(key=lambda f: (LEVEL_RANK.get(f['level'], 9), f['check'], f['name']))
    counts = {'ERROR': 0, 'WARN': 0, 'INFO': 0}
    for f in findings:
        counts[f['level']] = counts.get(f['level'], 0) + 1
        print('[%s] %s | %s | %s' % (f['level'], f['check'], f['name'], f['message']))

    print('validate_docs: %d errors, %d warnings, %d infos' % (
        counts['ERROR'], counts['WARN'], counts['INFO']))
    sys.exit(1 if counts['ERROR'] else 0)


if __name__ == '__main__':
    main()
