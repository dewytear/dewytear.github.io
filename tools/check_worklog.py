#!/usr/bin/env python3
"""PR gate: substantive changes must ship with a new Work Log document.

CLAUDE.md 본문 추가 규칙 4: "하나의 작업(주제)을 master에 머지할 때"
Work Log 문서를 추가한다 — 기준은 변경의 크기가 아니라 주제의 머지다.
이 규칙이 프로즈로만 존재해 실제로 두 번 누락됐다(2026-07-09, PR #195의
아이콘 변경·PR #197의 강조 제거 — wl-20260709-loose-ends 참조). 이
스크립트는 그 규칙을 PR CI에서 기계적으로 강제한다.

판정:
  - PR diff에 work-log 문서가 하나라도 **추가(A) 또는 수정(M)** 됐으면 통과.
    로그는 PR 단위가 아니라 **주제 단위**다 — 새 주제면 새 로그를 추가하고,
    같은 주제의 후속(추가 수정·버그픽스)이면 그 주제의 **기존 로그를 갱신**하면
    된다. 변경마다 새 로그를 만들 필요가 없다(그러면 로그가 과분할된다).
  - 아니면, 변경 파일 전부가 기록·부산물 집합(work-log 문서 자체,
    data/doc-dates.json)이면 통과 — Backlog 갱신 같은 로깅 전용 PR은
    그 자체가 기록이다.
  - 그 외(본문·list·코드·스타일 등 실질 변경이 있는데 로그를 아예 안
    건드림) → ERROR, exit 1.

validate_all.py에 넣지 않은 이유: 다른 validate_*는 저장소의 현재
상태를 검사하지만 이 체크는 diff 기준점(base)이 필요하다. CI의
pull_request 이벤트에서만 base가 명확하므로 별도 스크립트로 분리하고
워크플로에서 PR일 때만 실행한다.

Usage:
  python tools/check_worklog.py --base origin/master [--head HEAD]
"""
import argparse
import os
import re
import subprocess
import sys

# 신규 추가되면 "로그가 있다"로 인정하는 경로 (dated log 문서)
NEW_WORKLOG_RE = re.compile(r'^docs/[^/]+/work-log/\d{4}/')

# work-log 문서(dated·guide·backlog). 추가(A)뿐 아니라 수정(M)도 "로그가 있다"로
# 인정한다 — 한 주제를 여러 PR에 걸쳐 진행할 때 매번 새 로그를 만들지 말고
# 그 주제의 기존 로그를 갱신하라는 규칙(CLAUDE.md 본문 추가 규칙 4)을 뒷받침한다.
WORKLOG_DOC_RE = re.compile(r'^docs/[^/]+/work-log/')

# 이 집합 안에서만 노는 변경은 로깅·부산물이라 새 로그를 요구하지 않는다
BOOKKEEPING_RE = re.compile(r'^(docs/[^/]+/work-log/|data/doc-dates\.json$)')


def changed_files(base, head):
    out = subprocess.run(
        ['git', 'diff', '--name-status', f'{base}...{head}'],
        capture_output=True, text=True, check=True,
    ).stdout
    files = []   # (status, path)
    for line in out.splitlines():
        parts = line.split('\t')
        if len(parts) >= 2:
            status, path = parts[0], parts[-1]   # 리네임은 새 경로 기준
            files.append((status, path))
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=os.environ.get('WORKLOG_BASE', 'origin/master'))
    parser.add_argument('--head', default='HEAD')
    args = parser.parse_args()

    try:
        files = changed_files(args.base, args.head)
    except subprocess.CalledProcessError as e:
        print(f'[ERROR] worklog-gate | - | git diff 실패 (base={args.base}): {e.stderr or e}')
        sys.exit(1)

    if not files:
        print('OK: 변경 없음')
        return

    # 새 주제 로그 추가(A) 또는 기존 주제 로그 갱신(M) 중 하나면 통과 —
    # 주제 단위 로그 원칙(한 주제=한 로그, 후속은 갱신)을 강제하되 허용한다.
    touched_logs = [p for s, p in files
                    if s[:1] in ('A', 'M') and WORKLOG_DOC_RE.match(p)]
    if touched_logs:
        added_new = [p for s, p in files
                     if s[:1] == 'A' and NEW_WORKLOG_RE.match(p)]
        kind = '신규' if added_new else '갱신'
        print(f'OK: Work Log {kind} 확인 — {", ".join(touched_logs[:5])}')
        return

    substantive = [p for _, p in files if not BOOKKEEPING_RE.match(p)]
    if not substantive:
        print('OK: 기록·부산물 변경만 있음 (work-log/doc-dates) — 새 로그 불요')
        return

    print('[ERROR] worklog-gate | - | 실질 변경이 있는데 Work Log를 추가도 갱신도 안 함 (CLAUDE.md 본문 추가 규칙 4)')
    for p in substantive[:20]:
        print(f'  - {p}')
    print('→ 새 주제면 docs/ko/work-log/YYYY/MM/DD/ 아래에 로그를 추가(+list 노드), '
          '같은 주제의 후속이면 그 주제의 기존 로그를 갱신하세요.')
    sys.exit(1)


if __name__ == '__main__':
    main()
