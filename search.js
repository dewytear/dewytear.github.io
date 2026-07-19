// search.js — 통합 검색: 전문(lazy full-text) · 개념 · 검색 화면 UI(게임 도크 마크업 포함).
// index.html에서 추출 (동작 불변 이동). buildTextIndex의 '전 문서 fetch' 절벽 교체는
// 이 모듈 내부 수술로 국소화된다. 로드 순서: i18n 이후, games보다 앞뒤 무관, app 부트 이전.
// ---- Unified search screen (landing page & title click) ----
// Full-text index over the doc bodies, built lazily in the background
// the first time the search screen opens.
var DOC_TEXT = {};        // name -> lowercased plain-text body (matching)
var DOC_TEXT_RAW = {};    // name -> plain-text body, original case (snippets)
var TEXT_INDEX_READY = false;
var textIndexStarted = false;

// Work Log entries are dev journal, not reference content — keep them
// out of the unified search (results and the body index alike).
function isSearchableDoc(d){
    return d.section.indexOf('Work Log') !== 0;
}

// Turn a doc's HTML into searchable plain text. Bodies carry only
// inline SVG (no external <img>), so a detached element is safe and
// its textContent also captures diagram labels.
function stripHtml(html){
    var d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

function buildTextIndex(){
    return Promise.all(DOCS.filter(isSearchableDoc).map(function(d){
        return fetchDoc(d.name).then(function(t){
            var txt = stripHtml(t);
            DOC_TEXT_RAW[d.name] = txt;
            DOC_TEXT[d.name] = txt.toLowerCase();
        }).catch(function(){});
    })).then(function(){
        TEXT_INDEX_READY = true;
        // Re-run the current query now that bodies are searchable.
        var box = document.getElementById('search-input');
        var _sr = document.getElementById('search-results');
        if(box && box.value.trim() && _sr && _sr.classList.contains('open')){ renderSearchResults(box.value); }
    });
}

function ensureTextIndex(){
    if(textIndexStarted){ return; }
    textIndexStarted = true;
    buildTextIndex();
}

// Concept-aware ranked search. Every term must still match somewhere
// (label / section / tags / AI concepts / AI summary / body), but hits
// are SCORED and ranked so meaning-level matches (the knowledge index's
// concepts) rise above incidental body mentions. Returns
// [{d, score, concepts:[matched concept names]}], best first.
// Field weights: concept 5 (exact 8) > label 4 > tag 3 > summary/section 2 > body 1.
function searchDocs(query){
    var q = query.trim().toLowerCase();
    if(!q){ return []; }
    var terms = q.split(/\s+/);
    var out = [];
    DOCS.forEach(function(d){
        if(!isSearchableDoc(d)){ return; }
        var info = KNOWLEDGE ? KNOWLEDGE[d.name] : null;
        var concepts = (info && info.concepts) || [];
        var conceptsLow = concepts.map(function(c){ return c.toLowerCase(); });
        var label = d.label.toLowerCase();
        var section = d.section.toLowerCase();
        var tagsLow = d.tags.join(' ').toLowerCase();
        var summaryLow = ((info && info.summary) || '').toLowerCase();
        var body = DOC_TEXT[d.name] || '';
        var score = 0, matched = [], ok = true;
        terms.forEach(function(t){
            var s = 0;
            for(var i = 0; i < conceptsLow.length; i++){
                if(conceptsLow[i].indexOf(t) !== -1){
                    s = Math.max(s, conceptsLow[i] === t ? 8 : 5);
                    if(matched.indexOf(concepts[i]) === -1){ matched.push(concepts[i]); }
                }
            }
            if(label.indexOf(t) !== -1){ s = Math.max(s, 4); }
            if(tagsLow.indexOf(t) !== -1){ s = Math.max(s, 3); }
            if(summaryLow.indexOf(t) !== -1){ s = Math.max(s, 2); }
            if(section.indexOf(t) !== -1){ s = Math.max(s, 2); }
            if(body.indexOf(t) !== -1){ s = Math.max(s, 1); }
            if(s === 0){ ok = false; }
            score += s;
        });
        if(ok && score > 0){ out.push({ d: d, score: score, concepts: matched }); }
    });
    out.sort(function(a, b){ return b.score - a.score; });
    return out;
}

// Concept names containing the query — offered as one-tap pivots so a
// user can search by meaning (the wiki's shared vocabulary).
var ALL_CONCEPTS = [];
function buildConceptIndex(){
    var set = {};
    Object.keys(KNOWLEDGE || {}).forEach(function(n){
        ((KNOWLEDGE[n] && KNOWLEDGE[n].concepts) || []).forEach(function(c){ set[c] = true; });
    });
    ALL_CONCEPTS = Object.keys(set).sort(function(a, b){ return a.localeCompare(b, 'ko'); });
}
function conceptSuggestions(query){
    var q = query.trim().toLowerCase();
    if(!q || !ALL_CONCEPTS.length){ return []; }
    return ALL_CONCEPTS.filter(function(c){
        var cl = c.toLowerCase();
        return cl.indexOf(q) !== -1 && cl !== q;   // skip the exact-typed one
    }).slice(0, 6);
}
function pickConcept(el){
    var box = document.getElementById('search-input');
    if(box){ box.value = el.getAttribute('data-c'); box.focus(); renderSearchResults(box.value); }
}

// Wrap each search term in <mark>, matching against the RAW text (so
// terms like "amp"/"lt" don't hit HTML entities), then escape each
// segment. Case-insensitive; overlapping matches merged.
function highlightTerms(text, terms){
    var lower = text.toLowerCase(), ranges = [];
    terms.forEach(function(t){
        if(!t){ return; }
        t = t.toLowerCase();
        var i = 0, p;
        while((p = lower.indexOf(t, i)) !== -1){ ranges.push([p, p + t.length]); i = p + t.length; }
    });
    if(!ranges.length){ return escapeHtml(text); }
    ranges.sort(function(a, b){ return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function(r){
        var last = merged[merged.length - 1];
        if(last && r[0] <= last[1]){ last[1] = Math.max(last[1], r[1]); }
        else { merged.push(r.slice()); }
    });
    var out = '', pos = 0;
    merged.forEach(function(r){
        out += escapeHtml(text.slice(pos, r[0]))
             + '<mark>' + escapeHtml(text.slice(r[0], r[1])) + '</mark>';
        pos = r[1];
    });
    return out + escapeHtml(text.slice(pos));
}

// A short body excerpt around the first matching term, highlighted.
// Empty when the match was only in the label/section/tags.
function makeSnippet(name, terms){
    var low = DOC_TEXT[name], raw = DOC_TEXT_RAW[name];
    if(!low || !raw){ return ''; }
    var pos = -1;
    terms.forEach(function(t){
        var p = t ? low.indexOf(t) : -1;
        if(p !== -1 && (pos === -1 || p < pos)){ pos = p; }
    });
    if(pos === -1){ return ''; }
    var start = Math.max(0, pos - 40);
    var end = Math.min(raw.length, pos + 80);
    return (start > 0 ? '…' : '') + highlightTerms(raw.slice(start, end), terms)
         + (end < raw.length ? '…' : '');
}

var SEARCH_LIMIT = 8;
// Show/hide the results panel AND the 2048 board watermark in lockstep.
// Hiding only removes .open (CSS: #search-results:not(.open){display:none})
// so the built results and the typed query survive — an outside click can
// dismiss, and re-focusing the field restores them.
function setSearchShown(on){
    var r = document.getElementById('search-results');
    var s = document.querySelector('.search-screen');
    if(r){ r.classList.toggle('open', on); }
    if(s){ s.classList.toggle('searching', on); }
}
function renderSearchResults(query){
    var box = document.getElementById('search-results');
    if(!box){ return; }
    paddleReset();   // typing = searching: glide the field back home
    var q = query.trim();
    if(!q){ box.innerHTML = ''; setSearchShown(false); return; }
    var terms = q.toLowerCase().split(/\s+/);
    var hits = searchDocs(query);
    var indexing = !TEXT_INDEX_READY
                 ? '<p class="search-indexing">' + STR('searchIndexing') + '</p>' : '';
    // Meaning-level pivots: concepts the query partially names.
    var suggests = conceptSuggestions(query);
    var suggestHtml = '';
    if(suggests.length){
        suggestHtml = '<div class="sh-suggests"><span class="sh-suggests-label">' + STR('searchSuggests') + '</span>';
        suggests.forEach(function(c){
            suggestHtml += '<button type="button" class="sh-suggest" data-c="'
                        +  escapeHtml(c) + '" onclick="pickConcept(this)">'
                        +  escapeHtml(c) + '</button>';
        });
        suggestHtml += '</div>';
    }
    if(!hits.length){
        box.innerHTML = suggestHtml
                      + '<p class="search-empty">' + STRF('searchEmpty', { q: escapeHtml(q) }) + '</p>' + indexing;
        setSearchShown(true);
        return;
    }
    var html = suggestHtml;
    hits.slice(0, SEARCH_LIMIT).forEach(function(h){
        var d = h.d;
        html += '<a class="search-hit" href="#!' + d.name + '">'
             +  '<span class="sh-label">' + escapeHtml(d.label) + '</span>'
             +  '<span class="sh-meta">' + escapeHtml(d.sectionL) + '</span>';
        // Which concept(s) matched — the "semantic" signal.
        if(h.concepts.length){
            html += '<span class="sh-concepts">';
            h.concepts.slice(0, 3).forEach(function(c){
                html += '<span class="sh-concept">' + escapeHtml(c) + '</span>';
            });
            html += '</span>';
        }
        // Body snippet around the match; else fall back to the AI summary.
        var snip = makeSnippet(d.name, terms);
        if(snip){
            html += '<span class="sh-snippet">' + snip + '</span>';
        } else {
            var info = KNOWLEDGE && KNOWLEDGE[d.name];
            if(info && info.summary){
                html += '<span class="sh-summary">' + escapeHtml(info.summary) + '</span>';
            }
        }
        if(d.tags.length){
            html += '<span class="sh-tags">';
            d.tags.slice(0, 4).forEach(function(t){
                html += '<span class="sh-tag">' + escapeHtml(t) + '</span>';
            });
            html += '</span>';
        }
        html += '</a>';
    });
    if(hits.length > SEARCH_LIMIT){
        html += '<p class="search-more">' + STRF('searchMore', { n: hits.length - SEARCH_LIMIT }) + '</p>';
    }
    box.innerHTML = html + indexing;
    setSearchShown(true);
}

function showSearch(){
    var html =
        '<div class="search-screen">'
      +   '<svg class="search-ink" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">'
      +     '<defs>'
      +       '<radialGradient id="ink-pool" cx="50%" cy="50%" r="50%">'
      +         '<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.95"/>'
      +         '<stop offset="45%" stop-color="var(--accent)" stop-opacity="0.55"/>'
      +         '<stop offset="78%" stop-color="var(--accent)" stop-opacity="0.14"/>'
      +         '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>'
      +       '</radialGradient>'
      +       '<radialGradient id="ink-pool2" cx="50%" cy="50%" r="50%">'
      +         '<stop offset="0%" stop-color="var(--accent-ink)" stop-opacity="0.9"/>'
      +         '<stop offset="45%" stop-color="var(--accent-ink)" stop-opacity="0.5"/>'
      +         '<stop offset="78%" stop-color="var(--accent-ink)" stop-opacity="0.12"/>'
      +         '<stop offset="100%" stop-color="var(--accent-ink)" stop-opacity="0"/>'
      +       '</radialGradient>'
      // 수묵 번짐: 저주파 프랙탈 노이즈로 부드러운 가장자리를 물결처럼 밀어 한지에
      // 스민 먹처럼 만들고, 왜곡 뒤 살짝 번지게 해 잔점을 뭉갠다. 노이즈는 정적(seed
      // 고정)이라 브라우저가 텍스처를 캐시 — 콘텐츠(blob·자취)만 그 위로 움직인다.
      +       '<filter id="ink-bleed" x="-70%" y="-70%" width="240%" height="240%">'
      +         '<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="7" result="n"/>'
      +         '<feDisplacementMap in="SourceGraphic" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" result="d"/>'
      +         '<feGaussianBlur in="d" stdDeviation="0.6"/>'
      +       '</filter>'
      +     '</defs>'
      // 평소 배경 — 네 개의 먹 웅덩이(코너), 각기 느리게 떠다니며 숨쉰다.
      +     '<ellipse class="ink-blob ib1" fill="url(#ink-pool)" cx="18" cy="24" rx="18" ry="22" filter="url(#ink-bleed)"/>'
      +     '<ellipse class="ink-blob ib2" fill="url(#ink-pool2)" cx="84" cy="26" rx="13" ry="17" filter="url(#ink-bleed)"/>'
      +     '<ellipse class="ink-blob ib3" fill="url(#ink-pool)" cx="34" cy="78" rx="20" ry="26" filter="url(#ink-bleed)"/>'
      +     '<ellipse class="ink-blob ib4" fill="url(#ink-pool2)" cx="80" cy="74" rx="13" ry="17" filter="url(#ink-bleed)"/>'
      // 커서 자취 — startSearchInk()가 pointermove 때 이 그룹의 스탬프 풀을 재사용.
      +     '<g class="ink-trail"></g>'
      +   '</svg>'
      +   '<canvas class="search-game" aria-hidden="true"></canvas>'
      +   '<div class="search-core">'
      +     '<h2 class="search-head">' + STR('searchHead') + '</h2>'
      +     '<p class="search-sub">' + escapeHtml(STR('searchSubline')) + '</p>'
      +     '<div class="search-field">'
      +       '<input id="search-input" type="search" autocomplete="off"'
      +         ' placeholder="' + STR('searchPh') + '"'
      +         ' oninput="renderSearchResults(this.value)">'
      +       '<span class="search-ctrls">'
      +         '<button type="button" class="search-new" title="' + STR('newCollect') + '" aria-label="' + STR('newCollect') + '"'
      +           ' onpointerdown="event.stopPropagation()" onclick="location.hash=\'#!new\'">'
      +           'new<span class="plus" aria-hidden="true">+</span></button>'
      +         '<button type="button" class="search-go" title="' + STR('searchGoAria') + '" aria-label="' + STR('searchGoAria') + '"'
      +           ' onpointerdown="event.stopPropagation()"'
      +           ' onclick="var b=document.getElementById(\'search-input\'); renderSearchResults(b.value); b.focus();">&#128269;</button>'
      +       '</span>'
      +     '</div>'
      +     '<div id="search-results"></div>'
      +   '</div>'
      +   (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '' :
          '<div class="game-dock" role="group" aria-label="' + STR('dockAria') + '">'
        +   '<button type="button" data-g="concept" title="' + STR('gConceptLong') + '" aria-label="' + STR('gConcept') + '" onclick="switchSearchGame(this)">'
        +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        +       '<path d="M16.5 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>'
        +       '<line x1="4" y1="15" x2="9.5" y2="10.5"/><line x1="7" y1="19.5" x2="12" y2="15.5"/>'
        +     '</svg></button>'
        +   '<button type="button" data-g="g2048" title="' + STR('g2048Long') + '" aria-label="' + STR('g2048') + '" onclick="switchSearchGame(this)">'
        +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">'
        +       '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/>'
        +       '<rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
        +     '</svg></button>'
        +   '<button type="button" data-g="breakout" title="' + STR('gBreakout') + '" aria-label="' + STR('gBreakout') + '" onclick="switchSearchGame(this)">'
        +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">'
        +       '<line x1="4" y1="5" x2="9.5" y2="5"/><line x1="13" y1="5" x2="20" y2="5"/>'
        +       '<line x1="4" y1="9" x2="7.5" y2="9"/><line x1="11" y1="9" x2="16.5" y2="9"/>'
        +       '<circle cx="12" cy="14.5" r="1.4" fill="currentColor" stroke="none"/>'
        +       '<line x1="8" y1="20" x2="16" y2="20" stroke-width="2.4"/>'
        +     '</svg></button>'
        +   '<button type="button" data-g="pong" title="' + STR('gPong') + '" aria-label="' + STR('gPong') + '" onclick="switchSearchGame(this)">'
        +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">'
        +       '<line x1="4.5" y1="8" x2="4.5" y2="16"/><line x1="19.5" y1="8" x2="19.5" y2="16"/>'
        +       '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>'
        +     '</svg></button>'
        +   '<button type="button" data-g="plane" title="' + STR('gPlaneLong') + '" aria-label="' + STR('gPlane') + '" onclick="switchSearchGame(this)">'
        +     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        +       '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>'
        +     '</svg></button>'
        + '</div>')
      + '</div>';
    setArticle(html);
    ensureTextIndex();   // start fetching doc bodies in the background
    startSearchGame();   // ambient mini game behind the field
    startSearchInk();    // 수묵 커서 자취(호버 시 배경이 깨어남)
    enableSearchPaddle();   // drag the field left/right like a paddle
    // new+ 버튼: 새 글이 있을 때만 배경색(app.js의 anyNewDocs).
    var sn = document.querySelector('.search-new');
    if(sn && typeof anyNewDocs === 'function'){ sn.classList.toggle('has-new', anyNewDocs()); }
    var box = document.getElementById('search-input');
    if(box){
        box.focus();
        // A concept chip was clicked somewhere — run that search now.
        if(PENDING_QUERY){
            box.value = PENDING_QUERY;
            renderSearchResults(PENDING_QUERY);
            PENDING_QUERY = '';
        }
        // Results panel = the single "searching" state (board recedes).
        // Click outside the search area → dismiss the panel but KEEP the
        // typed query; focus the field again → restore it. (oninput keeps
        // rendering as you type.)
        var scr = document.querySelector('.search-screen');
        if(scr){
            scr.addEventListener('pointerdown', function(e){
                var r = document.getElementById('search-results');
                if(r && r.classList.contains('open') && !e.target.closest('.search-core')){
                    setSearchShown(false);   // dismiss; value + built results kept
                }
            });
        }
        box.addEventListener('focus', function(){
            var r = document.getElementById('search-results');
            if(box.value.trim() && r && !r.classList.contains('open')){
                renderSearchResults(box.value);   // restore on re-focus
            }
        });
    }
}

// ---- 수묵 커서 자취 (ink bleed trail) ----
// 마우스가 배경 위를 지날 때 먹이 배어 나와 한지에 스미듯 번지고 사라지는 자취.
// 미리 만든 스탬프(circle) 풀을 순환 재사용하고, 각 스탬프는 Web Animations API로
// "번져 나왔다 스며 사라짐"을 한 번 재생 — RAF 루프가 없어 컴포지터가 처리한다.
// 좌표는 SVG viewBox(0..100) 공간; 포인터를 그 공간으로 정규화해 스탬프를 놓는다.
// reduced-motion이거나 hover 불가(터치)면 자취를 걸지 않는다 — 평소 수묵 blob은 유지.
function startSearchInk(){
    var screen = document.querySelector('.search-screen');
    if(!screen){ return; }
    var svg = screen.querySelector('.search-ink');
    if(!svg){ return; }
    var mm = window.matchMedia;
    if(mm && mm('(prefers-reduced-motion: reduce)').matches){ return; }
    // 자취는 정밀 포인터(데스크톱) 전용 — 터치엔 hover가 없고 필터 비용만 크다.
    if(mm && !mm('(hover: hover) and (pointer: fine)').matches){ return; }

    var trail = svg.querySelector('.ink-trail');
    if(!trail){ return; }
    var NS = 'http://www.w3.org/2000/svg';
    var N = 22, pool = [], idx = 0;
    for(var i = 0; i < N; i++){
        var c = document.createElementNS(NS, 'circle');
        c.setAttribute('class', 'ink-stamp');
        // 넉넉한 base 반경 → 필터 영역이 커서 displacement가 잘리지 않는다(작으면 사각 아티팩트).
        c.setAttribute('r', '7');
        c.setAttribute('cx', '0');
        c.setAttribute('cy', '0');
        c.setAttribute('fill', 'url(#ink-pool)');
        c.setAttribute('filter', 'url(#ink-bleed)');
        trail.appendChild(c);
        pool.push(c);
    }
    if(!pool[0].animate){ return; }   // WAAPI 미지원 브라우저: 정적 수묵만 유지

    var lastX = null, lastY = null;
    screen.addEventListener('pointermove', function(e){
        var rect = svg.getBoundingClientRect();
        if(!rect.width || !rect.height){ return; }
        var sx = (e.clientX - rect.left) / rect.width * 100;
        var sy = (e.clientY - rect.top) / rect.height * 100;
        // 거리 임계값(≈3 단위) — 촘촘한 이벤트를 솎아 자취가 균질한 붓결이 되게.
        if(lastX !== null){
            var dx = sx - lastX, dy = sy - lastY;
            if(dx * dx + dy * dy < 5){ return; }   // ≈2.2 단위 — 촘촘한 붓결
        }
        lastX = sx; lastY = sy;
        var c = pool[idx = (idx + 1) % N];
        var seed = idx;
        var peak = 1.1 + (seed % 5) * 0.15;          // 최종 크기 변주(붓 자취의 불균질함)
        var dur = 1350 + (seed % 4) * 220;
        var op = 0.58 + (seed % 3) * 0.08;
        var pos = 'translate(' + sx.toFixed(2) + 'px,' + sy.toFixed(2) + 'px)';
        c.animate([
            { transform: pos + ' scale(0.28)', opacity: 0 },
            { opacity: op, offset: 0.22 },
            { transform: pos + ' scale(' + peak.toFixed(2) + ')', opacity: 0 }
        ], { duration: dur, easing: 'ease-out' });
    });
}
