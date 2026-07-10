---
name: add-doc
description: LLM 위키에 문서를 추가하는 전체 워크플로 — 파일 생성, list 노드 등록, doc-entries 큐레이션, 인덱스·일자 재생성, Work Log, 검증까지 한 번에. 문서/글/기사를 위키에 추가·등록할 때 사용.
---

# 위키 문서 추가 워크플로

위키에 문서 하나를 추가하면 **지식 체계 반영이 항상 동반**된다. 아래 순서를 빠짐없이 수행한다.
프로젝트 루트에 `tools/build_index.py`가 있으면 **프로젝트의 tools/**를 쓰고, 없으면
`${CLAUDE_PLUGIN_ROOT}/tools/`의 동봉 사본을 쓴다.

## 순서

1. **문서 파일 생성** — `docs/ko/<도메인 트리 경로>/<name>` (확장자 없음, HTML 프래그먼트).
   - `name`은 불변 논리 ID(해시 라우트). 물리 경로는 도메인 트리(예: `ai/claude/code/tutorial/`).
   - 표는 반드시 `<div class="tbl-wrap">`로 감싼다(모바일 가로 스크롤).
   - 도식은 인라인 `<svg>`를 `<div class="diagram">`에 넣고 `.d-box`/`.d-label` 등 시맨틱 클래스만 사용.
2. **`list`에 노드 추가** — `name`·`path`(docs/<lang>/ 아래 상대 경로)·`label`(+`label_en`)·`tags`. 새 문서·대폭 재작성이면 `model`도 기록. **name과 path는 항상 쌍으로.**
3. **`tools/doc-entries.ko.json`에 엔트리 추가** — `{name, title, summary, concepts}`.
   - `concepts`는 **본문에 실재하는 개념만**(정직성). 기존 개념 어휘를 재사용해야 연관 링크가 생긴다.
   - 연관 규칙: 공유 개념 2개↑ 또는 단일 공유 개념 df≤3 (스키마 계약: `tools/schema.md`).
4. **인덱스 재생성** — `python3 tools/build_index.py` 후 `--check`로 0 확인. `python3 tools/build_dates.py`도 실행(문서 커밋 후 재실행해야 새 문서 날짜가 잡힘 — git 이력 기반).
5. **Work Log** — 하루 안에서 **빅 프레임 4종**(콘텐츠/기능/디자인·UI/운영·도구)으로 묶는다. 같은 날 같은 프레임 로그가 있으면 **그 로그에 `<h3>` 섹션 추가**, 없으면 `wl-YYYYMMDD-<frame>` 새 파일 + `list` 날짜 트리 노드(`"tags": []`). 날짜는 **KST** 기준.
6. **검증** — `python3 tools/validate_all.py` 실행, **ERROR 0가 머지 조건**. WARN은 검토 후 보정하거나 사유를 Work Log에 남긴다.

## 주의
- 새 대분류(섹션)를 만들면 `tools/clusters.json`에 **모든 언어** 라벨([섹션 경로, 표시명]) 추가 + 지식지도 문서의 fallback 갱신이 필요하다. clusters.json은 위키별 설정이라 플러그인에 동봉되지 않는다 — 없으면 이름 붙은 클러스터 없이 동작.
- 번역·언어 작업은 `tools/i18n.md` 체크리스트를 따른다(오버레이는 본문 번역과 같은 PR에서만).
- 프로젝트에 CLAUDE.md가 있으면 그 규칙이 우선한다 — 이 스킬은 그 규칙의 실행 절차다.
