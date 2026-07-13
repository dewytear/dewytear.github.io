#!/usr/bin/env python3
"""PR 리뷰 신호(비차단): 새로 등재된 문서의 지식 관계를 다각도로 검토했는가.

CLAUDE.md 본문 추가 규칙 — 문서를 등재할 때 관계(relations)를 선행지식
(prerequisite)으로 기본값 처리하지 말고 5타입(선행지식·구현·사례·근거·대체)을
본문과 다각도로 대조하라는 규칙을 뒷받침한다. 실제로 관계 보편 적용(#262·AI 2040)
때 대부분 prerequisite로만 채워져 다각도 검토가 빠진 사례가 있었다(2026-07-13
사용자 지적).

**이 체크는 차단 게이트가 아니다(항상 exit 0).** 관계는 본문에 실재할 때만
정직하게 다는 것이라(CLAUDE.md 정직성 규칙 — 억지 링크 금지) 기계가 "관계를
넣어라"고 강제할 수 없다. 대신 새 문서와 그 관계 타입 분포를 PR/로컬에 드러내어
"5타입을 다각도로 검토했는지" 사람/AI가 한 번 보게 하는 **리뷰 신호**다 —
validate_graph의 isolated-doc WARN과 같은 "사람이 한번 볼 목록" 철학.

판정(출력만, 종료코드 0):
  - base와의 diff에서 doc-entries.ko.json에 **새로 추가된 문서 name**을 찾는다.
  - 각 새 문서의 현재 관계 타입 분포를 출력한다.
  - 비-prerequisite 관계가 하나도 없는 새 문서는 5타입 체크리스트로 다각도
    검토를 권한다(본문 실재 시에만 추가, 정말 선행지식만/없어도 무방).

validate_all.py에 넣지 않은 이유: diff 기준점(base)이 필요해 check_worklog와
같은 계열의 PR/로컬 전용 스크립트다.

Usage:
  python tools/check_relations_review.py --base origin/master [--head HEAD]
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = 'tools/doc-entries.ko.json'
TYPES = ['prerequisite', 'implements', 'example-of', 'evidence-for', 'supersedes']
TYPE_KO = {
    'prerequisite': '선행지식', 'implements': '구현', 'example-of': '사례',
    'evidence-for': '근거', 'supersedes': '대체',
}
PROMPTS = [
    '구현(implements) — 이 문서가 다른 문서가 정의한 개념·스펙·아키텍처를 실제로 구현하나?',
    '사례(example-of) — 이 문서가 어떤 일반 개념·범주의 구체 사례인가?',
    '근거(evidence-for) — (기사·분석이면) 어떤 지식 문서의 주장을 뒷받침하는 외부 근거인가?',
    '대체(supersedes) — 남겨 둔 구버전 문서를 이 문서가 대체하나?',
]


def load_entries(rev):
    """rev의 doc-entries.ko.json -> {name: entry}. rev=None이면 작업트리."""
    try:
        if rev is None:
            text = open(os.path.join(ROOT, ENTRIES), encoding='utf-8').read()
        else:
            text = subprocess.run(
                ['git', 'show', f'{rev}:{ENTRIES}'],
                capture_output=True, text=True, check=True, cwd=ROOT,
            ).stdout
    except subprocess.CalledProcessError:
        return None
    return {e['name']: e for e in json.loads(text)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=os.environ.get('RELREVIEW_BASE', 'origin/master'))
    parser.add_argument('--head', default=None, help='기본: 작업트리')
    args = parser.parse_args()

    head = load_entries(args.head)
    if head is None:
        print(f'[INFO] relations-review | - | doc-entries를 읽지 못함 (head={args.head}) — 건너뜀')
        return  # 비차단
    base = load_entries(args.base)
    if base is None:
        print(f'[INFO] relations-review | - | base({args.base})에 doc-entries 없음 — 새 문서 판정 생략')
        return

    new_names = [n for n in head if n not in base]
    if not new_names:
        print('OK: 새로 등재된 문서 없음 — 관계 다각도 검토 대상 없음')
        return

    need_review = []
    print(f'[리뷰 신호] 새 문서 {len(new_names)}편의 지식 관계 타입 분포 (비차단):')
    for n in sorted(new_names):
        rels = head[n].get('relations', [])
        counts = {}
        for r in rels:
            counts[r.get('type')] = counts.get(r.get('type'), 0) + 1
        if not rels:
            desc = '관계 없음'
        else:
            desc = ', '.join(f'{TYPE_KO.get(t, t)}×{c}' for t, c in counts.items())
        nonprereq = any(t != 'prerequisite' for t in counts)
        flag = '' if nonprereq else '  ← 선행지식만/없음'
        print(f'  - {n}: {desc}{flag}')
        if not nonprereq:
            need_review.append(n)

    if need_review:
        print('\n다각도 검토 권함 — 아래 문서는 비-prerequisite 관계가 없습니다.')
        print('본문과 대조해 다음을 확인하세요(본문 실재 시에만 추가 — 정직성, 없어도 무방):')
        for p in PROMPTS:
            print(f'    · {p}')
        print(f'  대상: {", ".join(need_review)}')
    print('\n(이 체크는 비차단 리뷰 신호입니다 — 관계는 강제하지 않습니다.)')


if __name__ == '__main__':
    main()
