# wiki-plugin — LLM Wiki Plugin

LLM 위키(세컨드 브레인)를 **구축·운영**하는 Claude Code 플러그인.
[dewytear.github.io](https://dewytear.github.io) 위키가 첫 도그푸딩 사용자이자 레퍼런스 구현이다.

## 설치

```
/plugin marketplace add dewytear/dewytear.github.io
/plugin install wiki-plugin@dewytear-wiki
```

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
우선 사용하고(도그푸딩), 없으면 `${CLAUDE_PLUGIN_ROOT}/tools/`를 쓴다.

## 데이터 계약

생성물의 스키마는 [`tools/schema.md`](tools/schema.md) (schemaVersion 2, 동결):
필드 추가는 하위호환, 의미 변경·제거는 schemaVersion 증가.
