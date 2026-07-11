// app.js — 앱 코어: 전역 인덱스·내비 트리·문서 렌더 체인·About FX·지식지도 hydrate·
// 태그/폴더 화면·최근문서·설정(effSettings)·라우터·부트스트랩.
// index.html에서 추출 (동작 불변 이동). 부트 코드가 즉시 실행되므로
// 모든 모듈 뒤, body 끝에서 로드되어야 한다 (music은 그 다음).
// ---- Global indexes (built once the list loads) ----
var DOCS = [];         // real docs: {name, label, section, tags:[]}
var TAG_INDEX = {};    // tag -> [doc, ...]
var DOC_BY_NAME = {};  // name -> doc
var FOLDER_DOCS = {};  // section (parent-folder path) -> [doc, ...] in tree order
// Authoring-model badge. Per-doc truth lives in the list node's
// "model" field — set it from the AUTHORING SESSION's model when a
// doc is added or substantially rewritten. This constant is only
// the fallback for docs that predate the rule.
var DOC_MODEL = 'Claude Fable 5';

function buildIndexes(tree){
    // `path` is canonical (node.title, Korean) — it keys FOLDER_DOCS and
    // the 'Work Log' prefix checks. `dpath` is the localized twin, kept
    // only for display (doc.sectionL).
    (function walk(nodes, path, dpath){
        nodes.forEach(function(node){
            if(node.children && node.children.length){
                walk(node.children,
                     node.title ? path.concat(node.title) : path,
                     node.title ? dpath.concat(labelFor(node) || node.title) : dpath);
            } else if(node.name && !node.route){
                var doc = {
                    name: node.name,
                    // list 노드의 "path" = docs/<lang>/ 아래 물리 위치.
                    // 없으면 flat 레거시(파일명 = name)로 폴백.
                    path: node.path || node.name,
                    label: labelFor(node) || node.name,
                    section: path.join(' · '),
                    sectionL: dpath.join(' · '),
                    tags: tagsFor(node),
                    model: node.model || '',   // optional per-doc override
                    nonum: !!node.nonum   // meta/nav page (지식지도 등) — 최근 문서에서 제외
                };
                DOCS.push(doc);
                DOC_BY_NAME[doc.name] = doc;
                // Group by immediate parent folder, in tree order. Kept
                // separate from DOCS so the later date-sort of DOCS
                // doesn't reorder a folder's own reading sequence.
                (FOLDER_DOCS[doc.section] = FOLDER_DOCS[doc.section] || []).push(doc);
                doc.tags.forEach(function(t){
                    (TAG_INDEX[t] = TAG_INDEX[t] || []).push(doc);
                });
            }
        });
    })(tree, [], []);
}

// ---- Navigation tree ----
// A folder with 2+ docs gets a digest icon that shows its docs on one
// page. Knowledge folders keep the original semantics (direct docs only —
// "read this folder in order"); Work Log folders collect DESCENDANTS too,
// so 일(day)뿐 아니라 월/연/최상위에서도 그 기간의 로그를 몰아 읽는다
// (저장은 주제별 파일 유지, 누적 읽기는 뷰로 제공). The icon rides inside
// the title button as a flex child (stopPropagation keeps it from
// toggling the branch). `path` mirrors buildIndexes so the folder's
// section key matches FOLDER_DOCS.
// FOLDER_DOCS 키는 buildIndexes의 DFS 삽입 순서라, 접두어 매칭으로 모으면
// 트리 순서(=Work Log에선 날짜순) 그대로 나온다.
function folderDocsDeep(section){
    var out = [];
    Object.keys(FOLDER_DOCS).forEach(function(k){
        if(k === section || k.indexOf(section + ' · ') === 0){
            out = out.concat(FOLDER_DOCS[k]);
        }
    });
    return out;
}
function folderDigestSpan(sectionKey){
    var docs = sectionKey.indexOf('Work Log') === 0
             ? folderDocsDeep(sectionKey) : FOLDER_DOCS[sectionKey];
    if(!docs || docs.length < 2){ return ''; }
    return '<span class="folder-digest" role="button" tabindex="0"'
         + ' title="' + STR('digestTitle') + '" aria-label="' + STR('digestTitle') + '"'
         + ' data-section="' + escapeHtml(sectionKey) + '"'
         + ' onclick="openFolderDigest(event, this)"'
         + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openFolderDigest(event,this);}">&#10697;</span>';
}
function openFolderDigest(ev, el){
    ev.stopPropagation();   // don't toggle the branch
    location.hash = '#!folder:' + encodeURIComponent(el.getAttribute('data-section'));
}
// ⤓ on the Work Log title — jumps to the newest log: collapses every
// other date, expands only the most recent day, then opens it.
function worklogJumpSpan(){
    return '<span class="nav-jump" role="button" tabindex="0"'
         + ' title="' + STR('worklogRecent') + '" aria-label="' + STR('worklogRecent') + '"'
         + ' onclick="jumpRecentWorklog(event)"'
         + ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();jumpRecentWorklog(event);}">&#10515;</span>';
}
function renderNodes(nodes, path){
    path = path || [];
    var html = '<ul>';
    var docSeq = 0;   // numbers the docs within this branch, per folder
    nodes.forEach(function(node){
        var label = labelFor(node) || node.title || node.name;
        if(node.children){    // a branch, collapsed by default
            var childPath = node.title ? path.concat(node.title) : path;
            // Tag top-level categories so Settings can show/hide them.
            var catAttr = (path.length === 0 && node.title)
                        ? ' data-cat="' + escapeHtml(node.title) + '"' : '';
            // Display-only glyph (e.g. ✎ on Work Log) — the section
            // path keeps using the bare title, so routing/worklog
            // detection are untouched. With iconOpen the glyph also
            // mirrors the branch state (CSS shows one of the pair
            // from the li's collapsed class).
            var deco = '';
            if(node.icon){
                deco = '<span class="nav-ico">'
                     +   '<span class="ico-c">' + escapeHtml(node.icon) + '</span>'
                     +   '<span class="ico-o">' + escapeHtml(node.iconOpen || node.icon) + '</span>'
                     + '</span>';
            }
            var jumpSpan = (path.length === 0 && node.title === 'Work Log')
                         ? worklogJumpSpan() : '';
            // 최상위 대분류(AI·Douzone·Work Log 등, path.length===0)는 기본 펼침.
            // 그 하위(중첩) 브랜치는 종전처럼 collapsed로 시작.
            var branchCls = (path.length === 0) ? 'nav-branch' : 'nav-branch collapsed';
            html += '<li class="' + branchCls + '"' + catAttr + '>'
                 +  '<button type="button" class="nav-title" onclick="toggleBranch(this)">'
                 +  '<span class="nav-caret">&#9662;</span>'
                 +  '<span class="nav-title-text">' + deco + escapeHtml(label) + '</span>'
                 +  '<span class="nav-newbadge" hidden></span>'
                 +  folderDigestSpan(childPath.join(' · '))
                 +  jumpSpan
                 +  '</button>';
            html += renderNodes(node.children, childPath);
            html += '</li>';
        } else {
            var target = node.route ? node.route : node.name;
            var numHtml;
            if(node.mark){
                // A marked doc (e.g. a guide) shows a symbol, not a
                // sequence number, and doesn't consume the count.
                numHtml = '<span class="doc-num doc-mark">' + escapeHtml(node.mark) + '</span>';
            } else if(node.nonum){
                // A top-level standalone doc (e.g. 지식 지도) carries no
                // number and doesn't consume the count.
                numHtml = '';
            } else {
                docSeq++;
                var num = (docSeq < 10 ? '0' : '') + docSeq;
                numHtml = '<span class="doc-num">' + num + '.</span>';
            }
            html += '<li><a href="#!' + target + '">'
                 +  (numHtml ? numHtml + ' ' : '') + escapeHtml(label) + '</a></li>';
        }
    });
    html += '</ul>';
    return html;
}

// ---- Tag chip (no icon; used for the tags listed under a doc) ----
function tagChip(tag){
    return '<a class="tag" href="#!tag:' + encodeURIComponent(tag) + '">'
         + escapeHtml(tag) + '</a>';
}

// ---- Dictionary-index entry: term, dot leader, usage count ----
function tagIndexEntry(tag, count, rank){
    var cls = 'idx-entry' + (rank ? ' top-' + rank : '');
    return '<a class="' + cls + '" href="#!tag:' + encodeURIComponent(tag) + '">'
         + '<span class="idx-term">' + escapeHtml(tag) + '</span>'
         + '<span class="idx-dots"></span>'
         + '<span class="idx-count">' + count + '</span>'
         + '</a>';
}

// The ten most-used tags, each given a distinct rank 1..10 so the
// index can grade its emphasis by rank. Sorted by usage count, with
// ties broken by name so the ordering is stable and reproducible.
function topTagRanks(){
    var arr = Object.keys(TAG_INDEX).map(function(t){
        return { tag: t, n: TAG_INDEX[t].length };
    });
    arr.sort(function(a, b){
        if(b.n !== a.n){ return b.n - a.n; }
        return a.tag.toLowerCase().localeCompare(b.tag.toLowerCase(), 'ko');
    });
    var ranks = {};
    for(var i = 0; i < arr.length && i < 10; i++){
        ranks[arr[i].tag] = i + 1;
    }
    return ranks;
}

// ---- Article helpers ----
// 표 반응형 자동 보정: .tbl-wrap(overflow-x:auto) 없이 들어온 맨 <table>을
// 렌더 시 감싼다. 모바일은 body가 overflow-x:clip이라 래퍼 없는 표가
// 스크롤 불가로 잘리므로, 작성 누락이 있어도 여기서 구조적으로 막는다.
function wrapBareTables(container){
    if(!container){ return; }
    container.querySelectorAll('table').forEach(function(tb){
        if(tb.parentElement && tb.parentElement.classList.contains('tbl-wrap')){ return; }
        var wrap = document.createElement('div');
        wrap.className = 'tbl-wrap';
        tb.parentNode.insertBefore(wrap, tb);
        wrap.appendChild(tb);
    });
}
function setArticle(html){
    var art = document.querySelector('article');
    art.innerHTML = html;
    wrapBareTables(art);
    // Clear per-doc extras left over from the previous doc — the
    // authoring-model badge and the AI related-docs block both live on
    // the #article wrapper (outside <article>), so replacing the body
    // alone would leave them showing the PREVIOUS doc's content.
    document.querySelectorAll('#article .doc-model, #article .related')
        .forEach(function(el){ el.remove(); });
    // Only the content pane resets; the sidebar and masthead stay put.
    var scroller = document.getElementById('content-scroll');
    if(scroller){ scroller.scrollTop = 0; }
    window.scrollTo(0, 0);   // mobile still scrolls the page itself
    // Re-trigger the gentle fade-up animation on each navigation.
    art.classList.remove('fade-in');
    void art.offsetWidth;   // force reflow so the animation restarts
    art.classList.add('fade-in');
    initCarousels(art);
    initAboutFx(art);
}

// Carousels arrive via innerHTML, so their wiring lives here.
function initCarousels(root){
    root.querySelectorAll('.carousel').forEach(function(car){
        var scns = Array.prototype.slice.call(car.querySelectorAll('.scn'));
        var dots = Array.prototype.slice.call(car.querySelectorAll('.carousel-dots button'));
        var stage = car.querySelector('.carousel-stage');
        var label = car.querySelector('.carousel-nav .cn-label');
        var prev = car.querySelector('.carousel-nav .prev');
        var next = car.querySelector('.carousel-nav .next');
        if(!scns.length){ return; }
        var idx = 0;
        function show(i){
            idx = (i + scns.length) % scns.length;
            scns.forEach(function(s, k){ s.classList.toggle('active', k === idx); });
            dots.forEach(function(d, k){ d.classList.toggle('active', k === idx); });
            if(label){ label.textContent = (idx + 1) + ' / ' + scns.length; }
            if(stage){ stage.scrollTop = 0; }   // each panel starts at its top
        }
        dots.forEach(function(d, k){
            d.addEventListener('click', function(){ show(k); });
        });
        if(prev){ prev.addEventListener('click', function(){ show(idx - 1); }); }
        if(next){ next.addEventListener('click', function(){ show(idx + 1); }); }
        show(0);
    });
}

// ---- About page effects: particle canvas + scroll reveal ----
// The about fragment (docs/<lang>/about, opened from the profile
// photo) arrives via innerHTML, so its wiring lives here. Handles are
// kept so each navigation tears the previous page down. Language is
// the site-wide setting — the fragment itself is single-language.
var ABOUT_FX = { raf: 0, cleanups: [] };

function destroyAboutFx(){
    if(ABOUT_FX.raf){ cancelAnimationFrame(ABOUT_FX.raf); ABOUT_FX.raf = 0; }
    ABOUT_FX.cleanups.forEach(function(fn){ fn(); });
    ABOUT_FX.cleanups = [];
}

function initAboutFx(root){
    destroyAboutFx();
    var page = root.querySelector('.about-page');
    if(!page){ return; }
    initAboutReveal(page);
    initAboutCanvas(page);
}

function initAboutReveal(page){
    var els = page.querySelectorAll('.about-reveal');
    if(!('IntersectionObserver' in window)){
        els.forEach(function(el){ el.classList.add('visible'); });
        return;
    }
    var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
            if(en.isIntersecting){
                en.target.classList.add('visible');
                io.unobserve(en.target);
            }
        });
    }, { threshold: 0.12 });
    els.forEach(function(el){ io.observe(el); });
    ABOUT_FX.cleanups.push(function(){ io.disconnect(); });
}

function initAboutCanvas(page){
    var canvas = page.querySelector('.about-canvas');
    if(!canvas || !canvas.getContext){ return; }
    var ctx = canvas.getContext('2d');
    var reduced = window.matchMedia
               && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Colors follow the theme tokens so day/night both look right —
    // re-read on body class/style changes (theme toggle, accent pick).
    var colors;
    function readColors(){
        var cs = getComputedStyle(document.body);
        colors = {
            dot: cs.getPropertyValue('--accent').trim() || '#4db6ac',
            line: cs.getPropertyValue('--muted').trim() || '#9aa4b2'
        };
    }
    readColors();
    var themeWatch = new MutationObserver(readColors);
    themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    ABOUT_FX.cleanups.push(function(){ themeWatch.disconnect(); });

    var parts = [], mouse = { x: -9999, y: -9999 };

    function resize(){
        canvas.width = page.clientWidth;
        canvas.height = page.clientHeight;
        var want = Math.min(110, Math.round(canvas.width * canvas.height / 22000));
        while(parts.length < want){
            // Base drift never decays (perpetual ambient motion);
            // the mouse only adds a temporary impulse on top.
            parts.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                bvx: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.28),
                bvy: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.28),
                ivx: 0,
                ivy: 0,
                r: 1.2 + Math.random() * 1.6
            });
        }
        parts.length = want;
    }
    resize();
    window.addEventListener('resize', resize);
    ABOUT_FX.cleanups.push(function(){ window.removeEventListener('resize', resize); });

    function onMove(e){
        var box = canvas.getBoundingClientRect();
        mouse.x = e.clientX - box.left;
        mouse.y = e.clientY - box.top;
    }
    function onLeave(){ mouse.x = -9999; mouse.y = -9999; }

    var LINK = 130, MOUSE_LINK = 150;

    function draw(){
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var i, j, p, q, dx, dy, d;
        for(i = 0; i < parts.length; i++){
            p = parts[i];
            // Gentle pull toward a nearby cursor makes it feel alive.
            dx = mouse.x - p.x; dy = mouse.y - p.y;
            d = Math.sqrt(dx * dx + dy * dy);
            if(d < MOUSE_LINK && d > 1){
                p.ivx += dx / d * 0.018;
                p.ivy += dy / d * 0.018;
            }
            // Only the mouse impulse decays — the base drift keeps the
            // whole field in continuous motion across the full page.
            p.ivx *= 0.94; p.ivy *= 0.94;
            p.x += p.bvx + p.ivx;
            p.y += p.bvy + p.ivy;
            if(p.x < 0 || p.x > canvas.width){ p.bvx *= -1; p.ivx *= -1; }
            if(p.y < 0 || p.y > canvas.height){ p.bvy *= -1; p.ivy *= -1; }
            p.x = Math.max(0, Math.min(canvas.width, p.x));
            p.y = Math.max(0, Math.min(canvas.height, p.y));
        }
        ctx.strokeStyle = colors.line;
        for(i = 0; i < parts.length; i++){
            p = parts[i];
            for(j = i + 1; j < parts.length; j++){
                q = parts[j];
                dx = p.x - q.x; dy = p.y - q.y;
                if(dx > LINK || dx < -LINK || dy > LINK || dy < -LINK){ continue; }
                d = Math.sqrt(dx * dx + dy * dy);
                if(d > LINK){ continue; }
                ctx.globalAlpha = (1 - d / LINK) * 0.28;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
                ctx.stroke();
            }
            dx = p.x - mouse.x; dy = p.y - mouse.y;
            d = Math.sqrt(dx * dx + dy * dy);
            if(d < MOUSE_LINK){
                ctx.globalAlpha = (1 - d / MOUSE_LINK) * 0.4;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(mouse.x, mouse.y);
                ctx.stroke();
            }
        }
        ctx.fillStyle = colors.dot;
        for(i = 0; i < parts.length; i++){
            p = parts[i];
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    if(reduced){
        draw();   // a single still frame; no motion, no listeners
        return;
    }
    page.addEventListener('mousemove', onMove);
    page.addEventListener('mouseleave', onLeave);
    ABOUT_FX.cleanups.push(function(){
        page.removeEventListener('mousemove', onMove);
        page.removeEventListener('mouseleave', onLeave);
    });
    (function loop(){
        draw();
        ABOUT_FX.raf = requestAnimationFrame(loop);
    })();
}

function renderDocTags(tags){
    var html = '<div class="doc-tags"><span class="doc-tags-label">Tags</span>';
    tags.forEach(function(t){ html += tagChip(t); });
    html += '</div>';
    return html;
}


// Which docs show their *updated* date instead of the created date:
// living meta pages whose value is freshness, not authorship moment.
var UPDATED_DATE_DOCS = { 'ai-map': 1, 'dz-map': 1, 'wl-backlog': 1, 'wl-guide': 1 };

// 제목(첫 h2) 바로 밑에 이 문서의 폴더 경로(브레드크럼)를 단다 — 새 글·최근·
// 연관 문서로 진입했을 때 "어느 폴더에 속한 문서인지" 위치를 보여준다. 맨 끝
// (가장 깊은) 폴더만 그 폴더 모아보기(#!folder:)로 링크하고, 상위 세그먼트는
// 텍스트로만 둔다(중간 폴더는 직속 문서가 없어 다이제스트가 빌 수 있음).
// doc.sectionL=현지화(표시)·doc.section=canonical(라우팅) — walk에서 병렬
// 생성이라 세그먼트 수가 같다. 미등록(About)·최상위(경로 없음) 문서는 스킵.
function injectBreadcrumb(name){
    var doc = DOC_BY_NAME[name];
    if(!doc || !doc.sectionL){ return; }
    var art = document.getElementById('article');
    var h2 = art && art.querySelector('h2');
    if(!art || !h2 || art.querySelector('.doc-crumb')){ return; }
    var disp = doc.sectionL.split(' · ');
    var last = disp.length - 1;
    var html = '';
    disp.forEach(function(seg, i){
        if(i){ html += '<span class="doc-crumb-sep"> · </span>'; }
        if(i === last){
            html += '<a href="#!folder:' + encodeURIComponent(doc.section) + '"'
                 +  ' title="' + STR('digestTitle') + '">' + escapeHtml(seg) + '</a>';
        } else {
            html += '<span>' + escapeHtml(seg) + '</span>';
        }
    });
    var nav = document.createElement('nav');
    nav.className = 'doc-crumb';
    nav.innerHTML = html;
    h2.insertAdjacentElement('afterend', nav);
}

// 제목(첫 h2) 바로 밑에 생성/수정일자를 작은 우측 정렬 텍스트로 단다.
// 날짜 데이터는 git 이력에서 빌드 타임에 생성 (tools/build_dates.py).
function injectDocDate(name){
    App.data.loadDates().then(function(dd){
        if(CURRENT_DOC !== name){ return; }   // 라우트가 이미 바뀐 늦은 응답
        var rec = (dd.docs || {})[name];
        if(!rec){ return; }
        var useUpdated = UPDATED_DATE_DOCS[name] === 1;
        var text = formatDocDate(useUpdated ? rec.u : rec.c);
        if(!text){ return; }
        var art = document.getElementById('article');
        var h2 = art && art.querySelector('h2');
        if(!art || art.querySelector('.doc-date')){ return; }
        var p = document.createElement('p');
        p.className = 'doc-date';
        p.textContent = STR(useUpdated ? 'dateUpdated' : 'dateCreated') + ' ' + text;
        // 메타 라인(.doc-meta)이 있으면 그 오른쪽(모델 브랜드 옆)에, 없으면
        // crumb/제목 뒤에 폴백(About 등 미등록 문서).
        var meta = art.querySelector('.doc-meta');
        var crumb = art.querySelector('.doc-crumb');
        if(meta){ meta.appendChild(p); }
        else if(crumb){ crumb.insertAdjacentElement('afterend', p); }
        else if(h2){ h2.insertAdjacentElement('afterend', p); }
        else { art.insertAdjacentElement('afterbegin', p); }
    });
}

function fetchPage(filename){
    fetchDoc(filename).then(function(text){
            var doc = DOC_BY_NAME[filename];
            if(doc && doc.tags.length){
                text += renderDocTags(doc.tags);
            }
            setArticle(text);
            var art = document.getElementById('article');
            CURRENT_DOC = filename;
            // 제목 아래 폴더 경로(브레드크럼) 먼저 — 메타 라인이 그 뒤에 붙는다.
            injectBreadcrumb(filename);
            // 저작 모델 배지 — 예전엔 우상단 절대배치였으나, 모바일 제목 폭을
            // 확보하려 생성일자와 같은 라인(.doc-meta)의 왼쪽으로 옮겼다. 등재된
            // 지식 문서만 표시(About 등 미등재 특수 페이지는 모델 표기 없음).
            // Work Log는 사람/AI가 함께 큐레이트하는 데브 저널이라 저작-모델 배지를
            // 달지 않는다(list 노드에 model 없음 → DOC_MODEL 폴백으로 오표기되던 것 차단).
            var isWorklog = doc && doc.section && doc.section.indexOf('Work Log') === 0;
            var label = (doc && !isWorklog) ? (doc.model || DOC_MODEL) : '';
            if(art && label){
                var meta = document.createElement('div');
                meta.className = 'doc-meta';
                var span = document.createElement('span');
                span.className = 'doc-model';
                span.textContent = label;
                meta.appendChild(span);
                var anchor = art.querySelector('.doc-crumb') || art.querySelector('h2');
                if(anchor){ anchor.insertAdjacentElement('afterend', meta); }
                else { art.insertAdjacentElement('afterbegin', meta); }
            }
            // AI 연관 문서 추천 (knowledge-index.json). May arrive after
            // this render, so injectRelated re-runs when the index loads.
            injectDocDate(filename);
            injectRelated();
            hydrateAiMap();
    })
}

// ---- AI knowledge index (structural embedding) ----
var KNOWLEDGE = null;        // name -> {summary, concepts, related:[...]}
var KNOWLEDGE_STATS = null;  // aggregated stats from the same index
var CURRENT_DOC = null;      // the doc currently in the content pane, or null
// Jump to unified search pre-filled with a concept — the "click a
// concept anywhere, search by meaning" pivot. showSearch consumes it.
var PENDING_QUERY = '';
function searchConcept(el){
    PENDING_QUERY = el.getAttribute('data-c') || '';
    if(location.hash === '#!search'){
        var box = document.getElementById('search-input');
        if(box){ box.value = PENDING_QUERY; box.focus(); renderSearchResults(PENDING_QUERY); }
        PENDING_QUERY = '';
        return;
    }
    location.hash = '#!search';
}
function conceptBtn(c){
    return '<button type="button" class="rel-c" data-c="' + escapeHtml(c)
         + '" onclick="searchConcept(this)">' + escapeHtml(c) + '</button>';
}
function renderRelatedHTML(rel){
    var items = rel.map(function(r){
        var why = (r.shared && r.shared.length)
                ? r.shared.map(conceptBtn).join('')
                : '<span class="rel-why-plain">' + STR('relFolder') + '</span>';
        return '<li><a href="#!' + encodeURIComponent(r.name) + '">'
             + escapeHtml(r.title) + '</a>'
             + '<span class="rel-why">' + why + '</span></li>';
    }).join('');
    return '<nav class="related" aria-label="' + STR('related') + '">'
         + '<h3 class="related-title">' + STR('related') + '</h3>'
         + '<ul class="related-list">' + items + '</ul></nav>';
}
function injectRelated(){
    if(!KNOWLEDGE || !CURRENT_DOC){ return; }
    var art = document.getElementById('article');
    if(!art || art.querySelector('.related')){ return; }
    var info = KNOWLEDGE[CURRENT_DOC];
    if(!info || !info.related || !info.related.length){ return; }
    var wrap = document.createElement('div');
    wrap.innerHTML = renderRelatedHTML(info.related);
    var node = wrap.firstChild;
    // 본문 맨 끝(태그 다음)에 붙인다. 예전엔 우상단 모델 배지가 article의
    // 마지막 직속 자식이라 그 앞에 끼웠지만, 배지가 상단 .doc-meta로 옮겨간
    // 뒤로는 단순 append가 맞다.
    art.appendChild(node);
}

// ---- 지식 지도 라이브 집계 ----
// The 지식 지도 page carries static fallback numbers; when the index is
// loaded we overwrite them with live aggregation so the map can never
// drift from knowledge-index.json. Runs on both orders (doc first /
// index first) — whichever completes last does the hydration.
function docLink(name, title){
    return '<a href="#!' + encodeURIComponent(name) + '">' + escapeHtml(title) + '</a>';
}
function hydrateAiMap(){
    var s = KNOWLEDGE_STATS;
    // Knowledge-map pages: each galaxy map (ai-map, dz-map, …)
    // shares the same live-rendered blocks.
    if(!s || ['ai-map', 'dz-map'].indexOf(CURRENT_DOC) === -1){ return; }
    var el = document.getElementById('km-clusters');
    // A per-galaxy map (data-section-prefix) hydrates EVERY block —
    // clusters, hubs, bridges, top concepts, totals — from its own
    // galaxy's stats, so one map never leaks another galaxy's data.
    var pref = el ? (el.getAttribute('data-section-prefix') || '') : '';
    if(pref && s.galaxies && s.galaxies[pref]){ s = s.galaxies[pref]; }
    if(el){
        var topics = {};
        try{ topics = JSON.parse(el.getAttribute('data-topics')) || {}; }catch(e){}
        var rows = pref
            ? s.clusters.filter(function(c){ return c.section.indexOf(pref) === 0; })
            : s.clusters;
        el.innerHTML = rows.map(function(c){
            return '<tr><td><strong>' + escapeHtml(c.label) + '</strong></td>'
                 + '<td>' + c.count + '</td>'
                 + '<td>' + escapeHtml(topics[c.label] || '') + '</td>'
                 + '<td>' + docLink(c.hub.name, c.hub.title) + '</td></tr>';
        }).join('');
    }
    el = document.getElementById('km-hubs');
    if(el){
        // Group hubs by reference count, one line per count.
        var byRefs = {};
        s.hubs.forEach(function(h){ (byRefs[h.refs] = byRefs[h.refs] || []).push(h); });
        el.innerHTML = Object.keys(byRefs).sort(function(a, b){ return b - a; })
            .map(function(n){
                var links = byRefs[n].map(function(h){ return docLink(h.name, h.title); }).join(' · ');
                var label = byRefs[n].length > 1 ? STRF('kmEach', { n: n }) : STRF('kmRefs', { n: n });
                return '<li>' + links + ' <span class="scn-sub">· ' + label + '</span></li>';
            }).join('');
    }
    el = document.getElementById('km-bridges');
    if(el){
        el.innerHTML = s.bridges.map(function(b){
            return '<tr><td><strong>' + escapeHtml(b.c) + '</strong></td>'
                 + '<td>' + STRF('kmBridgeN', { n: b.clusters.length }) + b.clusters.map(escapeHtml).join(' · ') + '</td>'
                 + '<td>' + STRF('kmDocsN', { n: b.n }) + '</td></tr>';
        }).join('');
    }
    el = document.getElementById('km-top');
    if(el){
        el.innerHTML = s.topConcepts.filter(function(t){ return t.n >= 5; })
            .map(function(t){ return conceptBtn(t.c) + ' <span class="km-n">' + t.n + '</span>'; })
            .join(' ');
    }
    el = document.getElementById('km-totals');
    if(el){
        el.textContent = STRF('kmTotals', { d: s.docCount, c: s.conceptCount });
    }
}


// ---- Tag index (all tags) with instant search ----
function showTagIndex(){
    var html = '<h2>Tags</h2>'
             + '<input id="tag-search" type="search" placeholder="Search tags..."'
             + ' oninput="filterTags(this.value)" autocomplete="off">'
             + '<div id="tag-top"></div>'
             + '<div id="tag-cloud"></div>';
    setArticle(html);
    renderTopTags();
    filterTags('');
    var box = document.getElementById('tag-search');
    if(box){ box.focus(); }
}

// Highlighted band of the most-used tags, ordered by the top-10
// ranking and showing only the tag words. Top-3 keep medal colors.
function renderTopTags(){
    var ranks = topTagRanks();
    var ranked = Object.keys(ranks);
    var el = document.getElementById('tag-top');
    if(!el){ return; }
    if(!ranked.length){ el.innerHTML = ''; return; }
    ranked.sort(function(a, b){ return ranks[a] - ranks[b]; });
    var html = '<h3 class="idx-top-title">' + STR('tagsTop') + '</h3>'
             + '<ol class="idx-top-list">';
    ranked.forEach(function(t){
        html += '<li><a class="idx-top-item top-' + ranks[t] + '"'
             +  ' href="#!tag:' + encodeURIComponent(t) + '">'
             +  escapeHtml(t)
             +  '</a></li>';
    });
    html += '</ol>';
    el.innerHTML = html;
}

// Initial-letter buckets for the index. English tags group under
// A-Z; Korean tags group under their leading consonant (초성), with
// the doubled consonants folded onto their base (ㄲ→ㄱ, ㅃ→ㅂ, ...).
var HANGUL_CHO = ['ㄱ','ㄱ','ㄴ','ㄷ','ㄷ','ㄹ','ㅁ','ㅂ','ㅂ','ㅅ',
                  'ㅅ','ㅇ','ㅈ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
var CHO_ORDER = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ',
                 'ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
function tagInitial(tag){
    var ch = tag.charAt(0);
    var code = ch.charCodeAt(0);
    if(code >= 0xAC00 && code <= 0xD7A3){   // a composed Hangul syllable
        return HANGUL_CHO[Math.floor((code - 0xAC00) / 588)];
    }
    var up = ch.toUpperCase();
    return (up >= 'A' && up <= 'Z') ? up : '#';
}
// Order buckets as A-Z first, then the Korean consonants, then '#'.
function initialRank(k){
    if(k >= 'A' && k <= 'Z'){ return [0, k.charCodeAt(0)]; }
    var ci = CHO_ORDER.indexOf(k);
    return ci >= 0 ? [1, ci] : [2, 0];
}

// Group the (optionally filtered) tags by initial and lay them out
// like the index at the back of a dictionary. The top-10 usage ranks
// still drive the emphasis on each entry.
function filterTags(query){
    var q = query.trim().toLowerCase();
    var tags = Object.keys(TAG_INDEX).sort(function(a, b){
        return a.toLowerCase().localeCompare(b.toLowerCase(), 'ko');
    });
    var ranks = topTagRanks();
    var groups = {}, letters = [];
    tags.forEach(function(t){
        if(q && t.toLowerCase().indexOf(q) === -1){ return; }
        var k = tagInitial(t);
        if(!groups[k]){ groups[k] = []; letters.push(k); }
        groups[k].push(t);
    });
    letters.sort(function(a, b){
        var ra = initialRank(a), rb = initialRank(b);
        return ra[0] - rb[0] || ra[1] - rb[1];
    });
    var html = '';
    letters.forEach(function(k){
        html += '<section class="idx-group">'
             +  '<h3 class="idx-letter">' + escapeHtml(k) + '</h3>'
             +  '<div class="idx-list">';
        groups[k].forEach(function(t){
            html += tagIndexEntry(t, TAG_INDEX[t].length, ranks[t]);
        });
        html += '</div></section>';
    });
    if(!html){ html = '<p class="empty">No matching tags.</p>'; }
    var cloud = document.getElementById('tag-cloud');
    if(cloud){ cloud.innerHTML = html; }
    // The "most used" band belongs to the full index, not a search.
    var top = document.getElementById('tag-top');
    if(top){ top.style.display = q ? 'none' : ''; }
}

// ---- Docs for a single tag ----
function showTag(tag){
    var docs = TAG_INDEX[tag] || [];
    // 결과가 하나뿐이면 목록을 건너뛰고 바로 그 문서로. location.replace로
    // 현재 #!tag: 항목을 교체 → 문서에서 뒤로가기 시 태그로 되돌아왔다가
    // 다시 문서로 튕기는 루프 방지.
    if(docs.length === 1){ location.replace('#!' + docs[0].name); return; }
    var html = '<h2>' + escapeHtml(tag) + '</h2>'
             + '<p class="tag-back"><a href="#!tags">&larr; All tags</a></p>'
             + '<ul class="more-list">';
    docs.forEach(function(d){
        html += '<li><a href="#!' + d.name + '">'
             +  '<span class="more-name">' + escapeHtml(d.label) + '</span>'
             +  '<span class="more-meta">' + escapeHtml(d.sectionL) + '</span></a></li>';
    });
    html += '</ul>';
    setArticle(html);
}

// ---- "새 글 모아보기" (#!new) — 최근 newDays일 내 생성 문서 ----
// 생성일 내림차순. showTag과 같은 .more-list 마크업을 재사용.
// #!new 게시판: 판정 창(새 글)만이 아니라 최근순 전체를 7개씩 페이지네이션
// (본문 하단 "최근 문서" 보드와 같은 형태 + 처음/끝 이동). Work Log·메타 제외.
function newPageCount(){
    return Math.max(1, Math.ceil(recentDocs().length / NEW_PAGE_SIZE));
}
function renderNewBoard(){
    var docs = recentDocs();
    var pages = newPageCount();
    newPage = Math.max(0, Math.min(newPage, pages - 1));
    var html = '<h2>' + STR('newPageHead') + '</h2>';
    if(!docs.length){
        setArticle(html + '<p class="empty">' + STR('newEmpty') + '</p>');
        return;
    }
    var start = newPage * NEW_PAGE_SIZE;
    html += '<ul class="more-list">';
    docs.slice(start, start + NEW_PAGE_SIZE).forEach(function(d){
        var cd = formatDocDate((d.date || '').slice(0, 10));
        var meta = d.sectionL + (cd ? ' · ' + cd : '');
        html += '<li><a href="#!' + d.name + '">'
             +  '<span class="more-name">' + escapeHtml(d.label) + '</span>'
             +  '<span class="more-meta">' + escapeHtml(meta) + '</span></a></li>';
    });
    html += '</ul>' + boardPager(newPage, pages, 'new');
    setArticle(html);
}
// route/진입은 첫 페이지부터. 페이저는 renderNewBoard만 다시 그린다(리셋 없음).
function showNew(){ newPage = 0; renderNewBoard(); }
function newGoto(page){
    newPage = Math.max(0, Math.min(page, newPageCount() - 1));
    renderNewBoard();
    var sc = document.getElementById('content-scroll');
    if(sc){ sc.scrollTop = 0; }
}
function newBlock(dir){
    var maxBlock = Math.floor((newPageCount() - 1) / MORE_BLOCK);
    var block = Math.max(0, Math.min(Math.floor(newPage / MORE_BLOCK) + dir, maxBlock));
    newPage = block * MORE_BLOCK;
    renderNewBoard();
    var sc = document.getElementById('content-scroll');
    if(sc){ sc.scrollTop = 0; }
}

// ---- Folder digest: every direct doc of a folder on one page ----
// Fetches the folder's docs in reading order and concatenates their
// bodies, with a jump-to table of contents. No tags / model badge.
function showFolder(section){
    // Work Log 폴더는 하위(일 폴더)까지 딥 수집 — 월/연 누적 읽기 뷰.
    var docs = (section.indexOf('Work Log') === 0
              ? folderDocsDeep(section) : FOLDER_DOCS[section]) || [];
    var parts = section.split(' · ');
    var title = parts[parts.length - 1] || section;
    if(!docs.length){
        setArticle('<h2>' + escapeHtml(title) + '</h2>'
                 + '<p class="empty">' + STR('folderEmpty') + '</p>');
        return;
    }
    var toc = '<div class="folder-head">'
            + '<h2>' + escapeHtml(title) + '</h2>'
            + '<p class="folder-sub">' + escapeHtml(section)
            + ' · ' + STRF('folderCount', { n: docs.length }) + '</p>'
            + '<ol class="folder-toc">';
    docs.forEach(function(d, i){
        // Buttons (not #anchors) so jumping doesn't trigger the router.
        toc += '<li><button type="button" class="folder-toc-link"'
             + ' onclick="scrollFolderDoc(' + i + ')">'
             + escapeHtml(d.label) + '</button></li>';
    });
    toc += '</ol></div>';
    setArticle(toc + '<div class="folder-body"><p class="empty">' + STR('loading') + '</p></div>');
    Promise.all(docs.map(function(d){
        return fetchDoc(d.name);
    })).then(function(texts){
        var html = '';
        docs.forEach(function(d, i){
            // Each doc already opens with its own heading, so no extra
            // numbered title here (it would duplicate). The section id
            // still anchors the table-of-contents jump.
            html += '<section class="folder-doc" id="folder-doc-' + i + '">'
                 +  texts[i]
                 +  '</section>';
        });
        var body = document.querySelector('.folder-body');
        if(body){ body.innerHTML = html; wrapBareTables(body); initCarousels(body); }
    });
}

// Smooth-scroll a folder-digest section into view (works whether the
// scroller is #content-scroll or the window).
function scrollFolderDoc(i){
    var el = document.getElementById('folder-doc-' + i);
    if(el){ el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}



// ---- "Recent docs" module: paginated board ----
// Ordered by each doc's created date from data/doc-dates.json (built at
// PR time from git history — see tools/build_dates.py). Until dates
// arrive, list order shows.
var MORE_PAGE_SIZE = 5;
var MORE_BLOCK = 6;    // page numbers shown per pager block (fits mobile width)
var morePage = 0;
var NEW_PAGE_SIZE = 7;   // #!new 게시판 페이지당 개수
var newPage = 0;

// 공용 게시판 페이저: [« 처음][‹ 이전블록][1 2 3 …][› 다음블록][» 끝].
// ns = 'more' | 'new' → ns+'Goto'(i) / ns+'Block'(dir) 핸들러를 부른다.
function boardPager(cur, pages, ns){
    if(pages <= 1){ return ''; }
    var block = Math.floor(cur / MORE_BLOCK);
    var first = block * MORE_BLOCK;
    var last = Math.min(first + MORE_BLOCK, pages);
    var h = '<div class="more-nav">'
        + '<button class="more-arrow" onclick="' + ns + 'Goto(0)"' + (cur === 0 ? ' disabled' : '')
        +   ' aria-label="' + STR('pagerFirst') + '" title="' + STR('pagerFirst') + '">&laquo;</button>'
        + '<button class="more-arrow" onclick="' + ns + 'Block(-1)"' + (block === 0 ? ' disabled' : '')
        +   ' aria-label="' + STR('pagerPrev') + '" title="' + STR('pagerPrev') + '">&lsaquo;</button>'
        + '<span class="more-pages">';
    for(var i = first; i < last; i++){
        h += '<button class="more-page' + (i === cur ? ' active' : '') + '"'
          +  ' onclick="' + ns + 'Goto(' + i + ')">' + (i + 1) + '</button>';
    }
    h += '</span>'
      + '<button class="more-arrow" onclick="' + ns + 'Block(1)"' + (last >= pages ? ' disabled' : '')
      +   ' aria-label="' + STR('pagerNext') + '" title="' + STR('pagerNext') + '">&rsaquo;</button>'
      + '<button class="more-arrow" onclick="' + ns + 'Goto(' + (pages - 1) + ')"' + (cur === pages - 1 ? ' disabled' : '')
      +   ' aria-label="' + STR('pagerLast') + '" title="' + STR('pagerLast') + '">&raquo;</button>'
      + '</div>';
    return h;
}

// 최근 문서 목록의 대상 — 메타/네비게이션 페이지(nonum: 지식지도 등)는 제외.
// 이름 하드코딩이 아니라 list의 구조 신호(nonum)로 거른다.
function recentDocs(){
    // 메타/네비 페이지(nonum)와 Work Log(데브 저널)는 최근 문서에서 제외 —
    // Work Log는 section이 'Work Log'로 시작(#!new·새 글 표시와 동일 기준).
    return DOCS.filter(function(d){
        return !d.nonum && !(d.section && d.section.indexOf('Work Log') === 0);
    });
}

function morePageCount(){
    return Math.max(1, Math.ceil(recentDocs().length / MORE_PAGE_SIZE));
}

function renderMore(){
    var pages = morePageCount();
    if(morePage >= pages){ morePage = pages - 1; }
    var start = morePage * MORE_PAGE_SIZE;
    var html = '<h3 class="more-title">' + STR('recent') + '</h3><ul class="more-list">';
    recentDocs().slice(start, start + MORE_PAGE_SIZE).forEach(function(d){
        var dd = formatDocDate((d.date || '').slice(0, 10));
        var meta = d.sectionL + (dd ? ' · ' + dd : '');
        html += '<li><a href="#!' + d.name + '">'
             +  '<span class="more-name">' + escapeHtml(d.label) + '</span>'
             +  '<span class="more-meta">' + escapeHtml(meta) + '</span></a></li>';
    });
    html += '</ul>';
    html += boardPager(morePage, pages, 'more');   // [« ‹ 1 2 3 › »]
    return html;
}

function moreGoto(page){
    var pages = morePageCount();
    morePage = Math.max(0, Math.min(page, pages - 1));
    document.querySelector('#more').innerHTML = renderMore();
}

// Jump forward/back a full seven-page block, landing on its first page.
function moreBlock(dir){
    var pages = morePageCount();
    var maxBlock = Math.floor((pages - 1) / MORE_BLOCK);
    var block = Math.floor(morePage / MORE_BLOCK) + dir;
    block = Math.max(0, Math.min(block, maxBlock));
    morePage = block * MORE_BLOCK;
    document.querySelector('#more').innerHTML = renderMore();
}

// ---- "새 글" 판정 (생성일 기준 최근 newDays일, Work Log·메타 제외) ----
// 데이터는 applyDocDates가 doc-dates.json에서 채운다. newDays는 설정값
// (하드코딩 없음 — effSettings().newDays, 기본 7). 그라데이션 신선도는
// 생성 경과일을 하루 단위로 계단화한다.
var DOC_DATES = {};   // name -> {c, u}
function newDaysSetting(){
    var n = parseInt(effSettings().newDays, 10);
    return (n > 0) ? n : 7;
}
// 오늘(KST, Asia/Seoul 달력일) — 데이터의 생성일이 KST로 저장되므로 판정도
// KST 기준으로 맞춘다(방문자 tz와 무관하게 한국시간으로 며칠 됐나를 센다).
function kstTodayYMD(){
    try{
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());   // "YYYY-MM-DD"
    }catch(e){
        var d = new Date(Date.now() + 9 * 3600 * 1000);   // 폴백: UTC+9
        return d.getUTCFullYear() + '-'
             + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
             + String(d.getUTCDate()).padStart(2, '0');
    }
}
function docAgeDays(name){
    var rec = DOC_DATES[name];
    var m = rec && /^(\d{4})-(\d{2})-(\d{2})/.exec(rec.c || '');
    if(!m){ return null; }
    var created = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var t = kstTodayYMD().split('-');
    var today = Date.UTC(+t[0], +t[1] - 1, +t[2]);
    return Math.round((today - created) / 86400000);
}
// 새 글이면 신선도 0..1(오늘=1, newDays-1일=거의 0), 아니면 null.
// Work Log·nonum(메타) 문서는 항상 null(제외).
function docFreshness(name){
    var d = DOC_BY_NAME[name];
    if(!d || d.nonum){ return null; }
    if(d.section && d.section.indexOf('Work Log') === 0){ return null; }
    var age = docAgeDays(name);
    if(age === null || age < 0){ return null; }
    var N = newDaysSetting();
    if(age >= N){ return null; }
    return (N - age) / N;
}
function isNewDoc(name){ return docFreshness(name) !== null; }
function anyNewDocs(){
    return DOCS.some(function(d){ return isNewDoc(d.name); });
}
// 날짜 로드 후 nav DOM에 새 글 표시를 단다(펼침 상태 보존, 재렌더 없음):
// ① 폴더 제목 배지 = 하위 새 글 수, ② 문서 숫자 그라데이션, ③ 검색 new+ 배경.
function applyNavNewMarkers(){
    var nav = document.getElementById('navigation');
    if(!nav){ return; }
    // ② 제목 앞 숫자: 새 글 링크의 doc-num 자체를 그라데이션.
    nav.querySelectorAll('a[href^="#!"]').forEach(function(a){
        var name = a.getAttribute('href').slice(2);
        var num = a.querySelector('.doc-num');
        if(!num || num.classList.contains('doc-mark')){ return; }
        var f = docFreshness(name);
        if(f !== null){
            num.classList.add('is-new');
            num.style.setProperty('--nf', f.toFixed(3));
        } else {
            num.classList.remove('is-new');
            num.style.removeProperty('--nf');
        }
    });
    // ① 폴더 배지: 그 브랜치 하위(중첩 포함) 새 글 수.
    nav.querySelectorAll('li.nav-branch').forEach(function(li){
        var btn = li.querySelector('button.nav-title');   // 첫 매치 = 이 브랜치 자신
        var badge = btn && btn.querySelector('.nav-newbadge');
        if(!badge){ return; }
        var n = 0;
        li.querySelectorAll('a[href^="#!"]').forEach(function(a){
            if(isNewDoc(a.getAttribute('href').slice(2))){ n++; }
        });
        if(n > 0){
            badge.textContent = '+' + n;   // "+N" — 총 문서 수가 아니라 "새 글 수"임을 구분
            badge.hidden = false;
            badge.setAttribute('title', STRF('newCount', { n: n }));
            badge.setAttribute('aria-label', STRF('newCount', { n: n }));
        } else {
            badge.hidden = true;
            badge.textContent = '';
            badge.removeAttribute('title');
            badge.removeAttribute('aria-label');
        }
    });
    // ③ 검색창 new+ 버튼: 새 글이 있을 때만 배경색.
    var sn = document.querySelector('.search-new');
    if(sn){ sn.classList.toggle('has-new', anyNewDocs()); }
}

function applyDocDates(dd){
    var dates = (dd && dd.docs) || {};
    if(!Object.keys(dates).length){ return; }
    DOC_DATES = dates;   // 새 글 판정이 재사용
    DOCS.forEach(function(d){
        var rec = dates[d.name];
        d.date = rec ? rec.c : '';
    });
    DOCS.sort(function(a, b){
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    morePage = 0;   // reordering restarts the board at page one
    document.querySelector('#more').innerHTML = renderMore();
    applyNavNewMarkers();   // nav 새 글 표시 갱신
    // #!new 화면에 이미 있었다면(날짜 로드 전 렌더된 경우) 다시 그린다.
    if(location.hash === '#!new'){ showNew(); }
}

function refreshRecentDocs(){
    App.data.loadDates().then(applyDocDates);
}

// ---- Settings (client-side, password-gated) ----
var SETTINGS_KEY = 'wikiSettings';
var SETTINGS_UNLOCKED = false;
var SETTINGS_CATS = null;   // category transfer-list working state
var SETTINGS_TAB = 'basic'; // active settings tab (basic | design)
// Theme accent defaults (must match the tokens in style.css).
var ACCENT_DAY_DEFAULT = '#ff6600';
var ACCENT_NIGHT_DEFAULT = '#4db6ac';

function loadSettings(){
    try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch(e){ return {}; }
}
function saveSettings(s){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
// ---- Site-wide defaults (config.json "defaults") ----
// The repo serves defaults to every visitor; a personal value saved
// in this browser wins on top. Hard-coded fallbacks keep the site
// working when config.json carries no defaults block.
var SITE_DEFAULTS = {};
var HARD_DEFAULTS = { navLineStyle: 'dashed', navLineWidth: '1px',
                      searchGame: 'g2048', music: '', lang: 'ko',
                      hideRecent: false, hideRelated: false, newDays: 7,
                      cosmosRoundness: 100 };
// Effective settings = site defaults overlaid with personal values.
function effSettings(){
    var out = {}, k;
    for(k in SITE_DEFAULTS){ out[k] = SITE_DEFAULTS[k]; }
    var s = loadSettings();
    for(k in s){ out[k] = s[k]; }
    return out;
}
function accentDefault(which){
    var v = which === 'day' ? SITE_DEFAULTS.accentDay : SITE_DEFAULTS.accentNight;
    return (v || (which === 'day' ? ACCENT_DAY_DEFAULT : ACCENT_NIGHT_DEFAULT)).toLowerCase();
}
// Store only deviations: a value equal to the effective default is
// removed, so future site-default changes keep reaching this browser.
function setOrClear(s, key, val){
    var d = SITE_DEFAULTS[key] !== undefined ? SITE_DEFAULTS[key] : HARD_DEFAULTS[key];
    if(val === d){ delete s[key]; } else { s[key] = val; }
}
function getPassword(){
    var s = loadSettings();
    return s.password || '1111';   // default password
}
// Show/hide top-level nav categories by title (hidden = list of titles).
function applyCategoryVisibility(hidden){
    hidden = hidden || [];
    document.querySelectorAll('#navigation > ul > li.nav-branch[data-cat]').forEach(function(li){
        var off = hidden.indexOf(li.getAttribute('data-cat')) !== -1;
        li.style.display = off ? 'none' : '';
    });
}
function applySettings(){
    var s = effSettings();   // site defaults + personal overrides
    if(s.title){
        var h = document.querySelector('#masthead h1 a');
        if(h){ h.textContent = s.title; }
        document.title = s.title;
    }
    if(s.tagline != null){
        var t = document.getElementById('tagline');
        if(t){ t.textContent = s.tagline; }
    }
    if(s.photoLine != null){
        var pl = document.getElementById('profile-tagline');
        var plt = pl && pl.querySelector('.ptl-text');
        if(pl && plt){
            if(s.photoLine.trim()){ plt.textContent = s.photoLine; pl.style.display = ''; }
            else { pl.style.display = 'none'; }   // cleared → hide the line
        }
    }
    // Navigation list line style / thickness.
    var root = document.documentElement;
    root.style.setProperty('--nav-line-style', s.navLineStyle || 'dashed');
    root.style.setProperty('--nav-line-width', s.navLineWidth || '1px');
    // Theme accent colors (per light/dark mode, from Settings).
    applyAccentVars(s.accentDay, s.accentNight);
    // "Recent docs" and "Related docs" footer modules — each toggled
    // independently from Settings, both hidden on non-doc screens.
    document.body.classList.toggle('hide-recent', !!s.hideRecent);
    document.body.classList.toggle('hide-related', !!s.hideRelated);
    // Top-level category visibility.
    applyCategoryVisibility(s.hiddenCats);
    // Light (day) theme is the default; a saved choice wins.
    var isDay = (s.theme || 'day') === 'day';
    document.body.classList.toggle('day', isDay);
    var toggle = document.getElementById('theme-toggle');
    if(toggle){ toggle.checked = isDay; }
    // Background-music track (site default or personal pick).
    if(window.setMusicVideo){ window.setMusicVideo(s.music || ''); }
    // Document language for a11y / search engines.
    document.documentElement.setAttribute('lang', s.lang || 'ko');
    // Static chrome attributes follow the language too.
    var sl = document.getElementById('settings-link');
    if(sl){ sl.title = STR('settings'); sl.setAttribute('aria-label', STR('settings')); }
    var tsw = document.getElementById('theme-switch');
    if(tsw){ tsw.title = STR('themeSwitch'); }
    var mbtn = document.getElementById('music-btn');
    if(mbtn){ mbtn.title = STR('musicTitle'); mbtn.setAttribute('aria-label', STR('musicAria')); }
    // 새 글 기간(newDays)·언어 변경 등이 반영되도록 nav 새 글 표시를 다시 단다.
    applyNavNewMarkers();
}

// Global config lives in the repo (same-origin, no API key needed).
// The profile image points at a public Google Drive file by id.
function driveImageUrl(id){
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w512';
}
function applyRepoConfig(){
    return fetch('config.json', { cache: 'no-store' }).then(function(r){
        return r.ok ? r.json() : null;
    }).then(function(cfg){
        if(!cfg){ return; }
        // Site-wide defaults for visitor-facing settings; personal
        // localStorage values overlay these (see effSettings).
        SITE_DEFAULTS = cfg.defaults || {};
        if(cfg.title){
            var h = document.querySelector('#masthead h1 a');
            if(h){ h.textContent = cfg.title; }
            document.title = cfg.title;
        }
        if(cfg.tagline != null){
            var t = document.getElementById('tagline');
            if(t){ t.textContent = cfg.tagline; }
        }
        var src = cfg.imageId ? driveImageUrl(cfg.imageId) : (cfg.image || '');
        if(src){
            var img = document.getElementById('profile-img');
            if(img){ img.src = src; }
        }
    }).catch(function(){ /* offline / missing config: keep defaults */ });
}

// Override the theme accent tokens per mode. Only valid #rrggbb values
// (what <input type="color"> yields) are accepted; defaults emit no
// override so style.css stays the single source of truth.
function applyAccentVars(day, night){
    var HEX = /^#[0-9a-f]{6}$/i;
    var css = '';
    if(night && HEX.test(night) && night.toLowerCase() !== ACCENT_NIGHT_DEFAULT){
        css += ':root{--accent:' + night + ';--accent-ink:' + night + ';}';
    }
    if(day && HEX.test(day) && day.toLowerCase() !== ACCENT_DAY_DEFAULT){
        // Small-text ink is a darkened shade so contrast on white holds.
        css += 'body.day{--accent:' + day + ';'
             + '--accent-ink:color-mix(in srgb,' + day + ' 78%, black);}';
    }
    var el = document.getElementById('theme-vars');
    if(!el){
        el = document.createElement('style');
        el.id = 'theme-vars';
        document.head.appendChild(el);
    }
    el.textContent = css;
}
// Live preview while dragging the color pickers (persisted on 저장).
function previewAccent(){
    var d = document.getElementById('settings-accent-day');
    var n = document.getElementById('settings-accent-night');
    applyAccentVars(d && d.value, n && n.value);
}
function resetAccent(which){
    var el = document.getElementById('settings-accent-' + which);
    if(el){ el.value = accentDefault(which); }
    previewAccent();
}

function switchSettingsTab(tab){
    SETTINGS_TAB = tab;
    ['basic', 'design'].forEach(function(t){
        var panel = document.getElementById('settings-panel-' + t);
        if(panel){ panel.hidden = t !== tab; }
        var btn = document.getElementById('settings-tab-' + t);
        if(btn){
            btn.classList.toggle('active', t === tab);
            btn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        }
    });
}

function openSettings(){
    if(SETTINGS_UNLOCKED){ showSettings(); }
    else { showSettingsLock(); }
}

function showSettingsLock(){
    var html = '<h2>' + STR('settings') + '</h2>'
             + '<p class="settings-note">' + STR('lockNote') + '</p>'
             + '<div class="settings-field">'
             +   '<label for="settings-pass">' + STR('pw') + '</label>'
             +   '<input id="settings-pass" type="password" autocomplete="current-password"'
             +   ' onkeydown="if(event.key===\'Enter\'){unlockSettings();}">'
             + '</div>'
             + '<div class="settings-actions">'
             +   '<button class="settings-save" onclick="unlockSettings()">' + STR('ok') + '</button>'
             + '</div>'
             + '<p id="settings-msg" class="settings-msg error" hidden>' + STR('wrongPw') + '</p>';
    setArticle(html);
    var box = document.getElementById('settings-pass');
    if(box){ box.focus(); }
}

function unlockSettings(){
    var box = document.getElementById('settings-pass');
    if(box && box.value === getPassword()){
        SETTINGS_UNLOCKED = true;
        showSettings();
    } else {
        var msg = document.getElementById('settings-msg');
        if(msg){ msg.hidden = false; }
        if(box){ box.value = ''; box.focus(); }
    }
}

function showSettings(){
    var s = effSettings();   // shows site defaults until overridden
    var curTitle = s.title || document.querySelector('#masthead h1 a').textContent;
    var curTagline = s.tagline != null ? s.tagline
                   : document.getElementById('tagline').textContent;
    var curMusic = s.music || '';
    var curPhotoLine = s.photoLine != null ? s.photoLine
                     : ((document.querySelector('#profile-tagline .ptl-text') || {}).textContent || '');
    var curNavStyle = s.navLineStyle || 'dashed';
    var curNavWidth = s.navLineWidth || '1px';
    var curGame = s.searchGame || 'breakout';
    var curLang = s.lang || 'ko';
    var hiddenCats = s.hiddenCats || [];
    function opt(val, label, cur){
        return '<option value="' + val + '"' + (val === cur ? ' selected' : '') + '>' + label + '</option>';
    }
    var cats = [].map.call(
        document.querySelectorAll('#navigation > ul > li.nav-branch[data-cat]'),
        function(li){ return li.getAttribute('data-cat'); });
    // Working state for the category transfer list (left=전체, right=노출).
    SETTINGS_CATS = { all: cats,
                      exposed: cats.filter(function(c){ return hiddenCats.indexOf(c) === -1; }) };
    var curAccentDay = s.accentDay || accentDefault('day');
    var curAccentNight = s.accentNight || accentDefault('night');
    var curRound = (s.cosmosRoundness != null ? s.cosmosRoundness : 100);
    var basic =
        '<div id="settings-panel-basic" class="settings-panel"'
      +   (SETTINGS_TAB === 'basic' ? '' : ' hidden') + '>'
      + '<div class="settings-field">'
      +   '<label for="settings-title">' + STR('fTitle') + '</label>'
      +   '<input id="settings-title" type="text" value="' + escapeHtml(curTitle) + '">'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-tagline">' + STR('fTagline') + '</label>'
      +   '<input id="settings-tagline" type="text" value="' + escapeHtml(curTagline) + '">'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-photoline">' + STR('fPhoto') + '</label>'
      +   '<input id="settings-photoline" type="text" value="' + escapeHtml(curPhotoLine) + '"'
      +     ' placeholder="' + STR('phPhoto') + '">'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-music">' + STR('fMusic') + '</label>'
      +   '<input id="settings-music" type="text" value="' + escapeHtml(curMusic) + '"'
      +     ' placeholder="' + STR('phMusic') + '">'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-lang">' + STR('fLang') + '</label>'
      +   '<select id="settings-lang">'
      +     opt('ko', STR('langKo'), curLang)
      +     opt('en', STR('langEn'), curLang)
      +     opt('zh', STR('langZh'), curLang)
      +     opt('ja', STR('langJa'), curLang)
      +   '</select>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-game">' + STR('fGame') + '</label>'
      +   '<select id="settings-game">'
      +     opt('g2048', STR('g2048Long'), curGame)
      +     opt('concept', STR('gConceptLong'), curGame)
      +     opt('breakout', STR('gBreakoutDef'), curGame)
      +     opt('pong', STR('gPongLong'), curGame)
      +     opt('plane', STR('gPlaneLong'), curGame)
      +   '</select>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label>' + STR('fDisplay') + '</label>'
      +   '<label class="settings-check"><input type="checkbox" id="settings-hiderecent"'
      +     (s.hideRecent ? ' checked' : '') + '> ' + STR('hideRecentL') + '</label>'
      +   '<label class="settings-check"><input type="checkbox" id="settings-hiderelated"'
      +     (s.hideRelated ? ' checked' : '') + '> ' + STR('hideRelatedL') + '</label>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-newdays">' + STR('fNewDays') + '</label>'
      +   '<input id="settings-newdays" type="number" min="1" max="30" value="'
      +     (parseInt(s.newDays, 10) || 7) + '">'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label>' + STR('fCats') + '</label>'
      +   '<div class="cat-transfer">'
      +     '<div class="cat-pane">'
      +       '<div class="cat-pane-h">' + STR('catAll') + '</div>'
      +       '<ul id="cat-left" class="cat-list"></ul>'
      +     '</div>'
      +     '<div class="cat-arrows">'
      +       '<button type="button" class="cat-arrow" onclick="catMove(1)" aria-label="' + STR('catAdd') + '" title="' + STR('catAdd') + '">&#8594;</button>'
      +       '<button type="button" class="cat-arrow" onclick="catMove(-1)" aria-label="' + STR('catRemove') + '" title="' + STR('catRemove') + '">&#8592;</button>'
      +     '</div>'
      +     '<div class="cat-pane">'
      +       '<div class="cat-pane-h">' + STR('catShown') + '</div>'
      +       '<ul id="cat-right" class="cat-list"></ul>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-newpass">' + STR('fNewPw') + '</label>'
      +   '<input id="settings-newpass" type="password" autocomplete="new-password" placeholder="' + STR('phNewPw') + '">'
      + '</div>'
      + '</div>';
    var design =
        '<div id="settings-panel-design" class="settings-panel"'
      +   (SETTINGS_TAB === 'design' ? '' : ' hidden') + '>'
      + '<div class="settings-field">'
      +   '<label>' + STR('fAccent') + '</label>'
      +   '<div class="color-row">'
      +     '<span class="color-name">' + STR('dayMode') + '</span>'
      +     '<input type="color" id="settings-accent-day" value="' + escapeHtml(curAccentDay) + '" oninput="previewAccent()">'
      +     '<button type="button" class="color-reset" onclick="resetAccent(\'day\')">' + STR('resetDefault') + '</button>'
      +   '</div>'
      +   '<div class="color-row">'
      +     '<span class="color-name">' + STR('nightMode') + '</span>'
      +     '<input type="color" id="settings-accent-night" value="' + escapeHtml(curAccentNight) + '" oninput="previewAccent()">'
      +     '<button type="button" class="color-reset" onclick="resetAccent(\'night\')">' + STR('resetDefault') + '</button>'
      +   '</div>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-navstyle">' + STR('fNavStyle') + '</label>'
      +   '<select id="settings-navstyle">'
      +     opt('dashed', STR('optDashed'), curNavStyle)
      +     opt('dotted', STR('optDotted'), curNavStyle)
      +     opt('solid', STR('optSolid'), curNavStyle)
      +   '</select>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-navwidth">' + STR('fNavWidth') + '</label>'
      +   '<select id="settings-navwidth">'
      +     opt('1px', STR('optThin'), curNavWidth)
      +     opt('2px', STR('optMed'), curNavWidth)
      +     opt('3px', STR('optThick'), curNavWidth)
      +   '</select>'
      + '</div>'
      + '<div class="settings-field">'
      +   '<label for="settings-roundness">' + STR('fRoundness') + '</label>'
      +   '<input id="settings-roundness" type="number" min="0" max="100" step="10" value="'
      +     curRound + '">'
      +   '<p class="settings-hint">' + STR('fRoundnessHint') + '</p>'
      + '</div>'
      + '</div>';
    var html =
        '<h2>' + STR('settings') + '</h2>'
      + '<p class="settings-note">' + STR('setNote') + '</p>'
      + '<div class="settings-tabs" role="tablist">'
      +   '<button type="button" id="settings-tab-basic" class="settings-tab'
      +     (SETTINGS_TAB === 'basic' ? ' active' : '') + '" role="tab"'
      +     ' aria-selected="' + (SETTINGS_TAB === 'basic') + '"'
      +     ' onclick="switchSettingsTab(\'basic\')">' + STR('tabBasic') + '</button>'
      +   '<button type="button" id="settings-tab-design" class="settings-tab'
      +     (SETTINGS_TAB === 'design' ? ' active' : '') + '" role="tab"'
      +     ' aria-selected="' + (SETTINGS_TAB === 'design') + '"'
      +     ' onclick="switchSettingsTab(\'design\')">' + STR('tabDesign') + '</button>'
      + '</div>'
      + basic
      + design
      + '<div class="settings-actions">'
      +   '<button class="settings-save" onclick="saveSettingsForm()">' + STR('save') + '</button>'
      +   '<button class="settings-reset" onclick="resetSettings()">' + STR('resetAll') + '</button>'
      + '</div>'
      + '<p id="settings-msg" class="settings-msg" hidden></p>'
      + '<details class="settings-dump-wrap">'
      +   '<summary>' + STR('dumpSummary') + '</summary>'
      +   '<div id="settings-dump"></div>'
      + '</details>';
    setArticle(html);
    renderCatTransfer();
    renderSettingsDump();
}

// ---- "이 브라우저의 현재 값" 진단 패널 ----
// Settings live only in each visitor's browser (localStorage); this
// panel makes them visible on the device itself — per key: the
// effective value and where it comes from (개인 저장 > 사이트 기본 >
// 앱 기본). The raw JSON (password masked) can be copied out.
function renderSettingsDump(){
    var box = document.getElementById('settings-dump');
    if(!box){ return; }
    var personal = loadSettings();
    var eff = effSettings();
    var KEYS = ['theme', 'lang', 'accentDay', 'accentNight', 'searchGame',
                'navLineStyle', 'navLineWidth', 'hideRecent', 'hideRelated', 'newDays',
                'cosmosRoundness', 'music', 'title', 'tagline', 'photoLine', 'hiddenCats'];
    var rows = KEYS.map(function(k){
        var v = eff[k];
        var src = personal[k] !== undefined ? STR('srcPersonal')
                : SITE_DEFAULTS[k] !== undefined ? STR('srcSite')
                : v !== undefined ? STR('srcApp') : '—';
        var shown = v === undefined ? '—'
                  : Array.isArray(v) ? (v.length ? v.join(', ') : STR('valEmpty'))
                  : String(v);
        return '<tr><td>' + k + '</td><td>' + escapeHtml(shown)
             + '</td><td>' + src + '</td></tr>';
    });
    rows.push('<tr><td>password</td><td>' + (personal.password ? STR('pwChanged') : STR('pwDefault'))
            + '</td><td>' + (personal.password ? STR('srcPersonal') : STR('srcApp')) + '</td></tr>');
    var pick = '', collapsed = '';
    try{ pick = localStorage.getItem('wikiGamePick') || ''; }catch(e){}
    try{ collapsed = localStorage.getItem('navCollapsed') || ''; }catch(e){}
    rows.push('<tr><td>' + STR('rowPick') + '</td><td>'
            + (pick ? escapeHtml(pick) : '—') + '</td><td>'
            + (pick ? STR('srcPersonal') : '—') + '</td></tr>');
    rows.push('<tr><td>' + STR('rowCollapsed') + '</td><td>'
            + (collapsed === '' ? '—' : collapsed === '0' ? 'false' : 'true')
            + '</td><td>' + (collapsed === '' ? '—' : STR('srcPersonal')) + '</td></tr>');
    var raw = {};
    Object.keys(personal).forEach(function(k){ raw[k] = personal[k]; });
    if(raw.password){ raw.password = '***'; }
    var json = JSON.stringify(raw, null, 1);
    box.innerHTML =
        '<div class="tbl-wrap"><table>'
      +   '<thead><tr><th>' + STR('thKey') + '</th><th>' + STR('thVal') + '</th><th>' + STR('thSrc') + '</th></tr></thead>'
      +   '<tbody>' + rows.join('') + '</tbody>'
      + '</table></div>'
      + '<label class="dump-raw-label">' + STR('dumpRawL') + '</label>'
      + '<textarea id="settings-dump-raw" readonly rows="4">' + escapeHtml(json) + '</textarea>'
      + '<button type="button" class="color-reset" onclick="copySettingsDump()">' + STR('copy') + '</button>';
}
function copySettingsDump(){
    var ta = document.getElementById('settings-dump-raw');
    if(!ta){ return; }
    ta.select();
    try{
        if(navigator.clipboard){ navigator.clipboard.writeText(ta.value); }
        else { document.execCommand('copy'); }
        settingsMsg(STR('copied'));
    }catch(e){ settingsMsg(STR('copyFail'), true); }
}

// ---- Category transfer list (전체 ↔ 노출) ----
function catSelect(li){ li.classList.toggle('sel'); }
function renderCatTransfer(){
    var L = document.getElementById('cat-left'), R = document.getElementById('cat-right');
    if(!L || !R || !SETTINGS_CATS){ return; }
    L.innerHTML = SETTINGS_CATS.all.map(function(c){
        var on = SETTINGS_CATS.exposed.indexOf(c) !== -1;   // already exposed
        return '<li class="cat-item' + (on ? ' on' : '') + '" data-cat="'
             + escapeHtml(c) + '" onclick="catSelect(this)">' + escapeHtml(c) + '</li>';
    }).join('');
    R.innerHTML = SETTINGS_CATS.exposed.map(function(c){
        return '<li class="cat-item" data-cat="' + escapeHtml(c)
             + '" onclick="catSelect(this)">' + escapeHtml(c) + '</li>';
    }).join('');
}
function catMove(dir){
    if(!SETTINGS_CATS){ return; }
    var side = dir > 0 ? 'cat-left' : 'cat-right';
    var sel = [].map.call(document.querySelectorAll('#' + side + ' .cat-item.sel'),
                          function(li){ return li.getAttribute('data-cat'); });
    if(dir > 0){
        sel.forEach(function(c){
            if(SETTINGS_CATS.exposed.indexOf(c) === -1){ SETTINGS_CATS.exposed.push(c); }
        });
        // keep exposed in the original category order
        SETTINGS_CATS.exposed = SETTINGS_CATS.all.filter(function(c){
            return SETTINGS_CATS.exposed.indexOf(c) !== -1;
        });
    } else {
        SETTINGS_CATS.exposed = SETTINGS_CATS.exposed.filter(function(c){
            return sel.indexOf(c) === -1;
        });
    }
    renderCatTransfer();
    persistCats();   // apply + save live
}
function persistCats(){
    if(!SETTINGS_CATS){ return; }
    var s = loadSettings();
    s.hiddenCats = SETTINGS_CATS.all.filter(function(c){
        return SETTINGS_CATS.exposed.indexOf(c) === -1;
    });
    saveSettings(s);
    applyCategoryVisibility(s.hiddenCats);
}

function settingsMsg(text, isError){
    var el = document.getElementById('settings-msg');
    if(!el){ return; }
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle('error', !!isError);
}

function saveSettingsForm(){
    var s = loadSettings();
    // Empty title = no override → fall back to config/default (so the
    // shown value matches the applied value on reopen).
    var titleVal = document.getElementById('settings-title').value.trim();
    if(titleVal){ s.title = titleVal; } else { delete s.title; }
    s.tagline = document.getElementById('settings-tagline').value;
    s.photoLine = document.getElementById('settings-photoline').value;
    // Design/feature fields store only deviations from the site
    // default, so config.json changes keep reaching this browser.
    setOrClear(s, 'music', document.getElementById('settings-music').value.trim());
    setOrClear(s, 'navLineStyle', document.getElementById('settings-navstyle').value);
    setOrClear(s, 'navLineWidth', document.getElementById('settings-navwidth').value);
    setOrClear(s, 'hideRecent', document.getElementById('settings-hiderecent').checked);
    setOrClear(s, 'hideRelated', document.getElementById('settings-hiderelated').checked);
    setOrClear(s, 'newDays', parseInt(document.getElementById('settings-newdays').value, 10) || 7);
    setOrClear(s, 'searchGame', document.getElementById('settings-game').value);
    // 3D 그래프 둥글기 (%): 0~100 클램프, 기본 100.
    var rv = parseInt(document.getElementById('settings-roundness').value, 10);
    if(isNaN(rv)){ rv = 100; }
    if(rv < 0){ rv = 0; }
    if(rv > 100){ rv = 100; }
    setOrClear(s, 'cosmosRoundness', rv);
    var prevLang = currentLang();
    setOrClear(s, 'lang', document.getElementById('settings-lang').value);
    // Accent overrides: the (site) default value = no override stored.
    var ad = document.getElementById('settings-accent-day').value;
    var an = document.getElementById('settings-accent-night').value;
    if(ad && ad.toLowerCase() !== accentDefault('day')){ s.accentDay = ad; } else { delete s.accentDay; }
    if(an && an.toLowerCase() !== accentDefault('night')){ s.accentNight = an; } else { delete s.accentNight; }
    if(SETTINGS_CATS){
        s.hiddenCats = SETTINGS_CATS.all.filter(function(c){
            return SETTINGS_CATS.exposed.indexOf(c) === -1;
        });
    }
    var np = document.getElementById('settings-newpass').value;
    if(np){ s.password = np; }
    try{
        saveSettings(s);
        applySettings();   // also re-applies the music track
        document.getElementById('settings-newpass').value = '';
        // Language shapes nav labels·doc bodies·index at load time —
        // a clean reload applies it everywhere at once.
        if(currentLang() !== prevLang){
            settingsMsg(STR('savedLang'));
            setTimeout(function(){ location.reload(); }, 700);
            return;
        }
        settingsMsg(np ? STR('savedPw') : STR('saved'));
    }catch(e){
        settingsMsg(STR('saveFail'), true);
    }
}

function resetSettings(){
    if(!window.confirm(STR('resetConfirm'))){ return; }
    localStorage.removeItem(SETTINGS_KEY);
    SETTINGS_UNLOCKED = false;
    location.reload();
}

// Mark the nav link for the doc on screen (null clears every mark).
function markActiveNav(name){
    var nav = document.getElementById('navigation');
    if(!nav){ return; }
    var want = name ? '#!' + name : null;
    nav.querySelectorAll('a').forEach(function(a){
        a.classList.toggle('nav-active', a.getAttribute('href') === want);
    });
}

// ---- Router ----
function route(){
    document.body.classList.remove('nav-open');   // close mobile drawer
    var h = location.hash;
    var path = h ? h.substr(2) : '';               // strip "#!"
    // Left the jumped Work Log page → restore the ⤓ icon to default.
    // (On the jump's own navigation, hash === target, so it stays active.)
    if(worklogJumpReturn !== null && h !== worklogJumpTarget){ clearWorklogJump(); }
    // Hide the "recent docs" module on the settings, tags and search screens.
    document.body.classList.toggle('settings-view', path === 'settings');
    document.body.classList.toggle('tags-view', path === 'tags');
    document.body.classList.toggle('about-view', path === 'about');
    // The unified search screen is both the landing page (empty hash)
    // and the destination of the masthead title link (#!search).
    var isSearch = !h || path === 'search';
    document.body.classList.toggle('search-view', isSearch);
    document.body.classList.toggle('folder-view', path.indexOf('folder:') === 0);
    document.body.classList.toggle('cosmos-view', path === 'cosmos');
    document.body.classList.toggle('newlist-view', path === 'new');
    // Work Log docs are dev journal: like tags, the "recent docs"
    // module stays out of them — Work Log 폴더 모아보기(folder:Work Log …)도 동일.
    var doc = DOC_BY_NAME[path];
    var wlFolder = path.indexOf('folder:') === 0
                && decodeURIComponent(path.substr(7)).indexOf('Work Log') === 0;
    document.body.classList.toggle('worklog-view',
        !!(doc && doc.section.indexOf('Work Log') === 0) || wlFolder);
    CURRENT_DOC = null;   // cleared here; fetchPage sets it for real docs
    if(isSearch){ showSearch(); markActiveNav(null); return; }
    if(path === 'cosmos'){ showCosmos(); markActiveNav(null); return; }
    if(path === 'tags'){ showTagIndex(); markActiveNav(null); }
    else if(path.indexOf('tag:') === 0){ showTag(decodeURIComponent(path.substr(4))); markActiveNav(null); }
    else if(path.indexOf('folder:') === 0){ showFolder(decodeURIComponent(path.substr(7))); markActiveNav(null); }
    else if(path === 'new'){ showNew(); markActiveNav(null); }
    else if(path === 'settings'){ openSettings(); markActiveNav(null); }
    else { fetchPage(path); markActiveNav(path); }
}

function toggleNav(){
    // Desktop: collapse/expand the sidebar column (default expanded;
    // the choice is remembered per browser). Mobile: slide the drawer.
    if(window.matchMedia && window.matchMedia('(min-width: 801px)').matches){
        var on = document.body.classList.toggle('nav-collapsed');
        try{ localStorage.setItem('navCollapsed', on ? '1' : '0'); }catch(e){}
    } else {
        document.body.classList.toggle('nav-open');
    }
}

function toggleBranch(btn){
    btn.parentNode.classList.toggle('collapsed');
}

function setAllBranches(collapsed){
    // '모두 접기'에서도 최상위 대분류(data-cat)는 접지 않고 열어둔다 — 이 결과가
    // 기본 레이아웃(최상위 열림·하위 접힘)과 같다. '모두 펼치기'는 전부 편다.
    document.querySelectorAll('#navigation .nav-branch').forEach(function(li){
        if(collapsed && li.hasAttribute('data-cat')){ li.classList.remove('collapsed'); return; }
        li.classList.toggle('collapsed', collapsed);
    });
}
function expandAll(){ setAllBranches(false); }
function collapseAll(){ setAllBranches(true); }

// The page we were on when the Work Log jump button was last pressed —
// null means "not currently jumped", so the next press is a fresh jump.
var worklogJumpReturn = null;
// The newest-log hash the jump opened. route() compares against it so
// that leaving the log by ANY means (not just a second press) reverts
// the ⤓ icon to its default state.
var worklogJumpTarget = null;
// Revert the jump icon (⤓) to its resting state and clear the flags.
function clearWorklogJump(){
    var btn = document.querySelector('#navigation .nav-jump');
    if(btn){
        btn.classList.remove('is-back');
        btn.title = STR('worklogRecent');
        btn.setAttribute('aria-label', STR('worklogRecent'));
    }
    worklogJumpReturn = null;
    worklogJumpTarget = null;
}
// Toggle the newest Work Log entry. First press: remember the current
// page, collapse every date, expand only the newest day's ancestor
// chain, reveal it, and open the doc. Press again while still on that
// log: collapse Work Log and return to the page we came from.
// (The list authors days chronologically, so the last <a> is newest.)
function jumpRecentWorklog(ev){
    if(ev){ ev.stopPropagation(); }   // don't toggle the branch
    var wl = document.querySelector('#navigation li.nav-branch[data-cat="Work Log"]');
    if(!wl){ return; }
    var links = wl.querySelectorAll('a[href^="#!"]');
    var last = links[links.length - 1];
    if(!last){ return; }
    var target = last.getAttribute('href');   // '#!<name>' — what route() expects
    var btn = document.querySelector('#navigation .nav-jump');
    var collapseAllWl = function(){
        wl.querySelectorAll('.nav-branch').forEach(function(li){ li.classList.add('collapsed'); });
    };
    // Second press on the newest log → collapse and go back.
    if(worklogJumpReturn !== null && location.hash === target){
        collapseAllWl();
        wl.classList.add('collapsed');
        var back = worklogJumpReturn;
        clearWorklogJump();
        location.hash = (back && back.charAt(0) === '#') ? back : '#!search';
        return;
    }
    // First press → remember where we are, then expand + open newest.
    worklogJumpReturn = location.hash;
    worklogJumpTarget = target;
    collapseAllWl();
    wl.classList.remove('collapsed');
    var el = last.parentNode;
    while(el && el !== wl){
        if(el.classList && el.classList.contains('nav-branch')){ el.classList.remove('collapsed'); }
        el = el.parentNode;
    }
    if(btn){ btn.classList.add('is-back'); btn.title = STR('worklogBack'); btn.setAttribute('aria-label', STR('worklogBack')); }
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    location.hash = target;
}

// i18n에 언어 provider 등록 — effSettings는 같은 스크립트의 호이스팅 함수.
i18nSetLangProvider(function(){ return effSettings().lang || 'ko'; });

// ---- Boot ----
window.addEventListener('hashchange', route);
// Repo config is the global source; local (localStorage) tweaks win on top.
applyRepoConfig().then(applySettings);

App.data.loadList().then(function(tree){
        buildIndexes(tree);
        document.querySelector('#navigation').innerHTML =
            '<div class="nav-tools">'
          + '<button type="button" class="nav-tool" onclick="expandAll()">'
          +   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          +     '<path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/>'
          +   '</svg>' + STR('expandAll') + '</button>'
          + '<button type="button" class="nav-tool" onclick="collapseAll()">'
          +   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          +     '<path d="m7 4 5 5 5-5"/><path d="m7 20 5-5 5 5"/>'
          +   '</svg>' + STR('collapseAll') + '</button>'
          + '</div>'
          + renderNodes(tree, []);
        applyCategoryVisibility(loadSettings().hiddenCats);   // nav now exists
        document.querySelector('#more').innerHTML = renderMore();
        refreshRecentDocs();   // reorder by last-modified once dates load
        route();   // render the initial page once indexes exist
})

// Load the AI knowledge index (summaries·concepts·related). Non-blocking:
// if a doc is already shown when it arrives, inject its related block.
// The current language's index is preferred; missing → Korean fallback.
window.__loadKnowledge = App.data.loadIndex(currentLang());
window.__loadKnowledge.then(function(idx){
    KNOWLEDGE = {};
    (idx.docs || []).forEach(function(d){ KNOWLEDGE[d.name] = d; });
    KNOWLEDGE_STATS = idx.stats || null;
    buildConceptIndex();
    injectRelated();
    hydrateAiMap();
    // Concepts now available — re-rank any in-progress search.
    var box = document.getElementById('search-input');
    if(box && box.value.trim()){ renderSearchResults(box.value); }
}).catch(function(){ KNOWLEDGE = {}; });
