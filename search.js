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
      +   '<div class="search-bg" aria-hidden="true">'
      +     '<span class="blob b1"></span><span class="blob b2"></span>'
      +     '<span class="blob b3"></span><span class="blob b4"></span>'
      +   '</div>'
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
