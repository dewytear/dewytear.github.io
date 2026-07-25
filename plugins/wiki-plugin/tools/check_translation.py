#!/usr/bin/env python3
"""PR gate: English parity for documents (글로벌 도달 파이프라인).

2026-07-26 결정: 이 위키는 영어를 전면 병행한다(워크로그 제외). 규칙이
프로즈로만 있으면 반드시 새는 것을 worklog-gate에서 배웠으므로, 같은
뼈대(diff 기반 PR CI 게이트)로 기계 강제한다.

판정 (모두 만족해야 통과):
  1. [en 동반물] PR에서 docs/en/<p>가 추가·수정됐으면 —
     - `list`의 해당 노드에 label_en이 있어야 하고(내비가 영어로 뜨게),
     - 인덱스 문서(tools/doc-entries.ko.json에 엔트리 존재)라면
       tools/doc-entries.en.json에도 오버레이 엔트리(title·summary)가
       있어야 한다. 인덱스 재생성 신선도는 기존 build_index --check가 잡는다.
  2. [신규 ko는 en 동반] PR에서 docs/ko/<p>가 **추가(A)** 됐고 그 문서가
     인덱스 문서라면, 같은 PR에 docs/en/<p>도 존재해야 한다(뉴스 포함,
     work-log 제외). 소급 번역이 끝나기 전에도 "새 문서부터는 반드시
     영어 동반"을 지키기 위한 파이프라인 게이트.

work-log는 영어 병행 대상이 아니므로 양방향 모두 제외한다.

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

WORKLOG_RE = re.compile(r'^docs/[^/]+/work-log/')
KO_DOC_RE = re.compile(r'^docs/ko/(.+)$')
EN_DOC_RE = re.compile(r'^docs/en/(.+)$')


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
    en_entries = {e.get('name') for e in (_load_json('tools/doc-entries.en.json') or [])}

    errors = []

    # 1. en 본문 추가·수정 → label_en + (인덱스 문서면) en 오버레이 동반
    for s, p in files:
        m = EN_DOC_RE.match(p)
        if not m or s[:1] not in ('A', 'M') or WORKLOG_RE.match(p):
            continue
        rel = m.group(1)
        node = by_path.get(rel)
        if node is None:
            errors.append(f'{p}: list에 이 path의 노드가 없음 (ko 문서·list 등록이 선행)')
            continue
        if not node.get('label_en'):
            errors.append(f"{p}: list 노드 '{node['name']}'에 label_en 없음 — 본문 번역과 같은 PR에서 label_en/tags_en을 채울 것 (tools/i18n.md)")
        if node['name'] in ko_entries and node['name'] not in en_entries:
            errors.append(f"{p}: tools/doc-entries.en.json에 '{node['name']}' 오버레이(title·summary) 없음 — 같은 PR에서 추가 후 build_index.py 재생성")

    # 2. 신규 ko 인덱스 문서 → en 본문 동반 (work-log 제외)
    for s, p in files:
        m = KO_DOC_RE.match(p)
        if not m or s[:1] != 'A' or WORKLOG_RE.match(p):
            continue
        rel = m.group(1)
        node = by_path.get(rel)
        if node is None or node['name'] not in ko_entries:
            continue   # 인덱스 밖(미등록·메타)이면 이 게이트의 대상이 아님
        if not os.path.isfile(os.path.join(ROOT, 'docs', 'en', rel)):
            errors.append(f"{p}: 신규 인덱스 문서인데 docs/en/{rel} 없음 — 신규 문서는 영어 본문 동반이 규칙 (2026-07-26 파이프라인)")

    if errors:
        print('[ERROR] translation-gate | - | 영어 병행 동반물 누락:')
        for e in errors[:20]:
            print(f'  - {e}')
        sys.exit(1)
    print('OK: translation-gate — 영어 병행 동반물 이상 없음')


if __name__ == '__main__':
    main()
