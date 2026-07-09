#!/usr/bin/env python3
"""Generate data/doc-dates.json — per-doc created/updated dates from git.

The wiki shows "생성일자:" under every doc title (and "수정일자:" on the
meta pages: knowledge maps, backlog, guide). Dates come from git history —
`--follow` tracks files across the 2026-07-06 domain-tree move, so created
dates survive physical relocation.

Run alongside build_index.py in any content PR:
    python3 tools/build_dates.py

Output: {"docs": {name: {"c": "<ISO8601>", "u": "<ISO8601>"}}}
`%aI` = author date, strict ISO 8601 with the commit's local timezone
(e.g. "2026-07-09T10:23:45+09:00"). 화면 표시는 formatDocDate가 날짜부
(YYYY-MM-DD)만 쓰므로 기존과 동일; 시분초는 최근 문서·#!new 등 "정렬"에서만
쓰여 같은 날 문서의 순서를 시각으로 가른다. 날짜 접두어는 종전 %as와 동일.
No --check gate: squash-merge timestamps legitimately drift a few hours
from branch-time values, so freshness is a convention, not a hard gate.
"""
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


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, 'list'), encoding='utf-8') as f:
        tree = json.load(f)

    docs = {}
    missing = []
    for n in iter_doc_nodes(tree):
        rel = os.path.join('docs', 'ko', n.get('path', n['name']))
        try:
            out = subprocess.run(
                ['git', 'log', '--follow', '--format=%aI', '--', rel],
                cwd=root, capture_output=True, text=True, check=True,
            ).stdout.split()
        except subprocess.CalledProcessError:
            out = []
        if not out:
            missing.append(n['name'])
            continue
        docs[n['name']] = {'c': out[-1], 'u': out[0]}

    out_path = os.path.join(root, 'data', 'doc-dates.json')
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
