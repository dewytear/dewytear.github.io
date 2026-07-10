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
  - orphan-in-bundle  — 번들에만 있고 루트에 원본이 없음
하나라도 있으면 exit 1.

번들 대상이 아닌 것(EXCLUDE): 위키별 콘텐츠·부산물·이 게이트 자신.

Usage:
  python tools/check_plugin_sync.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools')
BUNDLE = os.path.join(ROOT, 'plugins', 'wiki-plugin', 'tools')

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


def main():
    if not os.path.isdir(BUNDLE):
        print('OK: 번들(plugins/wiki-plugin/tools/) 없음 — 검사 생략')
        return

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

    if findings:
        print('[ERROR] plugin-sync | 동봉 스냅샷이 source of truth(tools/)와 어긋남')
        for check, name, why in findings:
            print(f'  - {check} | {name} — {why}')
        print('→ `cp tools/<파일> plugins/wiki-plugin/tools/`로 재동기화하세요.')
        sys.exit(1)

    print(f'OK: 플러그인 스냅샷 {len(src_files)}파일 모두 tools/와 in sync')


if __name__ == '__main__':
    main()
