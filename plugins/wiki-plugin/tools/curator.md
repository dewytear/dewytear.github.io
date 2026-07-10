# AI 지식 큐레이터 — 절차서

이 문서는 **예약 AI 큐레이터**가 따르는 절차입니다. 매일 1회 새 세션에서 자동 실행되어, 위키 문서의 변경을 감지해 `data/knowledge-index.ko.json`을 갱신하고, **변경이 있으면 그날 Work Log에도 기록**한 뒤 **변경이 있을 때만** 검토용 PR을 올립니다. **자동 머지는 하지 않습니다** (사람이 검토 후 머지).

## 구성 요소

| 파일 | 역할 |
|---|---|
| `tools/doc-entries.ko.json` | **원료** — 문서별 `{name, title, summary, concepts}` (AI가 문서를 읽고 작성). |
| `tools/build_index.py` | **결정적 빌드** — `doc-entries.ko.json` + `list`로부터 `section`·`related`를 계산해 `data/knowledge-index.ko.json`을 생성. 같은 입력이면 항상 같은 출력. |
| `data/knowledge-index.ko.json` | 사이트가 읽는 최종 산출물(요약·개념·연관문서). **직접 편집 금지** — 항상 스크립트로 생성. |
| `ai-map` | 사람이 보는 "🧭 AI 지식 지도" 문서(클러스터 표·집계). 숫자는 수동 갱신. |
| `wl-<YYYYMMDD>` · `list` | 변경이 있는 날, 그날 Work Log에 큐레이터 활동을 한 줄 기록(필요 시 새 wl 문서 생성 + `list` 등록). |

## 매일 실행 절차

### 0. 준비
- 최신 `master`에서 시작하고, 새 브랜치를 만든다: `git fetch origin master && git checkout -B claude/knowledge-curate-<YYYYMMDD> origin/master`.
- `git config user.email noreply@anthropic.com && git config user.name Claude`.

### 1. 변경 감지
대상 문서 집합 = `list`의 리프 노드 중 `name`이 있고 `route`가 없으며 `wl-`로 시작하지 않는 것(= 강의 문서). Work Log(`wl-*`)와 지도 문서(`ai-map`)는 인덱싱 대상이 **아니다**.

- **신규 문서** = `list`에 있으나 `tools/doc-entries.ko.json`에 없는 이름.
- **삭제 문서** = `doc-entries.ko.json`에 있으나 `list`에 없는 이름.
- **변경 문서** = `doc-entries.ko.json`을 마지막으로 커밋한 이후 내용이 바뀐 문서 파일:
  ```
  LAST=$(git log -1 --format=%H -- tools/doc-entries.ko.json)
  git diff --name-only "$LAST"..HEAD
  ```
  결과에서 대상 문서 이름에 해당하는 것만 추린다.

신규·삭제·변경이 하나도 없으면 → **아무것도 하지 않고 종료**(브랜치·PR 없음).

### 2. 엔트리 갱신 (AI가 문서를 읽고 작성)
신규·변경된 각 문서 파일 `docs/ko/<path>`(물리 위치는 `list` 노드의 `path` 필드, 없으면 flat `<name>`)을 **전문 읽고**, 아래 스키마로 엔트리를 만들어 `tools/doc-entries.ko.json`에 추가/치환한다. 삭제된 문서의 엔트리는 제거한다.

```json
{
  "name": "<파일명>",
  "title": "<첫 <h2>의 텍스트, 태그·엔티티 제거>",
  "summary": "<이 문서가 가르치는 핵심 한 문장 (한글 15~40자)>",
  "concepts": ["<핵심 개념 3~6개>"]
}
```
개념(`concepts`) 규칙:
- 짧고 재사용 가능한 한글 키워드. 같은 개념은 문서 간에 **같은 단어**로(예: `벡터검색`, `서브에이전트`, `오케스트레이터`, `프로그레시브공개`). 기존 `doc-entries.ko.json`의 어휘를 먼저 참고해 일관성을 유지한다.
- 잘 알려진 기술어는 원형 유지(RAG, SKILL.md, MCP, BM25 등).
- 문서 순서는 가급적 `list`의 네비 순서를 따른다(안정적 diff).

**작성 AI·모델 표기 규칙:** AI가 새 문서를 만들거나 기존 문서를 대폭 다시 쓸 때는, `list`의 해당 노드에 `"model": "<이 작업을 수행한 세션의 모델명>"`을 기록한다(제목 우측 배지로 표시됨). 값은 반드시 **그 세션의 실제 정보**를 따르고, 남의 세션 값이나 임의 추정값을 쓰지 않는다. 필드가 없으면 사이트 기본값(`DOC_MODEL`)이 표시된다.

### 3. 인덱스 재생성 (결정적)
```
python3 tools/build_index.py            # data/knowledge-index.ko.json 재생성
python3 tools/build_index.py --check    # 재생성 결과와 파일이 일치하는지 확인(0이어야 함)
python3 tools/build_dates.py            # data/doc-dates.json 재생성 (문서 생성/수정일자 — git 이력 기반)
```
`build_index.py`는 손대지 않는다(로직 변경 필요 시 사람이 검토).
산출물의 **스키마 계약(동결)**은 `tools/schema.md` — 필드 추가는 하위호환, 의미 변경·제거는 `schemaVersion` 증가.

### 4. 지도 갱신(대부분 불필요)
지도 페이지의 표·수치(클러스터·허브·브리지·핵심 개념·총계)는 `data/knowledge-index.ko.json`의 `stats`에서 **사이트가 실시간 렌더**하므로 인덱스만 재생성하면 자동으로 맞는다. `ai-map`을 손댈 일은 **새 클러스터(폴더)가 생겼을 때뿐**이다: 그때는 `tools/clusters.json`에 [섹션 경로, 표시명]을 **모든 언어**에 추가하고(build_index.py 코드는 수정하지 않는다), `ai-map`의 `#km-clusters` `data-topics`에 그 클러스터의 "중심 주제" 문구를 더한 뒤, 정적 폴백 행도 하나 추가한다. SVG·본문 문구 개편은 사람 몫이므로 PR 본문에 제안만 남긴다.

### 5. Work Log 기록 (변경이 있을 때)
인덱스에 변경이 생겼으면(2~4단계에서 무언가 바뀌었으면) **오늘 날짜의 Work Log**도 같은 PR에 함께 갱신한다. 오늘 날짜는 시스템에서 확인한다(예: 커밋 시각 기준 `YYYY-MM-DD`, KST). Work Log는 개발 일지이며 **태그를 달지 않는다.**

Work Log는 **하루 = 여러 주제 문서** 규칙(`wl-guide` 참고)을 따른다 — 큐레이터 활동은 그 자체가 하나의 주제이므로 **전용 문서** `wl-<YYYYMMDD>-curate`에 기록한다(다른 주제 문서에 섞지 않는다).

- **오늘 큐레이터 문서가 이미 있으면**(`wl-<YYYYMMDD>-curate` 파일 존재) 그 문서에 활동을 한 줄 추가한다. 예:
  `<li><strong>AI 지식 큐레이터</strong> — 지식 인덱스 자동 갱신: 신규 X · 변경 Y · 삭제 Z편. <span class="scn-sub">(자동 PR)</span></li>`
- **없으면** 새로 만든다:
  1. 파일 `docs/ko/work-log/<YYYY>/<MM>/<DD>/wl-<YYYYMMDD>-curate` 생성(다른 wl 문서 형식을 따름 — `<h2>YYYY-MM-DD · AI 지식 큐레이터</h2>` + `<p>` 요약 + `<ul><li>` 항목). 첫 항목으로 위 큐레이터 활동 줄을 넣는다.
  2. `list`의 `Work Log → 2026 → MM월` 아래 `DD일` 브랜치에 리프를 등록한다(월/일 브랜치가 없으면 만든다; 같은 날 다른 주제 문서가 있으면 나란히 둔다). 리프 형식: `{"name": "wl-<YYYYMMDD>-curate", "path": "work-log/<YYYY>/<MM>/<DD>/wl-<YYYYMMDD>-curate", "label": "AI 지식 큐레이터"}` — **tags 없음**. `list`은 유효한 JSON이어야 한다.

인덱스 변경이 없으면 Work Log도 건드리지 않는다.

### 6. PR 제안 (변경이 있을 때만)
```
git add tools/doc-entries.ko.json data/knowledge-index.ko.json docs/ko/ai/map/ai-map docs/ko/work-log list
git diff --cached --quiet && echo "no change → stop" && exit 0
git commit -m "지식 인덱스 자동 갱신 (<YYYY-MM-DD>)"    # 트레일러 포함
git push -u origin <branch>
```
그 다음 GitHub로 PR을 연다(제목 예: `지식 인덱스 자동 갱신 (YYYY-MM-DD)`). PR 본문에 **무엇이 신규/변경/삭제됐는지 요약**을 적는다.
- GitHub MCP(`create_pull_request`)가 있으면 그것으로 PR 생성.
- 없으면 브랜치만 푸시하고, PR은 사람이 열 수 있도록 브랜치명과 요약을 리포트한다.

**절대 하지 않을 것:** 자동 머지, `build_index.py` 로직 변경(새 클러스터 등록은 `tools/clusters.json` 데이터 추가로 — 코드 수정 불필요), `data/knowledge-index.ko.json` 직접 편집, (인덱스·지도·오늘 Work Log·`list` 외) 관계없는 파일 수정.

## 커밋 트레일러
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
