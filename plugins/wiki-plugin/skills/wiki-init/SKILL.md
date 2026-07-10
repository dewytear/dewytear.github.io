---
name: wiki-init
description: 새 LLM 위키(세컨드 브레인) 프로젝트 부트스트랩 — 폴더 구조, list 내비 트리, 지식 인덱스 파이프라인, Work Log 체계, 검증 게이트를 갖춘 정적 위키를 초기화할 때 사용.
---

# 새 위키 부트스트랩

이 스킬은 dewytear.github.io(레퍼런스 위키)의 구조를 새 프로젝트에 세운다.
도구는 `${CLAUDE_PLUGIN_ROOT}/tools/`의 동봉 사본을 프로젝트 `tools/`로 복사해 시작한다.

## 1. 뼈대

```
<project>/
├── index.html            # SPA 셸 (해시 라우팅, ?v= 캐시버스터로 자산 로드)
├── list                  # 내비 트리(JSON): 브랜치 {title, children} / 문서 {name, path, label, tags}
├── docs/ko/…             # 본문(HTML 프래그먼트, 확장자 없음) — 도메인 트리로 배치
│   └── work-log/YYYY/MM/DD/   # 작업 일지(빅 프레임 4종: 콘텐츠/기능/디자인·UI/운영·도구)
├── data/                 # 생성물: knowledge-index.<lang>.json, doc-dates.json
└── tools/                # build_index.py, build_dates.py, validate_*.py, check_*.py, schema.md, i18n.md, curator.md
```

> **뷰어(프런트엔드)는 이 플러그인에 동봉되지 않는다.** 이 스킬이 세우는 것은
> 데이터 파이프라인(문서·list·인덱스·검증)까지다. 브라우저로 볼 SPA 셸
> (`index.html`·`app.js`·`style.css`·`i18n.js` 등)은 레퍼런스 위키
> https://github.com/dewytear/dewytear.github.io 에서 복사해 커스터마이즈하거나,
> 데이터 전용(다른 뷰어/파이프라인의 입력)으로 운영한다. 뷰어 템플릿 동봉은
> 로드맵(레퍼런스 위키 Backlog) 참조.

## 2. 초기화 순서

1. `mkdir -p docs/ko data tools` 후 `${CLAUDE_PLUGIN_ROOT}/tools/`의 파일을 프로젝트 `tools/`로 복사.
2. 최소 `list` 작성 — 대분류(World) 1개 + 첫 문서 노드. **name(불변 ID)과 path(물리 경로)를 항상 쌍으로.**
3. `tools/doc-entries.ko.json`을 `{"docs": []}` 대신 문서 엔트리 배열 형식으로 시작(README·schema.md 참조).
   - **`tools/doc-entries.en.json`도 함께 만든다** — 영어를 아직 안 쓰면 빈 배열 `[]`로. (없으면 `validate_i18n`이 `en-entry-orphan` **ERROR**를 낸다.)
4. **`i18n.js`(또는 `index.html`)에 `var STRINGS = { ko: {…}, en: {…} }` 블록을 만든다** — ko/en 키 집합이 같아야 한다. (없으면 `validate_i18n`이 `strings-parity` **ERROR**를 낸다. 새 UI 문구는 하드코딩 대신 이 STRINGS 키로 넣는다.)
5. `python3 tools/build_index.py && python3 tools/build_dates.py`로 data/ 생성 확인.
6. `python3 tools/validate_all.py` — ERROR 0 확인.
7. CI: `.github/workflows/validate.yml`에 validate_all(push·PR) + check_worklog·check_cachebuster(PR) 스텝을 건다(레퍼런스 위키의 워크플로 참조). **checkout은 `fetch-depth: 0` 필수** — `check_worklog`(base와의 diff)·`build_dates.py`(git 이력의 최초 커밋 = 생성일)가 shallow clone에서는 오동작한다.
8. 프로젝트 CLAUDE.md에 운영 규칙을 적는다 — 본문 추가 규칙(문서→list→doc-entries→인덱스→Work Log→검증), 빅 프레임 로그 규칙, 캐시버스터 규칙. 레퍼런스: https://github.com/dewytear/dewytear.github.io 의 CLAUDE.md.

## 3. 핵심 원칙 (레퍼런스 위키에서 검증된 것)

- **문서 = 데이터**: 본문은 HTML 프래그먼트, 내비·인덱스·날짜는 전부 생성물. 손으로 인덱스를 고치지 않는다.
- **정직한 개념**: concepts는 본문에 실재하는 것만 — 연관은 계산으로 생긴다.
- **기록은 주제 단위**: 변경마다 로그를 쪼개지 말고 하루 안에서 빅 프레임으로 묶는다. 열린 일은 Backlog 단일 문서에서만.
- **규칙은 게이트로**: 프로즈 규칙은 잊힌다 — validate_*·check_*가 CI에서 기계적으로 강제한다.
