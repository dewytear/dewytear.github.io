#!/usr/bin/env python3
"""GoatCounter의 문서별 조회수를 D1 시작값(counters.base)으로 옮기는 SQL을 만든다.

**왜 필요한가** — 조회수를 GoatCounter에서 Worker로 갈아타는 순간, 이관하지
않으면 모든 문서가 0으로 리셋된 것처럼 보인다. 2026년 7월부터 쌓인 수치를
`base` 열에 심어 두고 그 위로 Worker가 증가분을 더하면 숫자가 이어진다.

**왜 tools/가 아니라 worker/에 있나** — `tools/`의 파일은 전부 위키 플러그인
번들로 복사된다(`check_plugin_sync`). 이 스크립트는 이 사이트의 GoatCounter
계정에 묶인 일회성 이관 도구라 플러그인에 들어갈 물건이 아니다.

사용 (샌드박스에서는 goatcounter.com에 못 닿으니 **로컬에서** 실행):

    python3 worker/seed_views.py > seed.sql
    wrangler d1 execute dewytear-wiki --remote --file=./seed.sql

`/counter/<path>.json`은 토큰이 필요 없는 공개 엔드포인트다 — 인증 없이 읽힌다.
다만 그 응답도 **서버에서 최대 4시간 캐시**되므로, 여기서 얻는 값은 이관 시점
기준으로 최대 4시간 이전 수치다. 한 번 심고 마는 시작값이라 그 정도 오차는
문제가 되지 않는다.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

GC_HOST = 'https://dewytear.goatcounter.com'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, 'data', 'knowledge-index.ko.json')


def doc_names():
    with open(INDEX, encoding='utf-8') as f:
        return [d['name'] for d in json.load(f)['docs']]


def fetch_count(name):
    """그 문서의 누적 조회수. 집계가 없으면 404지만 본문은 정상 JSON이다."""
    url = '%s/counter/%s.json' % (GC_HOST, urllib.parse.quote(name, safe=''))
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print('  ! %s → HTTP %d' % (name, e.code), file=sys.stderr)
            return None
        body = e.read()
    except Exception as e:                                  # noqa: BLE001
        print('  ! %s → %s' % (name, e), file=sys.stderr)
        return None
    try:
        raw = json.loads(body).get('count', '')
    except ValueError:
        print('  ! %s → JSON 아님(집계 설정이 꺼져 있을 수 있음)' % name, file=sys.stderr)
        return None
    digits = ''.join(c for c in str(raw) if c.isdigit())
    return int(digits) if digits else 0


def main():
    names = doc_names()
    print('-- GoatCounter → D1 조회수 이관 (문서 %d편)' % len(names))
    print('-- 생성: worker/seed_views.py')
    ok = 0
    for i, name in enumerate(names, 1):
        n = fetch_count(name)
        if n is None:
            continue
        ok += 1
        # base만 덮어쓴다 — 그 사이 Worker가 센 views는 건드리지 않는다.
        print("INSERT INTO counters (doc, base) VALUES ('%s', %d)"
              "  ON CONFLICT(doc) DO UPDATE SET base = %d;" % (name, n, n))
        if i % 10 == 0:
            print('  %d/%d …' % (i, len(names)), file=sys.stderr)
        time.sleep(0.15)     # 남의 서버다 — 천천히
    print('-- 읽어 온 문서: %d / %d' % (ok, len(names)), file=sys.stderr)
    if ok < len(names):
        print('-- 일부 문서를 못 읽었습니다. 위 stderr를 확인하세요.', file=sys.stderr)


if __name__ == '__main__':
    main()
