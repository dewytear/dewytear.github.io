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

> **뷰어(프런트엔드)는 플러그인 번들이 아니라 마켓 클론에 동봉된다.** 이 마켓을
> 추가하면 레퍼런스 위키 저장소 전체가 클론되므로, 뷰어 실물(항상 최신)이 이미
> 로컬에 있다 — 아래 "1.5 뷰어 설치"에서 복사한다. 데이터 전용(다른 뷰어/
> 파이프라인의 입력)으로 쓸 거면 그 절은 건너뛴다.

## 1.5 뷰어 설치 (브라우저로 보려면)

마켓 클론 루트(플러그인 기준 `${CLAUDE_PLUGIN_ROOT}/../..`) 또는
`git clone --depth 1 https://github.com/dewytear/dewytear.github.io`에서
**index.html이 로드하는 전부**를 프로젝트 루트로 복사한다:

```
index.html  style.css  folder-dates.css  config.json
colors.js  graphviews.js  core.js  utils.js  i18n.js  cosmos.js
search.js  games.js  app.js  folder-dates.js  music.js
```

이후 이 파일들을 고칠 때는 **캐시버스터 규칙**을 지킨다 — `index.html`이
`?v=`로 로드하는 자산을 수정하면 같은 PR에서 그 `?v`를 올린다
(`check_cachebuster.py`가 강제).

## 1.6 개인화 인터뷰 (필수 — 복사 직후)

복사한 뷰어는 **레퍼런스 위키의 개인 값**(제목 "Aaron's Claude Wiki"·개인
YouTube 음악 링크·profile.jpg·photoLine)을 담고 있다 — **확인 없이 남겨두지
말 것.** 아래 항목을 **사용자에게 질문**하고(AskUserQuestion 도구가 있으면
그것으로, 없으면 대화로) 답을 반영한다. **1번(위키 이름)은 반드시 묻는다**;
나머지는 제안 기본값 수락을 허용한다.

| # | 질문 | 반영 위치 | 미응답 기본값 |
|---|---|---|---|
| 1 | **위키 이름** | `config.json` `title` + `index.html`의 `<title>`·`<h1>` 폴백 | 프로젝트 폴더명 |
| 2 | 부제(태그라인) | `config.json` `tagline` + `index.html` 폴백 | 빈 값 |
| 3 | 기본 언어 | `defaults.lang` (ko/en) | ko |
| 4 | 프로필 사진 | `image` — 사용자 파일 경로, 없으면 빈 값 | 빈 값 (profile.jpg 참조 제거) |
| 5 | 프로필 한 줄 | `defaults.photoLine` — ''이면 자동 숨김 | 빈 값 |
| 6 | 배경음악 | `defaults.music` — 본인 YouTube URL 또는 ''(끔) | '' (**레퍼런스의 개인 링크 상속 금지**) |
| 7 | 테마·액센트 | `defaults.theme`·`accentDay`·`accentNight` | day·#ff6600·#4db6ac |
| 8 | 모듈 선택 | `music.js`·`games.js` 안 쓰면 복사 생략 + `index.html`의 해당 `<script>` 제거 | 둘 다 포함 |

헤더는 `config.json`에서 하이드레이션되므로(title→h1·탭 제목, tagline, image)
**본체는 config.json 수정**이고, `index.html`의 하드코딩 3곳(`<title>`·
`<h1>`·`#tagline`)은 로딩 직전 잠깐 보이는 폴백이라 같은 값으로 맞춰 준다.

## 1.7 about 페이지 (기본 스캐폴드)

프로필 사진 클릭이 `docs/<lang>/about`을 여는데, 파일이 없으면 **빈 화면**이
된다(fetchDoc이 404 시 ''를 반환). 그러므로 기본 about을 반드시 만든다 —
인터뷰의 위키 이름·부제를 넣어 `docs/ko/about`을 스캐폴드:

```html
<h2>{위키 이름} 소개</h2>
<p>{부제 또는 위키 이름}의 지식을 모아 연결하는 위키입니다.</p>
<div class="note">
    <span class="nh">이 페이지 바꾸기</span>
    프로필 사진을 누르면 이 페이지가 열립니다. <code>docs/ko/about</code>
    파일을 수정해 나만의 소개로 바꾸세요.
</div>
```

about은 내비에 등록하지 않는 특수 문서다(`validate_routes`의
`UNLISTED_DOCS`에 이미 예외 등록 — list 노드를 만들지 않는다).

## 2. 초기화 순서

1. `mkdir -p docs/ko data tools` 후 `${CLAUDE_PLUGIN_ROOT}/tools/`의 파일을 프로젝트 `tools/`로 복사.
2. **스타터 콘텐츠** — 새 위키는 본문·대분류·폴더가 전부 비어 있으므로, 첫
   화면 자체가 사용 안내가 되게 한다: 첫 World(예: "가이드") 아래 첫 문서를
   빈 껍데기가 아니라 **"이 위키 키우는 법" 온보딩 가이드**로 만든다. 담을
   골자 —
   ① 지식 트리는 **World → Domain → System → Document**, `list` 노드는
      **name(불변 ID)과 path(물리 경로)를 항상 쌍으로**;
   ② 문서 추가는 `/wiki-plugin:add-doc` 스킬로(파일→list→doc-entries→인덱스
      →Work Log→검증이 한 워크플로);
   ③ 새 대분류(섹션)를 만들면 `tools/clusters.json`에 [섹션 경로, 표시명]을
      모든 언어로 추가(지식지도 클러스터 표시);
   ④ 이 가이드 문서 자체도 여느 문서처럼 수정·삭제해도 된다는 안내.
   `list`에는 이 World 1개 + 가이드 문서 노드로 시작한다.
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
