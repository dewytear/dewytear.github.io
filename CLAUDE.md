# CLAUDE.md

이 저장소에서 AI로 작업할 때의 규칙.

## 소통 규칙
- **디자인 선택지는 이미지와 함께**: 스타일·디자인 대안을 제안하거나 플랜에서 선택을 요청할 때는 글 설명만 하지 말 것. 각 안을 실제로 렌더한 예시 이미지(스크린샷·목업)를 만들어 함께 보여 준 뒤 고르게 한다 — 글만 보고는 선택하기 어렵다.

## 디자인 규칙
- UI 색은 테마 토큰(`var(--accent)`, `var(--muted)`, `var(--border)` 등)만 사용 — 낮/밤 테마 자동 대응. 단, 문서 프래그먼트의 다이어그램 SVG는 Safari 호환을 위해 style.css에 테마별 hex가 하드코딩된 기존 체계를 따른다.
- 새 컴포넌트는 기존 디자인 언어를 따른다: 반투명 필(pill) + backdrop-blur, 평소엔 낮은 존재감·호버 시 깨어남 (예: 검색 화면 `.game-dock`, 사이드바 `.nav-tools`).

## 본문(문서) 추가 규칙
- **문서를 추가하면 지식 체계 반영이 항상 동반된다** (Douzone 등 어느 대분류든 동일):
  1. `list`에 노드 추가 — `label`(+`label_en`), `tags`, 새 문서·대폭 재작성이면 `model` 기록
  2. `tools/doc-entries.ko.json`에 엔트리 추가(title·summary·concepts — 기존 개념 어휘를 재사용해 연관 링크가 생기게) 후 `python3 tools/build_index.py` 재생성 + `--check` 통과 → 지식지도·지식그래프(cosmos)에 자동 반영
  3. 새 대분류(섹션)라면 `tools/build_index.py`의 `CLUSTER_LABELS_BY_LANG`에 **모든 언어** 클러스터 라벨 추가 + `docs/*/ai-map`의 상단 도식·클러스터 표 fallback·`data-topics` 갱신
  4. 작업이 끝나면 **Work Log 문서를 추가**하고 `list`의 해당 날짜 트리에 노드(`"tags": []`)를 단다

## 다국어 규칙
- **번역·언어 관련 작업은 반드시 `tools/i18n.md` 체크리스트를 따른다** — 구조(폴백 계층)·핵심 원칙·추가 순서·검증 목록이 거기 있다. 특히: 문서의 `label_<lang>`·`tags_<lang>`·인덱스 오버레이는 **그 문서의 본문 번역과 같은 PR에서만** 갱신하고, 새 UI 문구는 하드코딩 대신 `STR()` 키 + `STRINGS` 사전으로 넣는다.

## 배포
- GitHub Pages는 `master`를 배포한다. 머지 후 "pages build and deployment" 워크플로가 일시 오류로 실패하면(간헐적) master에 빈 커밋을 푸시해 재트리거한다.
