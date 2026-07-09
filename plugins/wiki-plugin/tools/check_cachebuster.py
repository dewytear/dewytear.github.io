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

Usage:
  python tools/check_cachebuster.py --base origin/master [--head HEAD]
"""
import argparse
import os
import re
import subprocess
import sys

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=os.environ.get('WORKLOG_BASE', 'origin/master'))
    parser.add_argument('--head', default='HEAD')
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

    if stale:
        print('[ERROR] cachebuster | - | 캐시 자산이 변경됐는데 index.html의 ?v가 안 올랐음')
        for path, v in stale:
            print(f'  - {path} (?v={v} 그대로)')
        print('→ index.html에서 해당 자산의 ?v를 올리세요 (재방문 브라우저 캐시 무효화).')
        sys.exit(1)

    touched = [p for s, p in files if s.startswith('M') and p in base_v]
    if touched:
        print(f'OK: 캐시 자산 {len(touched)}건 모두 ?v 상향 동반 — {", ".join(touched)}')
    else:
        print('OK: 캐시 자산 변경 없음')


if __name__ == '__main__':
    main()
