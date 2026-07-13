#!/usr/bin/env python3
"""Generate data/doc-dates.json — per-doc created/updated dates from git.

The wiki shows "생성일자:" under every doc title (and "수정일자:" on the
meta pages: knowledge maps, backlog, guide). Dates come from git history —
`--follow` tracks files across the 2026-07-06 domain-tree move, so created
dates survive physical relocation.

Run alongside build_index.py in any content PR — **새 문서를 커밋한 뒤** 실행한다
(커밋 전에는 git 이력이 없어 누락된다; 재생성 후 amend로 같은 커밋에 싣는 관례):
    python3 tools/build_dates.py

Output: {"docs": {name: {"c": "<ISO8601 KST>", "u": "<ISO8601 KST>"}}}
날짜는 **KST(Asia/Seoul)로 정규화** — `%ad --date=iso-strict-local` + `TZ=Asia/Seoul`.
커밋 tz가 UTC(+00:00)든 +09:00이든 한국시간 기준 같은 날짜로 집계된다(자정 전후
UTC/KST 혼재로 날짜가 하루 어긋나던 버그 방지). 화면 표시는 formatDocDate가 날짜부
(YYYY-MM-DD)만 쓰고, 시분초는 최근 문서·#!new "정렬"에서만 쓰여 같은 날 순서를 가른다.
No --check gate: squash-merge timestamps legitimately drift a few hours
from branch-time values, so freshness is a convention, not a hard gate.
(커버리지는 별개 — list 등재 문서의 엔트리 누락은 validate_routes의
missing-date **ERROR**가 막는다. 2026-07-13 dzp-value 생성일 미표시 재발 방지.)

가드 2종 (2026-07-13 — 원격 세션의 얕은 클론이 기존 생성일 100+건을 클론
시점으로 뭉갤 뻔한 실사고에서 도입):
  - **얕은 클론 가드**: shallow 저장소면 `git fetch --unshallow origin`을 자동
    시도하고, 여전히 shallow면 **파일을 쓰지 않고 exit 1** — 잘린 이력으로
    날짜를 계산해 덮어쓰는 일이 구조적으로 불가능하다.
  - **생성일 불변 가드**: 기존 doc-dates.json 대비 이미 있던 문서의 c(생성일)
    **날짜부(KST)**가 달라지면 목록을 출력하고 **exit 1**(미기록). 생성일은
    정의상 불변 — 달라졌다면 이력 결손 신호다. 스쿼시 머지로 인한 같은 날짜
    안의 시분초 표류는 정상이라 관용한다. 의도적 재산정은 --force로만.
"""
import argparse
import json
import os
import subprocess
import sys


def iter_doc_nodes(tree):
    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                yield from walk(n['children'])
            elif n.get('name') and not n.get('route'):
                yield n
    yield from walk(tree if isinstance(tree, list) else tree.get('children', tree))


def ensure_full_history(root):
    """얕은 클론 가드 — shallow면 unshallow 시도, 실패 시 False."""
    shallow = subprocess.run(
        ['git', 'rev-parse', '--is-shallow-repository'],
        cwd=root, capture_output=True, text=True,
    ).stdout.strip()
    if shallow != 'true':
        return True
    print('shallow 클론 감지 — git fetch --unshallow origin 시도…')
    subprocess.run(['git', 'fetch', '--unshallow', 'origin'],
                   cwd=root, capture_output=True, text=True)
    shallow = subprocess.run(
        ['git', 'rev-parse', '--is-shallow-repository'],
        cwd=root, capture_output=True, text=True,
    ).stdout.strip()
    return shallow != 'true'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true',
                        help='생성일 불변 가드를 무시하고 재산정 결과를 기록')
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, 'list'), encoding='utf-8') as f:
        tree = json.load(f)

    if not ensure_full_history(root):
        print('[ERROR] dates-shallow | - | 얕은 클론에서는 생성일이 뭉개지므로 '
              'doc-dates.json을 쓰지 않습니다 (git fetch --unshallow 실패)')
        return 1

    # 날짜는 KST(Asia/Seoul)로 정규화한다 — 커밋 tz가 UTC든 +09:00이든
    # 한국시간 기준 같은 날짜로 집계되도록(자정 전후 UTC/KST 혼재 버그 방지).
    # %aI는 커밋 원래 tz라 못 쓰고, %ad + --date=iso-strict-local + TZ로 강제.
    env = {**os.environ, 'TZ': 'Asia/Seoul'}
    docs = {}
    missing = []
    for n in iter_doc_nodes(tree):
        rel = os.path.join('docs', 'ko', n.get('path', n['name']))
        try:
            out = subprocess.run(
                ['git', 'log', '--follow', '--date=iso-strict-local', '--format=%ad', '--', rel],
                cwd=root, capture_output=True, text=True, check=True, env=env,
            ).stdout.split()
        except subprocess.CalledProcessError:
            out = []
        if not out:
            missing.append(n['name'])
            continue
        docs[n['name']] = {'c': out[-1], 'u': out[0]}

    out_path = os.path.join(root, 'data', 'doc-dates.json')

    # 생성일 불변 가드 — 기존 파일의 c와 날짜부(KST)가 달라지면 이력 결손 신호.
    # 스쿼시 머지의 같은 날짜 안 시분초 표류는 정상이라 날짜부만 비교한다.
    if not args.force and os.path.exists(out_path):
        try:
            with open(out_path, encoding='utf-8') as f:
                prev = json.load(f).get('docs', {})
        except (json.JSONDecodeError, OSError):
            prev = {}
        drifted = [(n, prev[n]['c'], docs[n]['c']) for n in prev
                   if n in docs and prev[n]['c'][:10] != docs[n]['c'][:10]]
        if drifted:
            print(f'[ERROR] dates-created-drift | - | 기존 문서 {len(drifted)}건의 '
                  '생성일(c) 날짜부가 달라졌습니다 — 이력 결손(얕은 클론 등) 신호. '
                  '기록하지 않습니다 (의도적 재산정은 --force):')
            for n, old_c, new_c in drifted[:10]:
                print(f'  - {n}: {old_c[:10]} → {new_c[:10]}')
            return 1

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'docs': docs}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'OK: doc-dates.json — {len(docs)} docs', end='')
    if missing:
        print(f' (git 이력 없음 {len(missing)}건: {", ".join(missing[:5])}…)' if len(missing) > 5
              else f' (git 이력 없음: {", ".join(missing)})')
        return 1
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
