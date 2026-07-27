// i18n.js — STRINGS 사전 + STR/STRF + 언어 헬퍼 — index.html에서 추출한 모듈 (동작 불변 이동).
// 클래식 스크립트: 최상위 선언은 전역(window) 공유. 로드 순서는 index.html 참조.
// Where a doc's content file lives. `name`은 불변 논리 ID(해시 라우트,
// 인덱스 키)이고, 물리 위치는 list 노드의 `path`(도메인 트리)가 정한다.
// 언어 폴더(docs/en/, docs/zh/, …)는 한국어와 같은 상대 경로를 쓴다.
// ---- 다국어 장치 (language plumbing) ----
// 언어는 설정(effSettings().lang)으로 고르고, 'ko'가 원본 언어.
// 언어를 실제로 얹는 방법: docs/<lang>/에 같은 상대 경로 번역 +
// LANGS_READY에 추가 + STRINGS.<lang> + list의 label_<lang>/tags_<lang>
// + tools/doc-entries.<lang>.json. 없는 조각은 전부 한국어로 폴백.
var LANGS_READY = ['ko', 'en', 'ja'];   // 번역 콘텐츠가 (일부라도) 존재하는 언어
var _i18nLangProvider = function(){ return 'ko'; };
// 설정 모듈이 부트 때 실제 provider를 등록한다 — i18n은 설정을 모른 채 동작.
function i18nSetLangProvider(fn){ _i18nLangProvider = fn; }
function currentLang(){ return _i18nLangProvider() || 'ko'; }
// docs/<lang>/ 아래의 상대 경로 — list에 path가 없으면 flat 폴백.
function docRel(name){
    var d = DOC_BY_NAME[name];
    return (d && d.path) || name;
}
function docPath(name, lang){
    lang = lang || currentLang();
    if(LANGS_READY.indexOf(lang) === -1){ lang = 'ko'; }
    return 'docs/' + lang + '/' + docRel(name);
}
// 현재 언어로 본문을 가져오되, 번역 파일이 없으면(부분 번역 상태)
// 한국어 원본으로 폴백한다.
function fetchDoc(name){
    var p = docPath(name), ko = 'docs/ko/' + docRel(name);
    return fetch(p).then(function(r){
        if(r.ok){ return r.text(); }
        if(p !== ko){ return fetch(ko).then(function(r2){ return r2.ok ? r2.text() : ''; }); }
        return '';
    }).catch(function(){
        return p === ko ? '' :
            fetch(ko).then(function(r2){ return r2.ok ? r2.text() : ''; }).catch(function(){ return ''; });
    });
}
// list 노드의 언어별 필드(label_en, title_en, tags_en …) — 없으면 한국어.
// 폴더(브랜치) 노드는 title_<lang>, 문서 노드는 label_<lang>을 쓴다.
function labelFor(node){
    var l = currentLang();
    return (l !== 'ko' && (node['label_' + l] || node['title_' + l])) || node.label;
}
function tagsFor(node){
    var l = currentLang();
    return (l !== 'ko' && node['tags_' + l]) || node.tags || [];
}
// ---- 개념(concepts) 표시명 ----
// 개념은 문서를 잇는 **조인 키**라 언어별로 바꾸지 않는다(바꾸면 related 계산·
// 검색·그래프가 갈라진다). 대신 화면에 그릴 때만 언어별 표시명으로 바꾼다:
// tools/concepts.<lang>.json = {labels: {"<ko 키>": "<표시명>"}}. 매핑이 없거나
// 한국어 모드면 키 자체를 그대로 보여 준다(라틴 문자 개념은 애초에 매핑 없음).
var CONCEPT_LABELS = null;
function loadConceptLabels(){
    var l = currentLang();
    if(l === 'ko'){ CONCEPT_LABELS = {}; return Promise.resolve({}); }
    return fetch('tools/concepts.' + l + '.json', { cache: 'no-cache' })
        .then(function(r){ return r.ok ? r.json() : { labels: {} }; })
        .then(function(j){ CONCEPT_LABELS = j.labels || {}; return CONCEPT_LABELS; })
        .catch(function(){ CONCEPT_LABELS = {}; return CONCEPT_LABELS; });
}
function conceptLabel(c){
    return (CONCEPT_LABELS && CONCEPT_LABELS[c]) || c;
}
// 화면 문구 사전 — 언어가 준비되면 STRINGS.<lang>을 채운다.
var STRINGS = {
    ko: {
        recent: '최근 문서', related: '연관 문서',
        expandAll: '모두 펼치기', collapseAll: '모두 접기',
        expandAllTitle: '모두 펼치기 — Work Log는 그대로 둡니다(날짜 트리가 길어 목록을 덮습니다)',
        worklogRecent: '최근 로그로', worklogBack: '이전 페이지로',
        searchPh: '제목 · 태그 · 개념 · 본문을 검색…',
        cosmosSub: '지식 연관 관계를 3D 그래프로 — 드래그 회전 · 휠 확대 · 점 클릭 시 문서로',
        cosmosLoading: '지식 인덱스를 불러오는 중…',
        cosmosSub3d2: 'Orbits(궤도계) — World가 항성, System이 행성, 문서가 위성으로 공전합니다 · 드래그 회전 · 휠 확대 · 문서 클릭 시 이웃 보기',
        cosmosSub3d3: 'Strata(계층) — World→Domain→System→Document 네 층 · 드래그 회전 · 휠 확대 · 문서 클릭 시 이웃 보기',
        c2Open: '문서 열기', c2Close: '닫기', c2Refs: '피참조', c2Nbr: '이웃',
        gvView3d: 'Constellation', gvView3d2: 'Orbits', gvView3d3: 'Strata',
        gvBundling: 'Bundling', gvChord: 'Chord',
        gvPacking: 'Packing', gvConcepts: 'Concepts', gvArc: 'Arc', gvMatrix: 'Matrix',
        gvGroup3d: '3D', gvGroup2d: '2D',
        gvDockAria: '그래프 뷰 선택', gvGroupAria: '3D · 2D 선택',
        gvDocsN: '{n}편', gvConceptIn: '{n}편에 등장',
        gvLinksN: '연관 {n}건', gvCrossN: 'System 간 연관 {n}건',
        kmEach: '각 {n}회', kmRefs: '{n}회 연결', kmBridgeN: '{n}개 — ',
        kmDocsN: '{n}편', kmTotals: '지식 문서 {d}편 · 고유 개념 {c}개.',
        digestTitle: '이 폴더 문서 모아보기', relFolder: '같은 폴더',
        relations: '지식 관계', relOut: '이 문서에서', relIn: '이 문서로',
        citedBy: '이 문서를 인용한 문서',
        relTypePrerequisite: '선행지식', relTypeImplements: '구현',
        relTypeExampleOf: '사례', relTypeEvidenceFor: '근거', relTypeSupersedes: '대체',
        tagsTop: '많이 쓰인 태그',
        folderEmpty: '이 폴더에는 모아 볼 문서가 없습니다.',
        folderCount: '문서 {n}개', loading: '불러오는 중…',
        newPageHead: '새 글', newEmpty: '최근 새 글이 없습니다.',
        newCount: '새 글 {n}개', newCollect: '새 글 모아보기', searchGoAria: '검색',
        searchIndexing: '본문 색인을 불러오는 중… (제목·태그·개념 우선)',
        searchSuggests: '관련 개념',
        searchEmpty: '&ldquo;{q}&rdquo;에 대한 결과가 없습니다.',
        searchMore: '외 {n}개 더…',
        searchHead: '무엇을 찾으세요?',
        searchSubline: 'Claude Code · 플러그인 · 하네스 · 세컨드 브레인',
        dockAria: '미니게임 선택',
        g2048: '지식 2048', g2048Long: '지식 2048 — 타일을 합쳐 지식 단계를 키우기 (방향키·스와이프)',
        dateCreated: '생성일자:', dateUpdated: '수정일자:',
        visitsToday: '오늘(UTC)', visitsTotal: '전체',
        visitsTitle: '방문자 수 — 오늘(UTC 기준이라 09:00 KST에 초기화) / 전체 · 쿠키 없는 집계, 최대 4시간 지연',
        docViews: '조회:',
        docViewsTitle: '이 문서의 조회수 (쿠키 없는 집계, 최대 4시간 지연)',
        cosmosTitle: 'Knowledge Graph', tagsTitle: '태그', aboutTitle: '소개',
        g2048New: '새 게임', g2048Over: '게임 오버 — 눌러서 다시', gameBest: 'BEST',
        g2048WinTitle: '세컨드 브레인 탄생',
        g2048WinSub: '타일들이 당신의 지식그래프가 되었습니다 — 눌러서 계속',
        gBreakout: '벽돌깨기', gBreakoutDef: '벽돌깨기 (기본)',
        gConcept: '개념 별똥별 받기', gConceptLong: '개념 별똥별 받기 — 받으면 그 개념으로 검색',
        gPong: '퐁 랠리', gPongLong: '퐁 랠리 — AI 패들과 주고받기',
        gPlane: '종이비행기 글라이딩', gPlaneLong: '종이비행기 글라이딩 — 빈 곳 클릭으로 비행',
        planeHint: '빈 곳을 클릭해 비행 ✈',
        pagerPrev: '이전 6페이지', pagerNext: '다음 6페이지',
        pagerFirst: '처음으로', pagerLast: '끝으로',
        settings: '설정', themeSwitch: 'Day / Night 전환',
        feedTitle: 'RSS 피드 — 새 문서 구독',
        forAiTitle: 'AI용 진입점 — llms.txt',
        licenseTitle: '콘텐츠 라이선스 — CC BY 4.0 (출처를 밝히면 자유롭게 인용·재사용)',
        musicTitle: '배경음악', musicAria: '배경음악 재생',
        musicTitleStop: '배경음악 정지', musicAriaStop: '배경음악 정지',
        aboutAria: 'About — 소개 페이지로 이동',
        lockNote: '설정을 변경하려면 암호를 입력하세요.',
        pw: '암호', ok: '확인', wrongPw: '암호가 올바르지 않습니다.',
        setNote: '변경 내용은 이 브라우저에만 저장됩니다. 프로필 사진은 서버 설정에서 관리합니다.',
        tabBasic: '기본 설정', tabDesign: '디자인 설정',
        fTitle: '타이틀', fTagline: '타이틀 문구', fPhoto: '사진 아래 문구',
        phPhoto: '비우면 문구를 숨깁니다',
        fMusic: '배경음악 (YouTube 링크 또는 영상 ID)',
        phMusic: '예: https://youtu.be/08A9n8QyE3k · 비우면 기본 트랙',
        fLang: '언어 (Language)',
        langKo: '한국어 (기본)', langEn: 'English',
        langZh: '中文 — 준비 중', langJa: '日本語',
        fGame: '통합검색 미니게임 기본값 (방문자는 검색 화면 하단에서 직접 변경 가능)',
        fDisplay: '표시 옵션',
        hideRecentL: '최근 문서 영역 숨기기', hideRelatedL: '연관 문서 영역 숨기기',
        fNewDays: '새 글 표시 기간(일) — 생성 후 이 기간 안이면 새 글로 표시',
        fCats: '대분류 노출 (전체 → 노출로 옮긴 항목만 표시)',
        catAll: '전체 목록', catShown: '노출 목록',
        catAdd: '노출에 추가', catRemove: '노출에서 빼기',
        fNewPw: '새 암호 (변경 시에만 입력)', phNewPw: '비워두면 유지',
        fAccent: '테마 포인트 색상 (고르는 즉시 미리보기, 저장을 눌러야 유지)',
        dayMode: '밝은 모드', nightMode: '다크 모드', resetDefault: '기본값',
        fNavStyle: '목록 구분선 모양',
        optDashed: '파선 (기본)', optDotted: '점선', optSolid: '실선',
        fNavWidth: '목록 구분선 두께',
        optThin: '얇게 (기본)', optMed: '보통', optThick: '굵게',
        fRoundness: '3D 그래프 둥글기 (%)',
        fRoundnessHint: '지식 그래프(3D)의 전체 형태. 100 = 완전한 둥근 공, 낮출수록 분류별로 나뉘어 덜 둥글어집니다.',
        fCosmosLabelMin: '3D 이름표 기준 (피참조 수)',
        fCosmosLabelMinHint: '3D 지식 그래프에서 문서 이름이 상시 표시되는 최소 피참조(다른 문서가 연관으로 지목한) 수. 낮출수록 더 많은 이름이 뜨고, 높일수록 중심 문서만 남습니다. 마우스를 올리면 이 값과 무관하게 이름이 보입니다.',
        save: '저장', resetAll: '기본값으로',
        dumpSummary: '이 브라우저의 현재 설정 값 보기 (진단)',
        thKey: '항목', thVal: '적용 값', thSrc: '출처',
        srcPersonal: '개인 저장', srcSite: '사이트 기본', srcApp: '앱 기본',
        valEmpty: '(비어 있음)', pwChanged: '(변경됨)', pwDefault: '(기본)',
        rowPick: 'wikiGamePick (게임 독 선택)', rowCollapsed: 'navCollapsed (메뉴 접힘)',
        dumpRawL: '이 브라우저에 저장된 원본(JSON)', copy: '복사',
        copied: '설정 JSON을 복사했습니다.',
        copyFail: '복사에 실패했습니다. 직접 선택해 복사해 주세요.',
        saved: '저장되었습니다.', savedPw: '저장되었습니다. 암호가 변경되었습니다.',
        savedLang: '저장되었습니다. 언어 적용을 위해 새로고침합니다…',
        saveFail: '저장에 실패했습니다.',
        resetConfirm: '타이틀·암호를 모두 기본값으로 되돌릴까요?',
        musicFail: '음악 로드 실패 (네트워크·차단기 확인)',
        musicEmbed: '이 영상은 재생할 수 없습니다 (임베드 제한)',
        musicBlockedTitle: '재생 차단됨 — 눌러서 YouTube에서 열기',
        musicNotice: '배경음악(YouTube)이 차단됐어요. Safari라면 <b>크로스 사이트 추적 방지</b> 때문일 수 있어요.<br>버튼을 누르면 <b>YouTube에서 열기</b> &#8599;'
    },
    en: {
        recent: 'Recent Docs', related: 'Related Docs',
        expandAll: 'Expand all', collapseAll: 'Collapse all',
        expandAllTitle: 'Expand all — Work Log is left as is (its date tree would bury the list)',
        worklogRecent: 'Latest log', worklogBack: 'Back',
        searchPh: 'Search titles · tags · concepts · full text…',
        cosmosSub: 'Knowledge as a 3D graph — drag to rotate · wheel to zoom · click to open',
        cosmosLoading: 'Loading the knowledge index…',
        cosmosSub3d2: 'Orbits — Worlds are stars, Systems are planets, documents are moons · drag to rotate · wheel to zoom · click a doc for its neighbours',
        cosmosSub3d3: 'Strata — World → Domain → System → Document as four floors · drag to rotate · wheel to zoom · click a doc for its neighbours',
        c2Open: 'Open document', c2Close: 'Close', c2Refs: 'cited', c2Nbr: 'neighbours',
        gvView3d: 'Constellation', gvView3d2: 'Orbits', gvView3d3: 'Strata',
        gvBundling: 'Bundling', gvChord: 'Chord',
        gvPacking: 'Packing', gvConcepts: 'Concepts', gvArc: 'Arc', gvMatrix: 'Matrix',
        gvGroup3d: '3D', gvGroup2d: '2D',
        gvDockAria: 'Choose a graph view', gvGroupAria: 'Choose 3D or 2D',
        gvDocsN: '{n} docs', gvConceptIn: 'in {n} docs',
        gvLinksN: '{n} links', gvCrossN: '{n} cross-System links',
        kmEach: '×{n} each', kmRefs: '{n} links', kmBridgeN: '{n} — ',
        kmDocsN: '{n} docs', kmTotals: '{d} knowledge docs · {c} unique concepts.',
        digestTitle: 'Read this folder on one page', relFolder: 'same folder',
        relations: 'Knowledge Relations', relOut: 'From this doc', relIn: 'To this doc',
        citedBy: 'Cited by',
        relTypePrerequisite: 'Prerequisite', relTypeImplements: 'Implements',
        relTypeExampleOf: 'Example of', relTypeEvidenceFor: 'Evidence for', relTypeSupersedes: 'Supersedes',
        tagsTop: 'Most used tags',
        folderEmpty: 'This folder has no docs to gather.',
        folderCount: '{n} docs', loading: 'Loading…',
        newPageHead: 'New', newEmpty: 'No recent new docs.',
        newCount: '{n} new', newCollect: 'New docs', searchGoAria: 'Search',
        searchIndexing: 'Indexing doc bodies… (titles · tags · concepts first)',
        searchSuggests: 'Related concepts',
        searchEmpty: 'No results for &ldquo;{q}&rdquo;.',
        searchMore: '+{n} more…',
        searchHead: 'What are you looking for?',
        searchSubline: 'Claude Code · Plugins · Harness · Second Brain',
        dockAria: 'Choose a mini game',
        g2048: 'Knowledge 2048', g2048Long: 'Knowledge 2048 — merge tiles up the knowledge ladder (arrows / swipe)',
        dateCreated: 'Created:', dateUpdated: 'Updated:',
        visitsToday: 'Today (UTC)', visitsTotal: 'Total',
        visitsTitle: 'Visitors — today (UTC day, resets at 00:00 UTC) / all time · cookieless, up to 4h behind',
        docViews: 'Views:',
        docViewsTitle: 'Views of this document (cookieless, up to 4h behind)',
        cosmosTitle: 'Knowledge Graph', tagsTitle: 'Tags', aboutTitle: 'About',
        g2048New: 'New game', g2048Over: 'Game over — tap to restart', gameBest: 'BEST',
        g2048WinTitle: 'A Second Brain is born',
        g2048WinSub: 'Your tiles became a knowledge graph — tap to continue',
        gBreakout: 'Breakout', gBreakoutDef: 'Breakout (default)',
        gConcept: 'Concept catch', gConceptLong: 'Concept catch — catching one searches it',
        gPong: 'Pong rally', gPongLong: 'Pong rally — volley with an AI paddle',
        gPlane: 'Paper-plane gliding', gPlaneLong: 'Paper-plane gliding — click empty space to fly',
        planeHint: 'Click empty space to fly ✈',
        pagerPrev: 'Previous 6 pages', pagerNext: 'Next 6 pages',
        pagerFirst: 'First page', pagerLast: 'Last page',
        settings: 'Settings', themeSwitch: 'Day / Night',
        feedTitle: 'RSS feed — subscribe to new docs',
        forAiTitle: 'For AI — llms.txt entry point',
        licenseTitle: 'Content license — CC BY 4.0 (quote and reuse with attribution)',
        musicTitle: 'Background music', musicAria: 'Play background music',
        musicTitleStop: 'Stop background music', musicAriaStop: 'Stop background music',
        aboutAria: 'About — go to the profile page',
        lockNote: 'Enter the password to change settings.',
        pw: 'Password', ok: 'OK', wrongPw: 'Wrong password.',
        setNote: 'Changes are saved in this browser only. The profile photo is managed in server config.',
        tabBasic: 'Basic', tabDesign: 'Design',
        fTitle: 'Title', fTagline: 'Tagline', fPhoto: 'Photo caption',
        phPhoto: 'Leave empty to hide it',
        fMusic: 'Background music (YouTube link or video id)',
        phMusic: 'e.g. https://youtu.be/08A9n8QyE3k · empty = default track',
        fLang: 'Language',
        langKo: '한국어 (Korean, default)', langEn: 'English',
        langZh: '中文 — coming soon', langJa: '日本語 (Japanese)',
        fGame: 'Default search mini game (visitors can switch in the dock)',
        fDisplay: 'Display options',
        hideRecentL: 'Hide the Recent Docs module', hideRelatedL: 'Hide the Related Docs module',
        fNewDays: 'New-doc window (days) — a doc counts as new within this many days of creation',
        fCats: 'Top-level categories (only items moved to Shown are visible)',
        catAll: 'All', catShown: 'Shown',
        catAdd: 'Add to shown', catRemove: 'Remove from shown',
        fNewPw: 'New password (only to change it)', phNewPw: 'Leave empty to keep',
        fAccent: 'Theme accent colors (live preview; Save to keep)',
        dayMode: 'Light', nightMode: 'Dark', resetDefault: 'Default',
        fNavStyle: 'List divider style',
        optDashed: 'Dashed (default)', optDotted: 'Dotted', optSolid: 'Solid',
        fNavWidth: 'List divider width',
        optThin: 'Thin (default)', optMed: 'Medium', optThick: 'Bold',
        fRoundness: '3D graph roundness (%)',
        fRoundnessHint: 'Overall shape of the 3D knowledge graph. 100 = a full round ball; lower values split it by category and make it less round.',
        fCosmosLabelMin: '3D label threshold (references)',
        fCosmosLabelMinHint: 'Minimum number of incoming references (docs that link here) for a document name to always show in the 3D graph. Lower = more names shown; higher = only central hubs. Hovering shows the name regardless.',
        save: 'Save', resetAll: 'Reset to defaults',
        dumpSummary: "View this browser's current settings (diagnostics)",
        thKey: 'Key', thVal: 'Applied value', thSrc: 'Source',
        srcPersonal: 'personal', srcSite: 'site default', srcApp: 'app default',
        valEmpty: '(empty)', pwChanged: '(changed)', pwDefault: '(default)',
        rowPick: 'wikiGamePick (game-dock pick)', rowCollapsed: 'navCollapsed (menu collapsed)',
        dumpRawL: 'Raw JSON stored in this browser', copy: 'Copy',
        copied: 'Settings JSON copied.',
        copyFail: 'Copy failed — select and copy it manually.',
        saved: 'Saved.', savedPw: 'Saved. Password changed.',
        savedLang: 'Saved. Reloading to apply the language…',
        saveFail: 'Save failed.',
        resetConfirm: 'Reset title, password and all settings to defaults?',
        musicFail: 'Music failed to load (check network / blockers)',
        musicEmbed: "This video can't be played (embedding restricted)",
        musicBlockedTitle: 'Playback blocked — press to open on YouTube',
        musicNotice: 'Background music (YouTube) was blocked. On Safari this may be <b>Prevent Cross-Site Tracking</b>.<br>Press the button to <b>open it on YouTube</b> &#8599;'
    },
    ja: {
        recent: '最近の文書', related: '関連文書',
        expandAll: 'すべて展開', collapseAll: 'すべて折りたたむ',
        expandAllTitle: 'すべて展開 — Work Log はそのままにします（日付ツリーが長く一覧を埋めるため）',
        worklogRecent: '最新のログへ', worklogBack: '前のページへ',
        searchPh: 'タイトル・タグ・概念・本文を検索…',
        cosmosSub: '知識のつながりを3Dグラフで — ドラッグで回転 · ホイールで拡大 · 点をクリックで文書へ',
        cosmosLoading: '知識インデックスを読み込み中…',
        cosmosSub3d2: 'Orbits（軌道系）— World が恒星、System が惑星、文書が衛星として公転します · ドラッグで回転 · ホイールで拡大 · 文書をクリックで隣接を表示',
        cosmosSub3d3: 'Strata（階層）— World→Domain→System→Document の四層 · ドラッグで回転 · ホイールで拡大 · 文書をクリックで隣接を表示',
        c2Open: '文書を開く', c2Close: '閉じる', c2Refs: '被参照', c2Nbr: '隣接',
        gvView3d: 'Constellation', gvView3d2: 'Orbits', gvView3d3: 'Strata',
        gvBundling: 'Bundling', gvChord: 'Chord',
        gvPacking: 'Packing', gvConcepts: 'Concepts', gvArc: 'Arc', gvMatrix: 'Matrix',
        gvGroup3d: '3D', gvGroup2d: '2D',
        gvDockAria: 'グラフビューを選択', gvGroupAria: '3D・2D を選択',
        gvDocsN: '{n}件', gvConceptIn: '{n}件に登場',
        gvLinksN: '関連{n}件', gvCrossN: 'System 間の関連{n}件',
        kmEach: '各{n}回', kmRefs: '{n}回リンク', kmBridgeN: '{n}件 — ',
        kmDocsN: '{n}件', kmTotals: '知識文書{d}件 · 固有概念{c}個。',
        digestTitle: 'このフォルダの文書をまとめて読む', relFolder: '同じフォルダ',
        relations: '知識の関係', relOut: 'この文書から', relIn: 'この文書へ',
        citedBy: 'この文書を引用した文書',
        relTypePrerequisite: '前提知識', relTypeImplements: '実装',
        relTypeExampleOf: '事例', relTypeEvidenceFor: '根拠', relTypeSupersedes: '置き換え',
        tagsTop: 'よく使われるタグ',
        folderEmpty: 'このフォルダにまとめて読む文書はありません。',
        folderCount: '文書{n}件', loading: '読み込み中…',
        newPageHead: '新着', newEmpty: '最近の新着はありません。',
        newCount: '新着{n}件', newCollect: '新着をまとめて見る', searchGoAria: '検索',
        searchIndexing: '本文インデックスを読み込み中…（タイトル・タグ・概念が先）',
        searchSuggests: '関連する概念',
        searchEmpty: '&ldquo;{q}&rdquo; に一致する結果はありません。',
        searchMore: 'ほか{n}件…',
        searchHead: '何をお探しですか？',
        searchSubline: 'Claude Code · プラグイン · ハーネス · セカンドブレイン',
        dockAria: 'ミニゲームを選択',
        g2048: '知識2048', g2048Long: '知識2048 — タイルを合わせて知識の段階を上げる（矢印キー・スワイプ）',
        dateCreated: '作成日:', dateUpdated: '更新日:',
        visitsToday: '本日(UTC)', visitsTotal: '累計',
        visitsTitle: '訪問者数 — 本日（UTC基準のため 09:00 JST にリセット）/ 累計 · Cookie不使用、最大4時間の遅延',
        docViews: '閲覧:',
        docViewsTitle: 'この文書の閲覧数（Cookie不使用、最大4時間の遅延）',
        cosmosTitle: 'Knowledge Graph', tagsTitle: 'タグ', aboutTitle: '紹介',
        g2048New: '新しいゲーム', g2048Over: 'ゲームオーバー — 押してもう一度', gameBest: 'BEST',
        g2048WinTitle: 'セカンドブレイン誕生',
        g2048WinSub: 'タイルがあなたの知識グラフになりました — 押して続行',
        gBreakout: 'ブロック崩し', gBreakoutDef: 'ブロック崩し（既定）',
        gConcept: '概念キャッチ', gConceptLong: '概念キャッチ — 受け取るとその概念で検索',
        gPong: 'ポンラリー', gPongLong: 'ポンラリー — AIパドルと打ち合う',
        gPlane: '紙飛行機グライド', gPlaneLong: '紙飛行機グライド — 空白をクリックで飛行',
        planeHint: '空白をクリックして飛行 ✈',
        pagerPrev: '前の6ページ', pagerNext: '次の6ページ',
        pagerFirst: '最初へ', pagerLast: '最後へ',
        settings: '設定', themeSwitch: 'ライト / ダーク',
        feedTitle: 'RSSフィード — 新着文書を購読',
        forAiTitle: 'AI用の入口 — llms.txt',
        licenseTitle: 'コンテンツライセンス — CC BY 4.0（出典を示せば自由に引用・再利用可）',
        musicTitle: 'BGM', musicAria: 'BGMを再生',
        musicTitleStop: 'BGM を停止', musicAriaStop: 'BGM を停止',
        aboutAria: 'About — 紹介ページへ移動',
        lockNote: '設定を変更するにはパスワードを入力してください。',
        pw: 'パスワード', ok: 'OK', wrongPw: 'パスワードが正しくありません。',
        setNote: '変更はこのブラウザにのみ保存されます。プロフィール写真はサーバー設定で管理します。',
        tabBasic: '基本設定', tabDesign: 'デザイン設定',
        fTitle: 'タイトル', fTagline: 'タイトル文', fPhoto: '写真の下の文',
        phPhoto: '空にすると非表示になります',
        fMusic: 'BGM（YouTubeリンクまたは動画ID）',
        phMusic: '例: https://youtu.be/08A9n8QyE3k · 空なら既定のトラック',
        fLang: '言語 (Language)',
        langKo: '한국어 (韓国語・既定)', langEn: 'English',
        langZh: '中文 — 準備中', langJa: '日本語',
        fGame: '統合検索のミニゲーム既定値（訪問者は検索画面下部で変更できます）',
        fDisplay: '表示オプション',
        hideRecentL: '「最近の文書」を隠す', hideRelatedL: '「関連文書」を隠す',
        fNewDays: '新着として表示する期間（日）— 作成からこの期間内なら新着',
        fCats: '大分類の表示（「表示」に移した項目だけが出ます）',
        catAll: '全一覧', catShown: '表示一覧',
        catAdd: '表示に追加', catRemove: '表示から外す',
        fNewPw: '新しいパスワード（変更するときだけ入力）', phNewPw: '空なら維持',
        fAccent: 'テーマのアクセント色（選ぶとすぐプレビュー、保存で確定）',
        dayMode: 'ライトモード', nightMode: 'ダークモード', resetDefault: '既定値',
        fNavStyle: '一覧の区切り線の形',
        optDashed: '破線（既定）', optDotted: '点線', optSolid: '実線',
        fNavWidth: '一覧の区切り線の太さ',
        optThin: '細い（既定）', optMed: '普通', optThick: '太い',
        fRoundness: '3Dグラフの丸み (%)',
        fRoundnessHint: '3D知識グラフ全体の形。100 = 完全な球、下げるほど分類ごとに分かれて丸みが減ります。',
        fCosmosLabelMin: '3Dラベルの基準（被参照数）',
        fCosmosLabelMinHint: '3D知識グラフで文書名が常時表示される最小の被参照数（他の文書が関連として指した数）。下げるほど多くの名前が出て、上げるほど中心の文書だけが残ります。マウスを乗せればこの値に関係なく名前が出ます。',
        save: '保存', resetAll: '既定値に戻す',
        dumpSummary: 'このブラウザの現在の設定値を見る（診断）',
        thKey: '項目', thVal: '適用値', thSrc: '出所',
        srcPersonal: '個人保存', srcSite: 'サイト既定', srcApp: 'アプリ既定',
        valEmpty: '（空）', pwChanged: '（変更済み）', pwDefault: '（既定）',
        rowPick: 'wikiGamePick（ゲームドックの選択）', rowCollapsed: 'navCollapsed（メニュー折りたたみ）',
        dumpRawL: 'このブラウザに保存された原本(JSON)', copy: 'コピー',
        copied: '設定JSONをコピーしました。',
        copyFail: 'コピーに失敗しました。手動で選択してコピーしてください。',
        saved: '保存しました。', savedPw: '保存しました。パスワードを変更しました。',
        savedLang: '保存しました。言語を適用するため再読み込みします…',
        saveFail: '保存に失敗しました。',
        resetConfirm: 'タイトル・パスワードをすべて既定値に戻しますか？',
        musicFail: '音楽の読み込みに失敗（ネットワーク・ブロッカーを確認）',
        musicEmbed: 'この動画は再生できません（埋め込み制限）',
        musicBlockedTitle: '再生がブロックされました — 押して YouTube で開く',
        musicNotice: 'BGM（YouTube）がブロックされました。Safari の場合は <b>サイト越えトラッキングを防ぐ</b> が原因かもしれません。<br>ボタンを押すと <b>YouTube で開きます</b> &#8599;'
    }
};
function STR(k){
    var l = currentLang();
    return (STRINGS[l] && STRINGS[l][k]) || STRINGS.ko[k] || k;
}
// Template variant: STRF('kmRefs', {n: 3}) → "3회 연결" / "3 links".
function STRF(k, vars){
    var t = STR(k);
    Object.keys(vars || {}).forEach(function(x){
        t = t.replace('{' + x + '}', vars[x]);
    });
    return t;
}

// ISO 날짜(YYYY-MM-DD)를 현재 언어의 표기법으로 — ko "2026년 7월 6일",
// en "July 6, 2026". Intl이 없거나 실패해도 ISO를 그대로 노출하지 않는다.
function formatDocDate(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if(!m){ return ''; }
    var y = +m[1], mo = +m[2], d = +m[3];
    var lang = currentLang();
    try{
        return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' })
            .format(new Date(y, mo - 1, d));
    }catch(e){
        return lang === 'ko' ? (y + '년 ' + mo + '월 ' + d + '일') : (mo + '/' + d + '/' + y);
    }
}
