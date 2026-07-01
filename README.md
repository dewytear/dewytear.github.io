# dewytear.github.io

웹 프론트엔드(HTML / CSS / JavaScript) 학습용으로 만든 간단한 위키 스타일 웹사이트입니다.
주제는 **Java 프로그래밍 언어**이며, `fetch()` API를 사용해 콘텐츠를 동적으로 불러오는
싱글 페이지(SPA) 방식으로 동작합니다.

GitHub Pages로 배포됩니다: https://dewytear.github.io

## 주요 기능

- **동적 콘텐츠 로딩** — `index.html`이 `fetch()`로 텍스트 조각(문서)을 불러와 화면에 렌더링합니다.
- **자동 네비게이션 메뉴** — `list` 파일의 항목(`|`로 구분)을 읽어 사이드바 메뉴를 자동 생성합니다.
- **URL 해시 라우팅** — `#!history` 같은 해시로 특정 문서를 바로 열 수 있습니다.
- **낮/밤(다크 모드) 토글** — `colors.js`의 `nightDayHandler`가 배경·글자·링크 색상을 전환합니다.
- **반응형 레이아웃** — CSS Grid를 사용하며, 화면 폭이 좁으면(`max-width: 800px`) 단일 컬럼으로 바뀝니다.

## 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html` | 메인 페이지. `fetch()`로 콘텐츠를 동적 로딩하는 SPA |
| `1.html`, `2.html`, `3.html` | 정적 링크 방식으로 만든 초기 버전 (역사 / 원칙 / 버전) |
| `fetch.html` | `fetch()` API 학습용 예제 |
| `colors.js` | 낮/밤 테마 토글 로직 (jQuery 사용) |
| `style.css` | 그리드 레이아웃 및 반응형 스타일 |
| `welcome` | 메인에 처음 표시되는 Java 소개 문서 |
| `history` | Java의 역사 |
| `principles` | Java의 5대 설계 원칙 |
| `versions` | JDK 1.0 ~ Java SE 13 버전 목록 |
| `jquery` | jQuery 소개 문서 |
| `test` | fetch 동작 확인용 테스트 문서 |
| `list` | 네비게이션 메뉴 항목 목록 (`|`로 구분) |

## 동작 방식

1. `index.html`이 로드되면 `list` 파일을 읽어 사이드바 메뉴를 만듭니다.
2. URL에 해시가 있으면 해당 문서를, 없으면 `welcome` 문서를 불러옵니다.
3. 메뉴를 클릭하면 `fetchPage(파일명)`이 실행되어 `article` 영역의 내용이 교체됩니다.

## 로컬 실행

`fetch()`는 `file://` 프로토콜에서는 동작하지 않으므로 로컬 서버가 필요합니다.

```bash
# Python 3
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 접속.

## 참고

콘텐츠(문서)는 학습 목적으로 위키백과의 Java 관련 문서를 참고했습니다.
