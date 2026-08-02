#!/usr/bin/env python3
"""Run EVERY python gate the CI validate-all job runs, in the same order.

Why this exists (2026-08-03). The CI job is eight separate steps; locally they
were being run piecemeal from memory, and twice a late edit slipped past the
one gate that wasn't re-run afterwards:
  - #375: a Work Log edit after `build_ai_export.py` had already been run —
    CI failed on feed/llms drift.
  - #381: `tools/concepts.*.json`·`og-card.html` edits after
    `check_plugin_sync.py` had already been run — CI failed on bundle drift.
The failure mode is not "didn't know the gate" but "gate ran before the last
edit". The fix is mechanical: one command that runs the whole battery LAST,
after every edit and regeneration, exactly as CI will.

Green here == green on the CI validate-all job (same scripts, same order,
same flags). The two browser jobs (diagram-bounds · i18n-render) are separate
CI jobs and need a headless Chromium — run them per their headers when you
touched diagrams or UI strings; this script reminds you when to.

Usage:  python3 tools/check_all.py [--base origin/master]
"""
import argparse
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (label, argv builder, needs_base) — mirrors .github/workflows/validate.yml
STEPS = [
    ('validate_all',          lambda b: ['tools/validate_all.py'],                 False),
    ('build_ai_export chk',   lambda b: ['tools/build_ai_export.py', '--check'],   False),
    ('build_prerender chk',   lambda b: ['tools/build_prerender.py', '--check'],   False),
    ('check_plugin_sync',     lambda b: ['tools/check_plugin_sync.py', '--base', b], True),
    ('check_worklog',         lambda b: ['tools/check_worklog.py', '--base', b],   True),
    ('check_cachebuster',     lambda b: ['tools/check_cachebuster.py', '--base', b], True),
    ('check_translation',     lambda b: ['tools/check_translation.py', '--base', b], True),
    # 비차단 리뷰 신호 (CI에서도 always exit 0) — 출력만 보인다.
    ('relations review',      lambda b: ['tools/check_relations_review.py', '--base', b], True),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', default='origin/master',
                    help='diff base for the PR gates (default: origin/master)')
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding='utf-8')
    failed = []
    for label, argv, _needs_base in STEPS:
        cmd = [sys.executable] + [os.path.join(REPO, a) if a.startswith('tools/') else a
                                  for a in argv(args.base)]
        print('\n== %s ==' % label, flush=True)
        rc = subprocess.call(cmd, cwd=REPO)
        if rc != 0 and label != 'relations review':
            failed.append(label)

    print('\n' + '=' * 56)
    if failed:
        print('FAIL: %d/%d 게이트 실패 — %s' % (len(failed), len(STEPS) - 1, ', '.join(failed)))
        print('→ 고친 뒤 다시 python3 tools/check_all.py — 마지막 편집 이후에 다시 도는 것이 핵심')
        return 1
    print('OK: CI validate-all의 파이썬 게이트 %d단계 전부 초록' % (len(STEPS) - 1))
    print('· 도식을 만졌다면:  node tools/check_diagram_bounds.mjs  (CI diagram-bounds 잡)')
    print('· UI 문구를 만졌다면: node tools/check_i18n_render.mjs   (CI i18n-render 잡)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
