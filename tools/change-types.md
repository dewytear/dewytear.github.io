# 변경 유형 기준표 (Change Types)

작업(플랜)을 시작할 때 **변경 유형과 영향 범위를 먼저 선언**하기 위한 기준표입니다.
매니페스트(파일 목록의 미러)도, 게이트(자동 판정기)도 아닙니다 — 아무것도 미러하지
않는 **규칙 표**라 그 자체가 드리프트원이 되지 않고, 판단은 사람/AI 작업자에게
남습니다. 목적은 하나: 유형별 반영 대상(자기기술 문서·플러그인 번들·`?v`·버전·
재생성)을 **작업 시작 시점에** 확인해, 구현 뒤에야 서술·동기화 누락을 발견하는
일(#251 뒤 #252가 필요했던 유형)을 줄이는 것입니다.

## 사용법

플랜 또는 PR 본문에 한 줄로 선언하고, 아래 표에서 해당 행의 체크를 확인합니다.
**복수 선언이 정상**입니다 — 기능 하나가 여러 층을 관통하는 것이 보통입니다.

```
변경 유형: SCHEMA + ENGINE + TOOL
영향 범위: schema.md 갱신 · 자기기술 문서 검토 · ?v 상향 · 번들 동기 + version
```

## 유형표

| 유형 | 무엇을 바꿀 때 | 반영·검토 체크 | 게이트·재생성 | Work Log 프레임 |
|---|---|---|---|---|
| `ENGINE` | 뷰어 동작 JS — app.js·search.js·cosmos.js·graphviews.js 등 `?v` 자산 | 동작 방식이 바뀌면 자기기술 문서(`kgs-*`·`ai-guide`) 서술 검토 · 새 UI 문구는 `STR()` 키(하드코딩 금지) | `?v` 상향(`check_cachebuster --fix`) | ②기능 |
| `STYLE` | style.css·디자인 체계·인라인 SVG 도식 | 디자인 규칙 준수(테마 토큰만·반투명 필 언어) · 도식이면 `check_diagram_bounds.mjs` 로컬 선실행 | `?v` 상향 | ③디자인·UI |
| `TOOL` | `tools/` 빌드·검증·게이트 스크립트와 절차서 | 관련 절차서(i18n.md 등) 정합 · 새 게이트면 CI 스텝 추가 여부 | 번들 동기(`check_plugin_sync --fix`) + plugin.json version 상향 | ④운영·도구 |
| `SCHEMA` | 인덱스·그래프 산출물의 필드·의미(빌드 도구의 출력 계약) | **schema.md를 같은 PR에서 갱신** · additive(하위호환)/파괴적(schemaVersion↑ + 소비자 이행) 판단 · 자기기술 문서(kgs-edges·kgs-ai-layer)·ai-guide 서술 검토 | 재생성(build_index·build_ai_export) + `--check` · 번들 동기 + version | ②기능 |
| `PLUGIN` | `plugins/wiki-plugin/` 자체 — 스킬(SKILL.md)·plugin.json·marketplace | 스킬 문서가 번들 도구·실제 절차와 일치하는지 | plugin.json version 상향(PR 게이트 강제) | ④운영·도구 |
| `CONTENT` | `docs/` 본문·`list`·doc-entries·clusters.json | 문서 추가 5단계(CLAUDE.md — list·doc-entries·인덱스·Work Log·검증) · 번역이면 i18n.md 체크리스트 | 재생성(index·dates·ai_export) · **플러그인 반영 금지**(콘텐츠는 비번들) | ①콘텐츠 |

## 실례 — 왜 선언이 먼저인가

관계 타입 파일럿(#251)은 실제로 `SCHEMA + ENGINE + TOOL + PLUGIN + CONTENT`를
관통하는 변경이었습니다. 데이터·파이프라인·UI·검증·번들·버전은 함께 갔지만,
SCHEMA 행의 "자기기술 문서 서술 검토"가 빠져 별도 PR(#252)로 뒤늦게 정합했습니다.
작업 시작 때 유형을 선언하고 이 표를 훑었다면 그 갭은 구현 PR 안에서 잡혔을
것입니다. 반대로, 판정을 기계화(게이트화)하지 않는 이유도 같은 사례에 있습니다 —
"서술이 충분히 낡았는가"는 오탐 없이 기계가 판정할 수 없는 사람 판단 영역입니다.
