# Claude Code Wiki

Claude Code 사용법을 정리한 간단한 위키 사이트입니다.
`fetch()` API로 문서를 동적으로 불러오는 싱글 페이지(SPA) 방식으로 동작하며,
GitHub Pages로 배포됩니다: https://dewytear.github.io

## 주요 기능

- **동적 콘텐츠 로딩** — `index.html`이 `fetch()`로 문서 조각을 불러와 화면에 렌더링합니다.
- **트리형 네비게이션 메뉴** — `list`(JSON) 파일의 트리 구조를 읽어 섹션 + 하위 항목 형태의 사이드바를 자동 생성합니다. 재귀 렌더링이라 원하는 만큼 깊게 중첩할 수 있습니다.
- **URL 해시 라우팅** — `#!install` 처럼 해시로 특정 문서를 바로 열 수 있습니다.
- **낮/밤(다크 모드) 토글** — 하단 푸터의 버튼으로 색상을 전환합니다(`colors.js`의 `nightDayHandler`).
- **반응형 레이아웃** — CSS Grid를 사용하며, 화면이 좁으면(`max-width: 800px`) 단일 컬럼으로 바뀝니다.

## 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html` | 메인 페이지. `fetch()`로 문서를 동적 로딩하는 SPA |
| `colors.js` | 낮/밤 테마 토글 로직 (jQuery 사용) |
| `style.css` | 그리드 레이아웃 및 반응형 스타일 |
| `list` | 네비게이션 메뉴 트리 정의 (JSON) |
| `welcome` | 메인에 처음 표시되는 Claude Code 소개 |
| `install` | 설치 및 시작하기 |
| `commands` | 일상적인 사용법과 슬래시 명령어 |
| `skills` | 스킬(Skills) 소개 |
| `mcp` | MCP 서버 연동 |
| `hooks` | 훅(Hooks) 소개 |

## 문서 추가하기

1. 새 문서 파일을 만듭니다 (예: `settings`). 내용은 `<h2>...</h2><p>...</p>` 형태의 HTML 조각으로 작성합니다.
2. `list`(JSON) 트리에 노드를 추가합니다. 링크 노드는 `{ "name": "settings", "label": "Settings" }`, 섹션은 `{ "title": "...", "children": [ ... ] }` 형태이며 `children`으로 얼마든지 중첩할 수 있습니다.
3. 커밋하면 사이드바 트리에 자동으로 나타납니다.

## 로컬 실행

`fetch()`는 `file://` 프로토콜에서 동작하지 않으므로 로컬 서버가 필요합니다.

```bash
# Python 3
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 접속.
