#!/usr/bin/env python3
"""PR gate: cache-busted assets must bump their ?v in index.html.

index.html이 `?v=`로 로드하는 자산(app.js·style.css 등)은 브라우저(특히
iOS Safari)가 max-age를 넘겨 캐시하므로, 내용을 바꾸면 같은 PR에서 해당
`?v`를 올려야 재방문자에게 반영된다. 이 규칙이 프로즈로만 있어 실제로
사고가 났다(2026-07-09, "반영 안 됨" — wl-20260709-newdoc-markers 참조).
check_worklog와 같은 diff 기반 PR 게이트로 기계화한다.

판정:
  - base의 index.html에서 `?v=` 자산 목록·버전을 파싱(하드코딩 없음 —
    자산이 추가/제거되면 자동 추종).
  - PR diff에서 그 자산이 수정(M)됐는데 head index.html의 해당 `?v`가
    base와 같으면 ERROR (파일별 보고).
  - 자산 신규 추가(A)·index.html만 변경·?v 상향 동반은 통과.

`--fix`를 주면 판정에서 그치지 않고 작업트리 index.html의 해당 `?v`를
직접 +1로 올려 기록한다(로컬 전용 — 숫자 증가는 판단이 필요 없는 기계
작업). 고친 뒤 같은 커밋에 포함하면 게이트를 통과한다. 해시 매니페스트나
빌드 스크립트는 도입하지 않는다 — 노빌드 정적 사이트 구조를 유지한다.

Usage:
  python tools/check_cachebuster.py --base origin/master [--head HEAD]
  python tools/check_cachebuster.py --base origin/master --fix   # ?v 자동 상향 (로컬)
"""
import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSET_RE = re.compile(r'(?:href|src)="([^"?]+)\?v=(\d+)"')


def git(args, **kw):
    return subprocess.run(['git'] + args, capture_output=True, text=True, check=True, **kw).stdout


def versions_at(rev):
    """index.html at `rev` -> {asset path: version int}. Missing file -> {}."""
    try:
        html = git(['show', f'{rev}:index.html'])
    except subprocess.CalledProcessError:
        return {}
    return {m.group(1): int(m.group(2)) for m in ASSET_RE.finditer(html)}


def changed_files(base, head):
    out = git(['diff', '--name-status', f'{base}...{head}'])
    files = []
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) >= 2:
            files.append((parts[0], parts[-1]))   # 리네임은 새 경로 기준
    return files


def apply_fix(stale):
    """작업트리 index.html에서 stale 자산의 ?v를 +1로 기록."""
    path = os.path.join(ROOT, 'index.html')
    with open(path, encoding='utf-8') as f:
        html = f.read()
    for asset, v in stale:
        old, new = f'{asset}?v={v}"', f'{asset}?v={v + 1}"'
        if html.count(old) != 1:
            print(f'[ERROR] cachebuster-fix | {asset} — index.html에서 `{old}` 유일 매치 실패')
            sys.exit(1)
        html = html.replace(old, new)
        print(f'  fixed: {asset} ?v={v} → {v + 1}')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=os.environ.get('WORKLOG_BASE', 'origin/master'))
    parser.add_argument('--head', default='HEAD')
    parser.add_argument('--fix', action='store_true',
                        help='stale 자산의 ?v를 작업트리 index.html에 자동 +1 기록 (로컬 전용)')
    args = parser.parse_args()

    try:
        base_v = versions_at(args.base)
        head_v = versions_at(args.head)
        files = changed_files(args.base, args.head)
    except subprocess.CalledProcessError as e:
        print(f'[ERROR] cachebuster | - | git 조회 실패 (base={args.base}): {e.stderr or e}')
        sys.exit(1)

    if not base_v:
        print('OK: base index.html에 ?v 자산 없음')
        return

    stale = []
    for status, path in files:
        if not status.startswith('M'):   # 신규(A)는 base 캐시가 없어 무관
            continue
        if path in base_v and head_v.get(path, -1) == base_v[path]:
            stale.append((path, base_v[path]))

    if stale and args.fix:
        print(f'FIX: stale 자산 {len(stale)}건 ?v 상향 (index.html 작업트리)')
        apply_fix(stale)
        print('→ 수정된 index.html을 같은 커밋에 포함하세요.')
        return
    if stale:
        print('[ERROR] cachebuster | - | 캐시 자산이 변경됐는데 index.html의 ?v가 안 올랐음')
        for path, v in stale:
            print(f'  - {path} (?v={v} 그대로)')
        print('→ `python tools/check_cachebuster.py --fix`로 ?v를 올리세요 (재방문 브라우저 캐시 무효화).')
        sys.exit(1)

    touched = [p for s, p in files if s.startswith('M') and p in base_v]
    if touched:
        print(f'OK: 캐시 자산 {len(touched)}건 모두 ?v 상향 동반 — {", ".join(touched)}')
    else:
        print('OK: 캐시 자산 변경 없음')


if __name__ == '__main__':
    main()
