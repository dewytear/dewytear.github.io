// core.js — App 네임스페이스: 상태 프록시 · 데이터 어댑터 · 모듈 간 계약.
// 이 파일이 모든 모듈보다 먼저 로드된다 (colors/graphviews 다음).
window.App = window.App || {};

// 전역 상태 프록시 — 기존 전역명(var = window.*)을 그대로 비추므로
// 전환기 동안 두 이름이 항상 같은 값을 가리킨다. 새 코드는 App.state를 쓴다.
App.state = {};
['DOCS', 'TAG_INDEX', 'DOC_BY_NAME', 'FOLDER_DOCS', 'DOC_MODEL',
 'KNOWLEDGE', 'KNOWLEDGE_STATS', 'CURRENT_DOC', 'ALL_CONCEPTS'
].forEach(function(k){
    Object.defineProperty(App.state, k, {
        get: function(){ return window[k]; },
        set: function(v){ window[k] = v; },
        enumerable: true
    });
});

// 데이터 어댑터 — 인덱스가 단일 JSON이든, World별 샤드든, API든
// 이 두 함수 뒤에서만 바뀐다. 호출부는 형태를 모른다.
// 데이터 3종(list·doc-dates·knowledge-index)은 ?v= 캐시버스터 없이 로드되므로
// {cache:'no-cache'}로 매번 ETag 재검증한다(변경 없으면 304, 재다운로드 없음) —
// 안 그러면 재방문 브라우저(특히 iOS Safari)가 옛 데이터를 계속 써서
// 새 문서·관계가 조용히 안 뜬다. 문서 프래그먼트는 클릭마다 왕복이 붙어 제외.
App.data = {
    // 내비 트리(list). resolve: 파싱된 tree.
    loadList: function(){
        return fetch('list', { cache: 'no-cache' }).then(function(r){
            if(!r.ok){ throw new Error('list'); }
            return r.json();
        });
    },
    // 문서 날짜(생성 c / 수정 u — git 이력에서 tools/build_dates.py가 생성).
    // 1회 fetch 후 캐시. 실패 시 빈 사전으로 resolve — 날짜만 조용히 미표기.
    loadDates: function(){
        if(!this._dates){
            this._dates = fetch('data/doc-dates.json', { cache: 'no-cache' })
                .then(function(r){ if(!r.ok){ throw new Error('doc-dates'); } return r.json(); })
                .catch(function(){ return { docs: {} }; });
        }
        return this._dates;
    },
    // 지식 인덱스. 요청 언어 → 한국어 폴백. resolve: 파싱된 index.
    loadIndex: function(lang){
        var urls = ['data/knowledge-index.' + lang + '.json'];
        if(lang !== 'ko'){ urls.push('data/knowledge-index.ko.json'); }
        return urls.reduce(function(prev, u){
            return prev.catch(function(){
                return fetch(u, { cache: 'no-cache' }).then(function(r){
                    if(!r.ok){ throw new Error(u); }
                    return r.json();
                });
            });
        }, Promise.reject());
    }
};

// 게임 ↔ 검색 UI 계약 — 게임이 검색 화면 DOM을 직접 셀렉트하는 대신
// 이 인터페이스로만 접근한다 (물리 충돌체·모드 판정용).
App.searchDock = {
    field: function(){ return document.querySelector('.search-field'); },
    screen: function(){ return document.querySelector('.search-screen'); }
};
