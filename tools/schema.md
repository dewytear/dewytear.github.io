# 데이터 스키마 계약 (schemaVersion 2)

이 문서는 위키가 생성·소비하는 데이터 파일의 **동결된 계약**이다. wiki-plugin,
미래 백엔드, 외부 소비자는 이 문서를 기준으로 통합한다. 실물과 이 문서가
어긋나면 그것이 버그다.

## 호환 규칙 (동결의 핵심)

- **필드 추가 = 하위호환.** 소비자는 모르는 필드를 무시해야 한다(strict 파싱 금지).
- **필드의 의미 변경·제거·타입 변경 = 파괴적.** 반드시 `schemaVersion`을 올리고,
  소비자(아래 목록)를 같은 PR에서 이행한다.
- **데이터 키는 리네임하지 않는다** — `stats.galaxies` 등 천문 은유 키 포함
  (표기는 World → Domain → System → Document로 바뀌었지만 키는 불변, CLAUDE.md 디자인 규칙).
- 소비자 목록(2026-07 기준): `app.js`(지식지도 hydrate·연관 블록), `cosmos.js`(3D),
  `graphviews.js`(2D 뷰), `search.js`(개념 검색), (예정) wiki-plugin.

---

## 1. `data/knowledge-index.<lang>.json`

생성: `python3 tools/build_index.py` (입력: `tools/doc-entries.<lang>.json` + `list`).
같은 입력이면 항상 같은 출력(결정적 빌드, `--check`로 검증).

```jsonc
{
  "schemaVersion": 2,
  "note": "…",                  // 인덱스 성격 설명(사람용, 언어별)
  "docCount": 94,               // docs 배열 길이
  "stats": { … },               // ↓ §1.2
  "docs": [ { … } ]             // ↓ §1.1
}
```

### 1.1 `docs[]` — 문서 하나

```jsonc
{
  "name": "welcome",            // 불변 논리 ID = 해시 라우트(#!welcome) = 인덱스 키.
                                //   물리 위치는 list 노드의 path가 정한다(항상 쌍으로 기록).
  "title": "Welcome",           // 표시 제목
  "summary": "…",               // 1문장 요약 (LLM 큐레이션, doc-entries 원본)
  "concepts": ["Claude Code", "터미널", …],   // 본문에 실재하는 핵심 개념만(정직성 규칙)
  "section": "AI · Claude · Code · Introduction",  // list 트리 경로(' · ' 구분, 한국어 원본 타이틀)
  "related": [                  // 연관 문서 2~4개 (계산 필드 — 직접 쓰지 말 것)
    {
      "name": "ccb-what",
      "title": "Claude Code란 무엇인가",
      "shared": ["Claude Code", …],   // 공유 개념(무거운 것부터, 최대 3) — via:folder면 []
      "via": "concept"          // "concept" | "folder"
    }
  ]
}
```

**related 생성 규칙** (build_index.py — 재현 가능):
- 개념 중복을 **희소성 가중(idf)** 으로 점수화: `weight(c) = ln((N+1)/df(c))`.
- 채택 조건: 공유 개념 **2개 이상**, 또는 **1개뿐이면 그 개념의 df ≤ 3**(흔한 개념
  1개 공유는 연관으로 안 침). 최대 4개.
- 2개 미만이면 **같은 폴더 이웃**으로 보충(`via: "folder"`, `shared: []`) — 최대 3개까지.
- 경계값 주의: df 3→4로 넘어가는 개념 추가는 옆 문서의 단일-공유 엣지를 끊을 수 있다
  (CLAUDE.md 지식 그래프 WARN 해석 규칙 참조).

### 1.2 `stats` — 집계

```jsonc
{
  "docCount": 94,
  "conceptCount": 306,          // 고유 개념 수
  "clusters": [                 // tools/clusters.json(언어별) 순서의 클러스터 요약
    {
      "label": "Introduction",  // 표시 라벨(언어별)
      "section": "AI · Claude · Code · Introduction",
      "count": 6,               // 소속 문서 수
      "hub": { "name": "welcome", "title": "Welcome", "refs": 5 }  // 연관 최다 문서
    }
  ],
  "hubs": [                     // 전역 허브 문서(연관 참조 많은 순)
    { "name": "hns-anatomy", "title": "하네스의 구성과 효과", "refs": 11 }
  ],
  "topConcepts": [              // 최다 사용 개념
    { "c": "스킬", "n": 20 }    // c=개념, n=사용 문서 수
  ],
  "bridges": [                  // 여러 클러스터에 걸치는 다리 개념
    { "c": "스킬", "n": 20, "clusters": ["Harness 엔지니어링", "Skill", …] }
  ],
  "galaxies": {                 // World(최상위 대분류)별로 같은 집계를 스코프
    "AI": { "docCount": …, "conceptCount": …, "clusters": […], "hubs": […], "topConcepts": […], "bridges": […] },
    "Douzone": { … }
  }
}
```

`stats.galaxies`의 각 값은 최상위 `stats`에서 **galaxies만 뺀 같은 모양**(재귀 없음).
지식지도 페이지가 `data-section-prefix`로 자기 World 블록을 hydrate.

---

## 2. `data/doc-dates.json`

생성: `python3 tools/build_dates.py` (git 이력, `--follow`로 이동 추적).

```jsonc
{
  "docs": {
    "<name>": {
      "c": "2026-07-07T11:35:16+09:00",   // 생성(최초 커밋) — strict ISO 8601, KST(+09:00) 정규화
      "u": "2026-07-09T22:23:07+09:00"    // 수정(최근 커밋)
    }
  }
}
```

- **타임존은 항상 KST(Asia/Seoul)로 정규화** — 커밋 tz가 무엇이든 한국시간 기준
  같은 날짜로 집계된다(자정 전후 UTC/KST 혼재 버그 방지).
- 용도 계약: **표시는 날짜부(YYYY-MM-DD)만**(`formatDocDate`), **정렬은 전체 문자열**
  (ISO 사전순 = 시간순), **새 글 판정은 `c`의 날짜부**(KST 오늘 기준 경과일).
- 커밋되지 않은 파일은 이력이 없어 빠진다 — 커밋 후 재생성하면 포함.

---

## 3. `list` — 내비게이션 트리 (참고 계약)

인덱스의 상류 입력. 문서 노드의 핵심 쌍:

- `name` — **불변 논리 ID**(해시 라우트·인덱스 키·doc-dates 키). 바꾸지 않는다.
- `path` — `docs/<lang>/` 아래 **물리 경로**(도메인 트리). 이동 시 path만 갱신.
- `label`(+`label_<lang>`), `tags`(+`tags_<lang>`), 선택: `model`, `nonum`(메타 페이지),
  `mark`(번호 대신 기호), 브랜치 노드는 `title`(+`title_<lang>`)·`children`.

검증: `python3 tools/validate_all.py` — name/path 계약·고아·깨진 링크를 ERROR로 강제.
