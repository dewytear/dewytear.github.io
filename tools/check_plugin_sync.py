#!/usr/bin/env python3
"""PR/push gate: the bundled plugin tools snapshot must match source of truth.

`plugins/wiki-plugin/tools/`는 위키 운영 도구(`tools/`)의 **순수 바이트 스냅샷**
이다(README 동기화 정책: 원본은 루트 `tools/`, 번들은 그 시점 사본). 원본을
고치고 사본 복사를 잊으면 플러그인이 낡은 코드를 배포한다 — 실제로 났다
(2026-07-10 도그푸딩: validate_design.py 190줄 드리프트 + 파일 2개 누락).
프로즈 규칙("동기화하세요")은 잊히므로 diff 게이트로 기계화한다.

순수 복사본이라 판정은 오탐 0:
  - drift            — 루트와 번들의 동명 파일 내용이 다름
  - missing-in-bundle — 번들 대상인데 번들에 없음(복사 누락)
  - orphan-in-bundle  — 번들에만 있고 루트에 원본 없음
하나라도 있으면 exit 1.

번들 대상이 아닌 것(EXCLUDE): 위키별 콘텐츠·부산물·이 게이트 자신.

`--base <rev>`를 주면 릴리스 규율도 검사한다(PR 전용): base와의 diff에
`plugins/wiki-plugin/**` 변경이 있으면 `plugin.json`의 `version`이 base와
달라야 통과 — 설치 사용자가 "번들이 갱신됐다"를 버전으로 알 수 있게 강제한다
(check_cachebuster의 "자산 변경 = ?v 상향"과 동일 사상).

Usage:
  python tools/check_plugin_sync.py                          # 정합 검사만 (push·로컬)
  python tools/check_plugin_sync.py --base origin/master     # + 버전 상향 검사 (PR)
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools')
BUNDLE = os.path.join(ROOT, 'plugins', 'wiki-plugin', 'tools')
PLUGIN_DIR = 'plugins/wiki-plugin/'
PLUGIN_JSON = 'plugins/wiki-plugin/.claude-plugin/plugin.json'

# 번들 대상에서 제외 — 위키별 콘텐츠(doc-entries), 부산물(__pycache__),
# 그리고 이 게이트 자신(다운스트림 위키 운영 도구가 아니라 이 저장소의
# 플러그인 정합 검사일 뿐이라 번들하지 않는다).
EXCLUDE_EXACT = {'__pycache__', 'check_plugin_sync.py'}


def is_excluded(name):
    if name in EXCLUDE_EXACT:
        return True
    # doc-entries.<lang>.json 은 위키 콘텐츠 — 번들 대상 아님
    if name.startswith('doc-entries.') and name.endswith('.json'):
        return True
    return False


def read_bytes(path):
    with open(path, 'rb') as f:
        return f.read()


def check_snapshot():
    """바이트 정합 검사 findings — 비면 in sync."""
    src_files = {n for n in os.listdir(SRC)
                 if os.path.isfile(os.path.join(SRC, n)) and not is_excluded(n)}
    bundle_files = {n for n in os.listdir(BUNDLE)
                    if os.path.isfile(os.path.join(BUNDLE, n)) and not is_excluded(n)}

    findings = []
    for name in sorted(src_files):
        bpath = os.path.join(BUNDLE, name)
        if not os.path.exists(bpath):
            findings.append(('missing-in-bundle', name,
                             '루트 tools/에 있으나 번들에 없음 — 복사 누락'))
        elif read_bytes(os.path.join(SRC, name)) != read_bytes(bpath):
            findings.append(('drift', name,
                             '루트 tools/와 번들 내용이 다름 — 재동기화 필요'))
    for name in sorted(bundle_files - src_files):
        findings.append(('orphan-in-bundle', name,
                         '번들에만 있고 루트 tools/에 원본 없음'))
    return findings, len(src_files)


def git(args):
    return subprocess.run(['git'] + args, cwd=ROOT, capture_output=True,
                          text=True, check=True).stdout


def version_at(rev):
    """plugin.json의 version — rev가 None이면 작업트리, 파일 없으면 None."""
    try:
        if rev is None:
            with open(os.path.join(ROOT, PLUGIN_JSON), encoding='utf-8') as f:
                return json.load(f).get('version')
        return json.loads(git(['show', f'{rev}:{PLUGIN_JSON}'])).get('version')
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None


def check_version_bump(base):
    """base 대비 plugins/wiki-plugin/** 변경 시 version 상향 요구 — 실패면 메시지."""
    try:
        changed = git(['diff', '--name-only', f'{base}...HEAD']).splitlines()
    except subprocess.CalledProcessError as e:
        return f'git diff 실패 (base={base}): {e.stderr or e}'
    touched = [p for p in changed if p.startswith(PLUGIN_DIR)]
    if not touched:
        return None   # 번들 무변경 — 버전 요구 없음
    base_v, head_v = version_at(base), version_at(None)
    if base_v is None:
        return None   # base에 플러그인 없음(최초 도입) — 요구 없음
    if head_v == base_v:
        return (f'plugins/wiki-plugin/** {len(touched)}파일이 변경됐는데 '
                f'plugin.json version이 {base_v} 그대로 — 번들 갱신 = 버전 상향')
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=None,
                        help='PR base rev — 주면 번들 변경 시 version 상향도 검사')
    args = parser.parse_args()

    if not os.path.isdir(BUNDLE):
        print('OK: 번들(plugins/wiki-plugin/tools/) 없음 — 검사 생략')
        return

    findings, n_src = check_snapshot()
    if findings:
        print('[ERROR] plugin-sync | 동봉 스냅샷이 source of truth(tools/)와 어긋남')
        for check, name, why in findings:
            print(f'  - {check} | {name} — {why}')
        print('→ `cp tools/<파일> plugins/wiki-plugin/tools/`로 재동기화하세요.')
        sys.exit(1)

    if args.base:
        problem = check_version_bump(args.base)
        if problem:
            print(f'[ERROR] plugin-version | {problem}')
            print(f'→ {PLUGIN_JSON}의 version을 올리세요 (semver: 내용 갱신=minor, 버그픽스=patch).')
            sys.exit(1)

    suffix = ' + version 상향 확인' if args.base else ''
    print(f'OK: 플러그인 스냅샷 {n_src}파일 모두 tools/와 in sync{suffix}')


if __name__ == '__main__':
    main()
