#!/usr/bin/env python3
"""PR gate: substantive changes must ship with a new Work Log document.

CLAUDE.md 본문 추가 규칙 4: "하나의 작업(주제)을 master에 머지할 때"
Work Log 문서를 추가한다 — 기준은 변경의 크기가 아니라 주제의 머지다.
이 규칙이 프로즈로만 존재해 실제로 두 번 누락됐다(2026-07-09, PR #195의
아이콘 변경·PR #197의 강조 제거 — wl-20260709-loose-ends 참조). 이
스크립트는 그 규칙을 PR CI에서 기계적으로 강제한다.

판정 ①  로그를 건드렸는가:
  - PR diff에 work-log 문서가 하나라도 **추가(A) 또는 수정(M)** 됐으면 통과.
    로그는 PR 단위가 아니라 **주제 단위**다 — 새 주제면 새 로그를 추가하고,
    같은 주제의 후속(추가 수정·버그픽스)이면 그 주제의 **기존 로그를 갱신**하면
    된다. 변경마다 새 로그를 만들 필요가 없다(그러면 로그가 과분할된다).
  - 아니면, 변경 파일 전부가 기록·부산물 집합(work-log 문서 자체,
    data/doc-dates.json)이면 통과 — Backlog 갱신 같은 로깅 전용 PR은
    그 자체가 기록이다.
  - 그 외(본문·list·코드·스타일 등 실질 변경이 있는데 로그를 아예 안
    건드림) → ERROR, exit 1.

판정 ②  그게 **오늘(KST)** 날짜 로그인가 (check_dates):
  - 날짜 폴더가 있는 로그를 건드렸다면 그중 하나는 HEAD 커밋의 KST 날짜와
    같아야 한다. 아니면 ERROR. 날짜 없는 로그(backlog·guide)만 건드린 PR은
    대상이 아니다.
  - 의도적으로 지난 날짜에 적는 경우(예: 넘어간 날 작업을 뒤늦게 분리)는
    커밋 메시지 **줄 맨 앞**에 `Worklog-Backdated: <사유>`를 남기면 통지로
    낮춘다. 본문에서 규약을 언급만 해도 열리면 안 되므로 줄 시작으로 못박는다.

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

# 날짜 폴더에서 그 로그가 말하는 날짜를 뽑는다: docs/<lang>/work-log/2026/07/27/…
DATED_LOG_RE = re.compile(r'^docs/[^/]+/work-log/(\d{4})/(\d{2})/(\d{2})/')

# 의도적으로 지난 날짜 로그에 적는 경우의 탈출구. 커밋 메시지에 이 트레일러를
# 남기면(예: 지난 날짜 작업을 뒤늦게 분리 기록) 날짜 검사를 통지로 낮춘다.
BACKDATE_TRAILER = 'Worklog-Backdated:'
# **줄 맨 앞**에서만 인정한다 — 본문에서 이 규약을 설명하기만 해도 게이트가
# 열리면 안 된다(이 게이트를 도입한 커밋 자신이 그 함정에 빠져 통과했다).
BACKDATE_RE = re.compile(r'^\s*' + re.escape(BACKDATE_TRAILER) + r'\s*\S', re.M)


def kst_date_of_head(head):
    """HEAD 커밋의 **작성 시각을 KST로** 본 날짜 (YYYY, MM, DD).

    '지금'이 아니라 커밋 작성 시각을 쓴다 — 어제 만든 PR을 오늘 CI가 돌려도
    판정이 흔들리지 않아야 하고, build_dates.py의 KST 정규화 규약과도 같다."""
    out = subprocess.run(
        ['git', 'log', '-1', '--date=iso-strict-local', '--format=%ad', head],
        capture_output=True, text=True, check=True,
        env={**os.environ, 'TZ': 'Asia/Seoul'},
    ).stdout.strip()
    return out[:4], out[5:7], out[8:10]


def head_messages(base, head):
    return subprocess.run(
        ['git', 'log', '--format=%B', f'{base}..{head}'],
        capture_output=True, text=True, check=True,
    ).stdout


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


def check_dates(touched_logs, base, head):
    """오늘(KST) 한 일이 오늘 날짜 로그에 적혔는가.

    CLAUDE.md: 날짜 폴더·파일명의 날짜는 **KST 기준**이다. 이 규칙이 프로즈로만
    있어 자정 전후 작업이 전날 로그로 들어가는 사고가 두 번 났다 —
    2026-07-14(UTC 세션 날짜를 그대로 씀), 2026-07-27(전날 저녁에 확인한 KST
    날짜를 아침까지 재사용). 그때마다 사람이 눈으로 잡았고 CI는 통과시켰다:
    check_worklog는 '로그를 건드렸는가'만 봤지 '어느 날짜 로그인가'는 안 봤다.

    판정은 HEAD 커밋의 KST 날짜와 대조한다. 날짜 없는 로그(wl-backlog·wl-guide)
    만 건드린 PR은 대상이 아니다 — 그건 상태판이지 그날의 기록이 아니다."""
    dated = {}
    for p in touched_logs:
        m = DATED_LOG_RE.match(p)
        if m:
            dated.setdefault('%s-%s-%s' % m.groups(), []).append(p)
    if not dated:
        return   # backlog·guide만 갱신 — 날짜 개념이 없다

    y, mo, d = kst_date_of_head(head)
    today = '%s-%s-%s' % (y, mo, d)
    if today in dated:
        return

    newest = max(dated)
    if BACKDATE_RE.search(head_messages(base, head)):
        print(f'NOTE: 지난 날짜 로그({newest})에 기록 — 커밋의 {BACKDATE_TRAILER} 사유로 허용')
        return

    print(f'[ERROR] worklog-date | - | 이 PR의 작업일은 {today}(KST)인데 '
          f'그 날짜 로그를 건드리지 않았습니다 (건드린 로그: {", ".join(sorted(dated))})')
    for day in sorted(dated):
        for p in dated[day]:
            print(f'  - {p}')
    print(f'→ 오늘 한 일은 docs/ko/work-log/{y}/{mo}/{d}/wl-{y}{mo}{d}-<frame>에 적고 '
          'list에 날짜 노드를 다세요. 하루를 넘긴 후속이면 같은 주제라도 '
          '그날 로그로 분리합니다(2026-07-20 선례).')
    print(f'→ 의도적으로 지난 날짜에 적는 것이라면 커밋 메시지에 '
          f'"{BACKDATE_TRAILER} <사유>"를 남기세요.')
    sys.exit(1)


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
        return check_dates(touched_logs, args.base, args.head)

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
