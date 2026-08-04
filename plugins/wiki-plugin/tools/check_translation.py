#!/usr/bin/env python3
"""PR gate: 번역 병행 (글로벌 도달 파이프라인).

2026-07-26 결정: 이 위키는 영어를 전면 병행한다(워크로그 제외). 규칙이
프로즈로만 있으면 반드시 새는 것을 worklog-gate에서 배웠으므로, 같은
뼈대(diff 기반 PR CI 게이트)로 기계 강제한다.
2026-07-28 확장: 일본어 전면 병행이 끝나(115편 전부) 영어와 같은 규약을
적용한다. 언어는 ENFORCED_LANGS 하나만 고치면 늘어난다 — 다음 언어는
소급 번역이 끝난 뒤 이 목록에 추가할 것(끝나기 전에 켜면 모든 PR이 막힌다).

판정 (ENFORCED_LANGS의 각 언어 L에 대해, 모두 만족해야 통과):
  1. [L 동반물] PR에서 docs/L/<p>가 추가·수정됐으면 —
     - `list`의 해당 노드에 label_L이 있어야 하고(내비가 그 언어로 뜨게),
     - 인덱스 문서(tools/doc-entries.ko.json에 엔트리 존재)라면
       tools/doc-entries.L.json에도 오버레이 엔트리(title·summary)가
       있어야 한다. 인덱스 재생성 신선도는 기존 build_index --check가 잡는다.
  2. [신규 ko는 L 동반] PR에서 docs/ko/<p>가 **추가(A)** 됐고 그 문서가
     인덱스 문서라면, 같은 PR에 docs/L/<p>도 존재해야 한다(뉴스 포함,
     work-log 제외).

work-log는 병행 대상이 아니므로 양방향 모두 제외한다.

Usage:
  python tools/check_translation.py --base origin/master [--head HEAD]
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 소급 번역이 끝나 "신규 문서 동반"을 기계 강제하는 언어들.
# en: 2026-07-26 완료 · ja: 2026-07-28 완료.
ENFORCED_LANGS = ('en', 'ja')

WORKLOG_RE = re.compile(r'^docs/[^/]+/work-log/')
KO_DOC_RE = re.compile(r'^docs/ko/(.+)$')

# list 밖의 라우트 프래그먼트 — about처럼 화면 라우트가 직접 불러오는 비인덱스
# 문서. 3언어 병행 수정은 사람이 지키되(같은 PR), label_<lang>·오버레이 같은
# 동반물이 애초에 존재하지 않으므로 이 게이트의 대상이 아니다. (2026-08-04
# about 정체성 반영 PR에서 게이트가 이 경로를 인덱스 문서로 오인해 막힌 사례)
ROUTE_FRAGMENTS = {'about'}


def changed_files(base, head):
    out = subprocess.run(
        ['git', 'diff', '--name-status', f'{base}...{head}'],
        capture_output=True, text=True, check=True,
    ).stdout
    files = []   # (status, path)
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) >= 2:
            files.append((parts[0], parts[-1]))   # 리네임은 새 경로 기준
    return files


def _load_json(rel):
    try:
        return json.load(open(os.path.join(ROOT, rel), encoding='utf-8'))
    except (OSError, ValueError):
        return None


def list_nodes_by_path():
    """path -> node (문서 리프만)."""
    tree = _load_json('list') or []
    out = {}

    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                walk(n['children'])
            elif n.get('name') and n.get('path'):
                out[n['path']] = n
    walk(tree if isinstance(tree, list) else tree.get('children', tree))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=os.environ.get('WORKLOG_BASE', 'origin/master'))
    parser.add_argument('--head', default='HEAD')
    args = parser.parse_args()

    try:
        files = changed_files(args.base, args.head)
    except subprocess.CalledProcessError as e:
        print(f'[ERROR] translation-gate | - | git diff 실패 (base={args.base}): {e.stderr or e}')
        sys.exit(1)

    by_path = list_nodes_by_path()
    ko_entries = {e.get('name') for e in (_load_json('tools/doc-entries.ko.json') or [])}
    entries = {lang: {e.get('name') for e in (_load_json(f'tools/doc-entries.{lang}.json') or [])}
               for lang in ENFORCED_LANGS}

    errors = []

    for lang in ENFORCED_LANGS:
        doc_re = re.compile(r'^docs/%s/(.+)$' % re.escape(lang))

        # 1. 번역 본문 추가·수정 → label_<lang> + (인덱스 문서면) 오버레이 동반
        for s, p in files:
            m = doc_re.match(p)
            if not m or s[:1] not in ('A', 'M') or WORKLOG_RE.match(p):
                continue
            rel = m.group(1)
            if rel in ROUTE_FRAGMENTS:
                continue
            node = by_path.get(rel)
            if node is None:
                errors.append(f'{p}: list에 이 path의 노드가 없음 (ko 문서·list 등록이 선행)')
                continue
            if not node.get(f'label_{lang}'):
                errors.append(
                    f"{p}: list 노드 '{node['name']}'에 label_{lang} 없음 — 본문 번역과 같은 "
                    f"PR에서 label_{lang}/tags_{lang}을 채울 것 (tools/i18n.md)")
            if node['name'] in ko_entries and node['name'] not in entries[lang]:
                errors.append(
                    f"{p}: tools/doc-entries.{lang}.json에 '{node['name']}' 오버레이(title·summary) "
                    f"없음 — 같은 PR에서 추가 후 build_index.py 재생성")

        # 2. 신규 ko 인덱스 문서 → 그 언어의 본문 동반 (work-log 제외)
        for s, p in files:
            m = KO_DOC_RE.match(p)
            if not m or s[:1] != 'A' or WORKLOG_RE.match(p):
                continue
            rel = m.group(1)
            node = by_path.get(rel)
            if node is None or node['name'] not in ko_entries:
                continue   # 인덱스 밖(미등록·메타)이면 이 게이트의 대상이 아님
            if not os.path.isfile(os.path.join(ROOT, 'docs', lang, rel)):
                errors.append(
                    f"{p}: 신규 인덱스 문서인데 docs/{lang}/{rel} 없음 — 신규 문서는 "
                    f"{'/'.join(ENFORCED_LANGS)} 본문 동반이 규칙")

    if errors:
        print('[ERROR] translation-gate | - | 번역 병행 동반물 누락:')
        for e in errors[:20]:
            print(f'  - {e}')
        sys.exit(1)
    print('OK: translation-gate — 번역 병행 동반물 이상 없음 (%s)' % ', '.join(ENFORCED_LANGS))


if __name__ == '__main__':
    main()
