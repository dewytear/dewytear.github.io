# wiki-plugin — LLM Wiki Plugin

LLM 위키(세컨드 브레인)를 **구축·운영**하는 Claude Code 플러그인.
[dewytear.github.io](https://dewytear.github.io) 위키가 첫 도그푸딩 사용자이자 레퍼런스 구현이다.

## 설치

```
/plugin marketplace add dewytear/dewytear.github.io
/plugin install wiki-plugin@dewytear-wiki
```

## 설치 후 개인설정

**전제 도구** — 스킬이 `python3 tools/*.py`(와 CI에서 `node tools/check_diagram_bounds.mjs`)를 호출하므로 아래가 PATH에 있어야 한다:

| 도구 | 필요도 | 쓰임 |
|---|---|---|
| **Python 3** | 필수 | 인덱스 빌드·일자·모든 `validate_*`/`check_*` |
| **Node.js** | 선택 | 도식 경계 헤드리스 전수 검사(`check_diagram_bounds.mjs`, CI 잡) — 없으면 파이썬 하한 게이트만으로도 머지는 가능 |
| **git 사용자 identity** | 커밋 시 | `build_dates.py`가 생성일을 git 이력에서 뽑고, 커밋 저작자에 쓰임 |

**부트스트랩** — 설치 후 **`/wiki-plugin:wiki-init`을 한 번 실행**하면 뼈대·인덱스 파이프라인·검증 게이트를 세우고, **개인화 인터뷰**로 아래 개인 값을 받아 `config.json`에 채운다(상세·기본값은 `wiki-init` 스킬 문서가 안내):

| 값 | 반영 | 비고 |
|---|---|---|
| 위키 이름 · 부제 | `config.json` `title`·`tagline` (+`index.html` 폴백) | 이름은 반드시 지정 |
| 기본 언어 | `defaults.lang` | ko/en |
| 프로필 이미지 · 한 줄 | `image` · `defaults.photoLine` | 빈 값이면 자동 숨김 |
| 배경음악 | `defaults.music` | ⚠️ **레퍼런스 위키의 개인 YouTube 링크를 그대로 두지 말 것** — 본인 URL 또는 빈 값(끔) |
| 테마 · 액센트 색 | `defaults.theme`·`accentDay`·`accentNight` | 낮/밤 포인트 색 |
| 모듈(music·games) | 안 쓰면 복사 생략 + `index.html` `<script>` 제거 | 선택 |

프로필 사진이 여는 `docs/<lang>/about`도 스캐폴드로 함께 만들어진다.

**개인 설정 vs 사이트 기본값** — `config.json`의 `defaults`가 **모든 방문자**의 시작값이고, 설정 패널에서 저장한 값은 **그 브라우저에서만** 우선한다(기본값과 같으면 저장 안 해 이후 기본값 변경이 계속 전달됨).

**CI 주의** — GitHub Actions checkout은 **`fetch-depth: 0` 필수**다. 얕은 클론이면 `build_dates.py`(생성일=최초 커밋)와 `check_worklog`(base와의 diff)가 오동작한다. `build_dates.py`는 얕은 클론을 감지하면 자동으로 전체 이력을 받고 실패 시 중단하며, `validate_routes`의 `missing-date` ERROR가 생성일 누락을 막는다.

**운영 규칙** — 프로젝트 `CLAUDE.md`에 본문 추가·Work Log·캐시버스터 규칙을 적는다(레퍼런스: [dewytear.github.io의 CLAUDE.md](https://github.com/dewytear/dewytear.github.io/blob/master/CLAUDE.md)).

## 스킬

| 스킬 | 용도 |
|---|---|
| `/wiki-plugin:wiki-init` | 새 위키 프로젝트 부트스트랩(구조·list·인덱스 파이프라인·검증 게이트·CI) |
| `/wiki-plugin:add-doc` | 문서 추가 전체 워크플로(파일→list→doc-entries→인덱스→Work Log→검증) |
| `/wiki-plugin:index` | 지식 인덱스·문서 일자 재생성(`build_index`/`build_dates`) + 계약 준수 |
| `/wiki-plugin:validate` | 품질 검증 일괄(`validate_all` + PR 게이트) + ERROR/WARN 해석 |

## 도구 (tools/)

위키 운영 스크립트 스냅샷을 동봉한다: `build_index.py`(지식 인덱스, schemaVersion 2),
`build_dates.py`(문서 일자, KST), `validate_*.py`(라우트·문서·i18n·그래프·도식),
`check_worklog.py`·`check_cachebuster.py`(PR 게이트), 그리고 계약 문서
`schema.md`·`i18n.md`·`curator.md`. 도식 경계 게이트는 `validate_design.py`가
문자별 폭 실측(`diagram_metrics.json`)으로 확실한 초과만 ERROR로 잡고,
`check_diagram_bounds.mjs`가 헤드리스 브라우저로 전수 확인한다(CI).

**동기화 정책**: 원본(source of truth)은 위키 저장소의 `tools/`이며, 이 디렉토리는
플러그인 버전 시점의 **스냅샷**이다. 스킬은 프로젝트에 `tools/`가 있으면 그것을
우선 사용하고(도그푸딩), 없으면 `${CLAUDE_PLUGIN_ROOT}/tools/`를 쓴다. 스냅샷이
원본과 어긋나면 CI(`tools/check_plugin_sync.py`)가 **기계적으로 실패**시켜
드리프트를 막는다 — 원본을 고치면 사본도 같은 PR에서 재동기화해야 한다.

## 뷰어 (프런트엔드)

SPA 뷰어(index.html·app.js·style.css 등)는 이 번들이 아니라 **마켓 클론에
동봉**된다 — 마켓 추가가 위키 저장소 전체를 클론하므로 뷰어 실물이 항상 최신으로
로컬에 있고, `wiki-init`의 "뷰어 설치" 절이 복사 목록과 커스터마이즈 포인트를
안내한다. (이 구조가 마켓과 위키 저장소를 분리하지 않는 설계 근거이기도 하다 —
분리하려면 뷰어 템플릿화가 선행돼야 한다.)

## 데이터 계약

생성물의 스키마는 [`tools/schema.md`](tools/schema.md) (schemaVersion 2, 동결):
필드 추가는 하위호환, 의미 변경·제거는 schemaVersion 증가.
