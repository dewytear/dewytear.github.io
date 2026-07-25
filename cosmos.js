// cosmos.js — 지식그래프 화면: showCosmos(3D+2D 도크) · gvModel · gvRender · startCosmos.
// index.html에서 추출 (동작 불변 이동). App.state의 KNOWLEDGE(_STATS)를 읽기전용 소비,
// window.GraphViews(2D 렌더러)와 단방향 계약. 로드 순서: graphviews.js 이후, app 부트 이전.
// ---- 지식 코스모스: the knowledge graph in 3D ----
// Every doc is a star, placed near its cluster's direction on a
// sphere; related[] links are the connecting lines. Drag to
// rotate, wheel to zoom, click a star to open that doc.
function showCosmos(){
    var html =
        '<div class="cosmos-screen">'
      +   '<div class="cosmos-top">'
      +     '<div class="cosmos-hud">'
      +       '<h2 class="cosmos-head">&#10022; Knowledge Graph</h2>'
      +       '<p class="cosmos-sub">' + escapeHtml(cosmosSubFor(gvCurrentKind())) + '</p>'
      +     '</div>'
      +     '<div class="gv-dock" role="group" aria-label="' + escapeHtml(STR('gvDockAria')) + '">'
      +       '<div class="gv-groups" role="group" aria-label="'
      +         escapeHtml(STR('gvGroupAria')) + '"></div>'
      +       '<div class="gv-kinds"></div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    setArticle(html);
    var screen = document.querySelector('.cosmos-screen');
    gvSelect(screen, gvCurrentKind());
}

// ---- Graph views: the same index in nine representations ----
// 뷰가 아홉이라 한 줄에 다 늘어놓으면 번잡하다 — 먼저 **차원(3D/2D)** 을 고르고
// 그 그룹의 뷰만 아래 줄에 보여 준다. 기본값은 3D. 선택은 브라우저에 남는다.
var GV_LS_KEY = 'graphView';
var GV_LS_LAST = { '3d': 'graphView3d', '2d': 'graphView2d' };
var GV_OBS = null;   // theme watcher while a 2D view is mounted
var GV_RO = null;    // resize watcher while a 2D view is mounted

// 궤도계·스트라타는 WebGL 뷰(cosmos2.js)다 — 지원하지 않는 브라우저에서는
// 도크에서 아예 빼고, 저장된 선택도 기존 3D(성좌)로 되돌린다.
function COSMOS2_KINDS(){
    return (window.Cosmos2 && Cosmos2.supported()) ? ['3d2', '3d3'] : [];
}

function gvKindsOf(group){
    if(group === '2d'){ return window.GraphViews ? GraphViews.KINDS.slice() : []; }
    return ['3d'].concat(COSMOS2_KINDS());
}

function gvGroupOf(kind){
    return gvKindsOf('3d').indexOf(kind) !== -1 ? '3d' : '2d';
}

function gvLabel(kind){
    var lbl = { '3d': STR('gvView3d'), '3d2': STR('gvView3d2'), '3d3': STR('gvView3d3'),
                bundling: STR('gvBundling'), chord: STR('gvChord'), packing: STR('gvPacking'),
                concepts: STR('gvConcepts'), arc: STR('gvArc'), matrix: STR('gvMatrix') };
    return lbl[kind] || kind;
}

function gvCurrentKind(){
    var v = null;
    try{ v = localStorage.getItem(GV_LS_KEY); }catch(e){}
    if(gvKindsOf('3d').indexOf(v) !== -1 || gvKindsOf('2d').indexOf(v) !== -1){ return v; }
    return '3d';
}

// 그룹 버튼을 누르면 그 그룹에서 마지막으로 보던 뷰로 돌아간다.
function gvLastOf(group){
    var v = null;
    try{ v = localStorage.getItem(GV_LS_LAST[group]); }catch(e){}
    var kinds = gvKindsOf(group);
    return kinds.indexOf(v) !== -1 ? v : kinds[0];
}

// 뷰마다 조작법이 다르므로 부제도 따라간다(하드코딩 금지 — STR 키).
function cosmosSubFor(kind){
    if(kind === '3d2'){ return STR('cosmosSub3d2'); }
    if(kind === '3d3'){ return STR('cosmosSub3d3'); }
    return STR('cosmosSub');
}

// 도크 두 줄(차원 · 그 그룹의 뷰)을 현재 선택 기준으로 다시 그린다.
function gvPaintDock(screen, kind){
    var group = gvGroupOf(kind);
    var groups = screen.querySelector('.gv-groups');
    var kindsRow = screen.querySelector('.gv-kinds');
    if(!groups || !kindsRow){ return; }
    groups.innerHTML = ['3d', '2d'].filter(function(g){ return gvKindsOf(g).length; })
        .map(function(g){
            return '<button type="button" data-gvg="' + g + '"'
                 + (g === group ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"')
                 + '>' + escapeHtml(STR(g === '3d' ? 'gvGroup3d' : 'gvGroup2d')) + '</button>';
        }).join('');
    kindsRow.innerHTML = gvKindsOf(group).map(function(k){
        return '<button type="button" data-gv="' + k + '"'
             + (k === kind ? ' class="active"' : '') + '>'
             + escapeHtml(gvLabel(k)) + '</button>';
    }).join('');
    groups.querySelectorAll('button').forEach(function(b){
        b.addEventListener('click', function(){
            var g = b.getAttribute('data-gvg');
            if(g === group){ return; }
            gvSelect(screen, gvLastOf(g));
        });
    });
    kindsRow.querySelectorAll('button').forEach(function(b){
        b.addEventListener('click', function(){
            gvSelect(screen, b.getAttribute('data-gv'));
        });
    });
}

function gvSelect(screen, kind){
    var is3D = gvGroupOf(kind) === '3d';
    try{
        localStorage.setItem(GV_LS_KEY, kind);
        localStorage.setItem(GV_LS_LAST[is3D ? '3d' : '2d'], kind);
    }catch(e){}
    gvPaintDock(screen, kind);
    // 2D views hide the cosmos title/subtitle and pull the dock up.
    screen.classList.toggle('gv-2d', !is3D);
    var sub = screen.querySelector('.cosmos-sub');
    if(sub){ sub.textContent = cosmosSubFor(kind); }
    // Tear down whichever stage is up. Removing the canvas ends the
    // 3D loop (its frame() bails when the canvas leaves the DOM).
    if(window.Cosmos2){ Cosmos2.stop(); }
    var old = screen.querySelector('.cosmos-canvas');
    if(old){ old.remove(); }
    var st = screen.querySelector('.gv-stage');
    if(st){ st.remove(); }
    if(GV_OBS){ GV_OBS.disconnect(); GV_OBS = null; }
    if(GV_RO){ GV_RO.disconnect(); GV_RO = null; }
    if(COSMOS2_KINDS().indexOf(kind) !== -1){
        var c2 = document.createElement('canvas');
        c2.className = 'cosmos-canvas';
        screen.insertBefore(c2, screen.firstChild);
        // 데이터가 아직 안 왔거나 WebGL이 죽으면 기존 3D로 조용히 폴백.
        if(Cosmos2.start(c2, kind === '3d3' ? 'strata' : 'orbit')){ return; }
        if(!KNOWLEDGE){
            setTimeout(function(){
                if(c2.isConnected){ gvSelect(screen, kind); }
            }, 300);
            return;
        }
        c2.remove();
        kind = '3d';
    }
    if(kind === '3d' || !window.GraphViews){
        var canvas = document.createElement('canvas');
        canvas.className = 'cosmos-canvas';
        screen.insertBefore(canvas, screen.firstChild);
        startCosmos();
        return;
    }
    var stage = document.createElement('div');
    stage.className = 'gv-stage';
    screen.appendChild(stage);
    gvRender(stage, kind);
    // Day/night or accent changes re-derive the palette.
    GV_OBS = new MutationObserver(function(){
        if(!stage.isConnected){
            if(GV_OBS){ GV_OBS.disconnect(); GV_OBS = null; }
            return;
        }
        gvRender(stage, kind);
    });
    GV_OBS.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    // Window resize, sidebar toggle, etc. resize the stage; re-render
    // debounced so a drag doesn't thrash the layout engine.
    if(window.ResizeObserver){
        var gvResizeTimer = null;
        GV_RO = new ResizeObserver(function(){
            if(gvResizeTimer){ clearTimeout(gvResizeTimer); }
            gvResizeTimer = setTimeout(function(){
                gvResizeTimer = null;
                if(!stage.isConnected){
                    if(GV_RO){ GV_RO.disconnect(); GV_RO = null; }
                    return;
                }
                gvRender(stage, kind);
            }, 120);
        });
        GV_RO.observe(stage);
    }
}

function gvRender(stage, kind){
    if(!KNOWLEDGE || !KNOWLEDGE_STATS){
        stage.innerHTML = '<p class="gv-loading">' + escapeHtml(STR('cosmosLoading')) + '</p>';
        setTimeout(function(){ if(stage.isConnected){ gvRender(stage, kind); } }, 300);
        return;
    }
    // The dock pill wraps to two rows on narrow screens, so the CSS
    // padding-top guess can fall short and let it cover the legend.
    // Measure the real dock bottom and start the stage content there.
    var dock = stage.parentElement && stage.parentElement.querySelector('.gv-dock');
    if(dock){
        var dr = dock.getBoundingClientRect();
        var sr = stage.parentElement.getBoundingClientRect();
        stage.style.paddingTop = Math.round(dr.bottom - sr.top + 14) + 'px';
    }
    var model = gvModel();
    var legend = '<div class="gv-legend">' + model.clusters.map(function(c){
        return '<span class="lg" style="color:' + c.color + '"><i></i>'
             + '<span style="color:var(--muted)">' + escapeHtml(c.label) + '</span></span>';
    }).join('') + '</div>';
    stage.innerHTML = legend + '<div class="gv-mount"></div>';
    var mount = stage.querySelector('.gv-mount');
    model.width = Math.round(mount.clientWidth) || Math.round(stage.clientWidth) || 760;
    model.height = Math.round(mount.clientHeight) || Math.max(320, stage.clientHeight - 60);
    GraphViews.render(kind, mount, model);
}

// Normalize any css color to [h, s, l] via the canvas parser.
function gvToHsl(c){
    var cv = gvToHsl._cv || (gvToHsl._cv = document.createElement('canvas'));
    var x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillStyle = c;
    var v = x.fillStyle;
    if(v.charAt(0) !== '#'){ return [25, 100, 50]; }
    var r = parseInt(v.substr(1, 2), 16) / 255,
        g = parseInt(v.substr(3, 2), 16) / 255,
        b = parseInt(v.substr(5, 2), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
    if(d){
        s = d / (1 - Math.abs(2 * l - 1));
        h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h *= 60;
    }
    return [h, s * 100, l * 100];
}

// Model for graphviews.js — same worlds/labels/colors as the 3D
// scene (golden-angle per world, ±8°/step inside), same hidden-
// category filter, docs in nav order, concept-via edges only.
function gvModel(){
    var cs = getComputedStyle(document.body);
    var ink = {
        text: (cs.getPropertyValue('--text') || '#333').trim(),
        muted: (cs.getPropertyValue('--muted') || '#888').trim(),
        grid: (cs.getPropertyValue('--border') || '#444').trim(),
        panel: (cs.getPropertyValue('--bg-alt') || '#222').trim(),
        surface: (cs.getPropertyValue('--bg') || '#111').trim()
    };
    var base = gvToHsl((cs.getPropertyValue('--accent') || '#ff6600').trim());
    var hidden = effSettings().hiddenCats || [];
    var stats = (KNOWLEDGE_STATS && KNOWLEDGE_STATS.clusters) || [];
    var label_of = {};
    stats.forEach(function(c){ label_of[c.section] = c.label; });
    var secs = stats.map(function(c){ return c.section; })
        .filter(function(s){ return hidden.indexOf(s.split(' · ')[0]) === -1; })
        .sort();
    var tops = [];
    secs.forEach(function(s){
        var t = s.split(' · ')[0];
        if(tops.indexOf(t) === -1){ tops.push(t); }
    });
    tops.sort();
    var clusters = [];
    tops.forEach(function(t, ti){
        var mine = secs.filter(function(s){ return s.split(' · ')[0] === t; });
        mine.forEach(function(s, i){
            var h = base[0] + ti * 137.5 + (i - (mine.length - 1) / 2) * 8;
            clusters.push({
                label: label_of[s] || s,
                color: 'hsl(' + (((h % 360) + 360) % 360).toFixed(1) + ', '
                     + base[1].toFixed(1) + '%, ' + base[2].toFixed(1) + '%)',
                count: 0, galaxy: t, section: s
            });
        });
    });
    var docs = [];
    clusters.forEach(function(c, idx){
        (FOLDER_DOCS[c.section] || []).forEach(function(d){
            var k = KNOWLEDGE[d.name];
            if(!k){ return; }
            docs.push({ name: d.name, title: k.title || d.label,
                        clusterIndex: idx, concepts: k.concepts || [] });
            c.count++;
        });
    });
    var have = {};
    docs.forEach(function(d){ have[d.name] = 1; });
    var edges = [], seen = {};
    docs.forEach(function(d){
        ((KNOWLEDGE[d.name] || {}).related || []).forEach(function(r){
            if(r.via !== 'concept' || !have[r.name]){ return; }
            var key = d.name < r.name ? d.name + '|' + r.name : r.name + '|' + d.name;
            if(seen[key]){ return; }
            seen[key] = 1;
            edges.push([d.name, r.name]);
        });
    });
    return { docs: docs, edges: edges, clusters: clusters, ink: ink,
             strings: { docsN: STR('gvDocsN'), conceptIn: STR('gvConceptIn'),
                        linksN: STR('gvLinksN'), crossN: STR('gvCrossN') },
             onDocClick: function(name){ location.hash = '#!' + name; } };
}
function startCosmos(){
    var canvas = document.querySelector('.cosmos-canvas');
    if(!canvas || !canvas.getContext){ return; }
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0;
    // 발광·성운은 본래 뿌연 층이라 절반 해상도로 그려도 눈으로 차이가 없다.
    // 전면 캔버스에 직접 큰 반투명 스프라이트를 수십 장 겹치면 소프트웨어
    // 래스터에서 프레임이 반토막 나므로(실측 61→37fps), 이 층에서만 합성해
    // 한 번에 올린다(실측 회복). 수묵 배경 회귀와 같은 교훈의 재적용.
    var GLOW_SCALE = 0.5;
    var glowCv = document.createElement('canvas');
    var glowCtx = glowCv.getContext('2d');
    function resize(){
        var r = canvas.parentNode.getBoundingClientRect();
        W = r.width; H = r.height;
        canvas.width = W * dpr; canvas.height = H * dpr;
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        glowCv.width = Math.max(1, Math.round(W * GLOW_SCALE));
        glowCv.height = Math.max(1, Math.round(H * GLOW_SCALE));
    }
    window.addEventListener('resize', resize);
    // The stage also changes size without a window resize — the
    // sidebar slide morphs the content card — so track the pane
    // itself and follow its width through the whole transition.
    var ro = null;
    if(window.ResizeObserver){
        ro = new ResizeObserver(resize);
        ro.observe(canvas.parentNode);
    }
    resize();

    // 배경 더스트 — 그래프 뒤에서 끊임없이 흐르는 희미한 입자층.
    // 위치는 0..1 정규화 좌표(리사이즈에 안전), 드리프트는 감쇠 없이
    // 상시 유지, 알파는 개별 위상의 사인 트윙클로 은은하게 숨쉰다.
    var DUST_N = 200;
    var dustReduced = window.matchMedia
                   && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dust = [];
    for(var dn = 0; dn < DUST_N; dn++){
        var rs = rnd(dn * 5.3 + 1);
        dust.push({
            x: rnd(dn * 12.9898 + 1), y: rnd(dn * 78.233 + 1),
            vx: (rnd(dn * 3.7 + 1) - 0.5) * 0.24,   // ±0.12px/frame
            vy: (rnd(dn * 9.1 + 1) - 0.5) * 0.24,
            // Star-like size spread: mostly tiny, a few slightly larger
            // (rs² biases small). Stays under the doc stars, and dust is
            // muted-grey vs the coloured stars, so they don't blur together.
            r: 0.5 + rs * rs * 1.7,
            ph: rnd(dn * 2.71 + 1) * 6.2832,
            tw: 0.4 + rnd(dn * 4.2 + 1) * 0.9,
            // ~30% twinkle: dim most of the time, occasional sharp flash.
            spark: rnd(dn * 6.6 + 1) < 0.3
        });
    }
    function drawDust(mut){
        var t = dustReduced ? 0 : performance.now() / 1000;
        ctx.fillStyle = mut;
        for(var i = 0; i < dust.length; i++){
            var p = dust[i];
            if(!dustReduced && W > 0 && H > 0){
                p.x += p.vx / W; p.y += p.vy / H;
                if(p.x < 0){ p.x += 1; } else if(p.x >= 1){ p.x -= 1; }
                if(p.y < 0){ p.y += 1; } else if(p.y >= 1){ p.y -= 1; }
            }
            var s = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);   // 0..1
            // spark: dim baseline with occasional sharp flash (pow curve);
            // others: the original gentle, even shimmer.
            ctx.globalAlpha = p.spark ? (0.05 + 0.5 * Math.pow(s, 6))
                                      : (0.08 + 0.14 * s);
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, p.r, 0, 6.2832);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ---- 발광(글로우)·성운 스프라이트 ----
    // 별마다 매 프레임 그라디언트를 새로 만들면 비싸므로, 색별로 소프트
    // 스프라이트를 한 번만 오프스크린에 굽고 drawImage로 재사용한다
    // (수묵 배경의 성능 회귀에서 배운 원칙 — 프레임당 재래스터 금지).
    var SPRITES = {};
    function withAlpha(color, a){
        return color.replace(')', ', ' + a + ')').replace('hsl', 'hsla');
    }
    function softSprite(color, hardness){
        var key = color + '|' + hardness;
        if(SPRITES[key]){ return SPRITES[key]; }
        var S = 64, cv2 = document.createElement('canvas');
        cv2.width = S; cv2.height = S;
        var c2 = cv2.getContext('2d');
        var g = c2.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        // 눈부시지 않게 — 중심도 반투명에서 시작해 완만하게 사라진다(코어의
        // 또렷함은 별 자체를 그리는 원이 담당하고, 이 스프라이트는 그 둘레의
        // 부드러운 빛만 맡는다).
        if(hardness){
            g.addColorStop(0, withAlpha(color, 0.5));
            g.addColorStop(0.3, withAlpha(color, 0.2));
            g.addColorStop(0.62, withAlpha(color, 0.06));
        } else {
            g.addColorStop(0, withAlpha(color, 0.42));
            g.addColorStop(0.5, withAlpha(color, 0.14));
            g.addColorStop(0.78, withAlpha(color, 0.04));
        }
        g.addColorStop(1, withAlpha(color, 0));
        c2.fillStyle = g;
        c2.fillRect(0, 0, S, S);
        SPRITES[key] = cv2;
        return cv2;
    }
    // 좌표·반경은 화면 px로 받아 레이어 축척으로 환산해 그린다.
    function drawGlow(color, x, y, r, alpha, hardness){
        var sp = softSprite(color, hardness);
        var k = GLOW_SCALE;
        glowCtx.globalAlpha = alpha;
        glowCtx.drawImage(sp, (x - r) * k, (y - r) * k, r * 2 * k, r * 2 * k);
    }

    // Deterministic per-doc placement (stable across visits).
    function hash(s){
        var h = 2166136261;
        for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
        return h;
    }
    function rnd(seed){ var x = Math.sin(seed) * 43758.5453; return x - Math.floor(x); }
    function unit(seed){
        var u = rnd(seed) * 2 - 1, t = rnd(seed * 3.7) * 6.2832, r = Math.sqrt(1 - u * u);
        return [r * Math.cos(t), u, r * Math.sin(t)];
    }

    var nodes = null, edges = null, galaxies = null, maxRef = 1;
    var labelMin = 5;     // 이름표 상시 표시 최소 피참조 수 — build()에서 설정값으로 갱신
    var secMeta = null;   // section -> {gi, ci, cn} (World/System 색 파생용)

    // ---- World·System 색 체계 ----
    // 팔레트를 하드코딩하지 않고 매 프레임 테마 accent에서 파생한다
    // (낮/밤·개인 accent 변경 즉시 반영). World끼리는 golden-angle
    // (137.5°) 색상 회전으로 확연히 갈라지고, 같은 World의 System은
    // 그 색 주변 ±8°/step의 은은한 톤 차만 가진다.
    function toHsl(c){
        ctx.fillStyle = '#000'; ctx.fillStyle = c;
        var v = ctx.fillStyle;                     // normalized '#rrggbb'
        if(v.charAt(0) !== '#'){ return [25, 100, 50]; }
        var r = parseInt(v.substr(1, 2), 16) / 255,
            g = parseInt(v.substr(3, 2), 16) / 255,
            b = parseInt(v.substr(5, 2), 16) / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
        if(d){
            s = d / (1 - Math.abs(2 * l - 1));
            h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h *= 60;
        }
        return [h, s * 100, l * 100];
    }
    function hslStr(h, s, l){
        return 'hsl(' + (((h % 360) + 360) % 360).toFixed(1) + ', ' + s.toFixed(1) + '%, ' + l.toFixed(1) + '%)';
    }
    function build(){
        if(!KNOWLEDGE){ return false; }
        var names = Object.keys(KNOWLEDGE);
        // 메뉴에서 숨긴 대분류는 그래프에서도 제외 — 사이드바와 같은
        // 유효 설정(사이트 기본값 + 개인 설정)을 따른다.
        var eff = effSettings();
        var hidden = eff.hiddenCats || [];
        // 3D 이름표 기준(개인 설정) — 이 값 이상 피참조된 문서만 상시 이름표.
        // 지도·stats.hubs의 구조적 허브 임계값과 별개인 "표시 밀도" 취향.
        labelMin = (eff.cosmosLabelMin != null && !isNaN(eff.cosmosLabelMin))
                 ? eff.cosmosLabelMin : 5;
        if(hidden.length){
            names = names.filter(function(n){
                var top = (KNOWLEDGE[n].section || '').split(' · ')[0];
                return hidden.indexOf(top) === -1;
            });
        }
        if(!names.length){ return false; }
        // Two levels: 대분류(첫 세그먼트) = GALAXY, 분류(section) =
        // System. World centers sit far apart; each
        // galaxy's clusters spread on a smaller sphere around it, and
        // docs form a tight cloud around their cluster. related[]
        // links become the bridges between clusters and galaxies.
        var secs = [];
        names.forEach(function(n){
            var s = KNOWLEDGE[n].section || '';
            if(secs.indexOf(s) === -1){ secs.push(s); }
        });
        secs.sort();
        var label_of = {};
        if(KNOWLEDGE_STATS && KNOWLEDGE_STATS.clusters){
            KNOWLEDGE_STATS.clusters.forEach(function(c){ label_of[c.section] = c.label; });
        }
        var tops = [];
        secs.forEach(function(s){
            var t = s.split(' · ')[0];
            if(tops.indexOf(t) === -1){ tops.push(t); }
        });
        tops.sort();
        var topDir = {};
        tops.forEach(function(t, i){
            if(tops.length === 1){ topDir[t] = [0, 0, 0]; return; }
            var y = 1 - 2 * (i + 0.5) / tops.length;
            var r = Math.sqrt(1 - y * y), a = i * 2.399963;
            topDir[t] = [r * Math.cos(a) * 0.85, y * 0.85, r * Math.sin(a) * 0.85];
        });
        // With one galaxy the clusters use the whole sphere (the
        // original look); with several they huddle around their own
        // galaxy center so the universe reads as galaxies-of-clusters.
        var sub = tops.length === 1 ? 1 : 0.5;
        var CRAD = 1;   // shared-sphere radius — the round-ball envelope.
        // Roundness (설정 → 디자인 탭): 100 = 완전한 둥근 공(모든 노드를
        // 공유 구에 균일 분포), 0 = 분류(클러스터)별로 분리된 원래 배치.
        // 그 사이는 클러스터 위치 ↔ 구면 위치를 lerp. effSettings()는
        // HARD_DEFAULTS를 안 읽으므로 리터럴 100으로 폴백.
        var cr = eff.cosmosRoundness;
        var round = (cr == null ? 100 : cr) / 100;
        if(round < 0){ round = 0; }
        if(round > 1){ round = 1; }
        var dirs = {};
        galaxies = [];
        secMeta = {};
        tops.forEach(function(t, ti){
            var mine = secs.filter(function(s){ return s.split(' · ')[0] === t; });
            mine.forEach(function(s, i){
                var y = 1 - 2 * (i + 0.5) / mine.length;
                var r = Math.sqrt(1 - y * y), a = i * 2.399963;
                dirs[s] = [topDir[t][0] + r * Math.cos(a) * sub,
                           topDir[t][1] + y * sub,
                           topDir[t][2] + r * Math.sin(a) * sub];
                secMeta[s] = { gi: ti, ci: i, cn: mine.length };
                var parts = s.split(' · ');
                galaxies.push({ label: label_of[s] || parts[parts.length - 1] || s,
                                gi: ti, sec: s,
                                x: dirs[s][0], y: dirs[s][1], z: dirs[s][2],
                                sx: 0, sy: 0, ss: 1 });
            });
            if(tops.length > 1){
                galaxies.push({ big: true, label: t.toUpperCase(), gi: ti, top: t,
                                x: topDir[t][0], y: topDir[t][1], z: topDir[t][2],
                                sx: 0, sy: 0, ss: 1 });
            }
        });
        var indeg = {};
        names.forEach(function(n){
            (KNOWLEDGE[n].related || []).forEach(function(rl){
                indeg[rl.name] = (indeg[rl.name] || 0) + 1;
            });
        });
        maxRef = 1;
        names.forEach(function(n){ if((indeg[n] || 0) > maxRef){ maxRef = indeg[n]; } });
        nodes = names.map(function(n){
            var d = KNOWLEDGE[n], dir = dirs[d.section] || [0, 1, 0];
            var h1 = hash(n), j = unit((h1 % 9973) + 1);
            // Seed each node near its cluster center; the round-ball pass below
            // then redistributes every node evenly over the shared sphere.
            return { name: n, title: d.title, sec: d.section,
                     x: dir[0] + j[0] * 0.2,
                     y: dir[1] + j[1] * 0.2,
                     z: dir[2] + j[2] * 0.2,
                     ref: indeg[n] || 0, sx: 0, sy: 0, ss: 1, sz: 0,
                     // 숨쉬기(약하게) — 별마다 위상·주기가 달라 리듬이 겹치지 않는다.
                     bph: rnd((h1 % 8191) + 11) * 6.2832,
                     btw: 0.9 + rnd((h1 % 6143) + 17) * 0.7 };
        });
        var byName = {};
        nodes.forEach(function(nd, i){ byName[nd.name] = i; });
        var seen = {};
        edges = [];
        names.forEach(function(n){
            (KNOWLEDGE[n].related || []).forEach(function(rl){
                if(!(rl.name in byName)){ return; }
                var a = byName[n], b = byName[rl.name];
                var key = a < b ? a + '-' + b : b + '-' + a;
                if(seen[key]){ return; }
                seen[key] = 1;
                edges.push([a, b, rl.via === 'folder' ? 0.4 : 1]);
            });
        });
        // Round-ball layout: the cluster/World structure above supplies colors
        // and name plates, but its per-galaxy shells look lumpy and lopsided
        // when cluster sizes differ. So spread ALL nodes evenly over one shared
        // Fibonacci sphere, keeping each cluster contiguous by ordering nodes on
        // 분류 — the whole graph then reads as a full round ball. Name plates get
        // projected onto the sphere surface over each cluster/World's patch.
        var ord = nodes.map(function(_, i){ return i; }).sort(function(p, q){
            var A = nodes[p], B = nodes[q];
            return A.sec < B.sec ? -1 : A.sec > B.sec ? 1 : (A.name < B.name ? -1 : 1);
        });
        var Ntot = ord.length;
        for(var k = 0; k < Ntot; k++){
            var nd4 = nodes[ord[k]];
            // Cluster-grouped seed (dir + jitter) set above; blend toward the
            // even sphere position by `round` (1 = full ball, 0 = clusters).
            var cx = nd4.x, cy = nd4.y, cz = nd4.z;
            var yy = 1 - 2 * (k + 0.5) / Ntot;
            var rr = Math.sqrt(Math.max(0, 1 - yy * yy)), aa = k * 2.399963;
            // A little inward jitter gives the shell a soft thickness.
            var rad = CRAD * (1 - ((hash(nd4.name) % 1000) / 1000) * 0.14);
            var sx = rr * Math.cos(aa) * rad, sy = yy * rad, sz = rr * Math.sin(aa) * rad;
            nd4.x = cx * (1 - round) + sx * round;
            nd4.y = cy * (1 - round) + sy * round;
            nd4.z = cz * (1 - round) + sz * round;
        }
        function onSphere(c, scale){
            var m = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1e-3;
            var k = CRAD * scale / m;
            return [c[0] * k, c[1] * k, c[2] * k];
        }
        // Cluster plates sit on the surface over their node patch; World plates
        // float a little outside (1.18×) so the big banners never collide with
        // the cluster labels or pile up near the center.
        // Plates follow the (blended) node centroid `mid`; the surface
        // projection is lerped by the same `round`, so at round=0 the plate
        // sits at the cluster centroid and at round=1 on the sphere surface.
        var cen = {};
        nodes.forEach(function(nd){
            var c = cen[nd.sec] || (cen[nd.sec] = [0, 0, 0, 0]);
            c[0] += nd.x; c[1] += nd.y; c[2] += nd.z; c[3]++;
        });
        var topc = {};
        galaxies.forEach(function(g){
            if(g.sec && cen[g.sec]){
                var c = cen[g.sec], mid = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
                var p = onSphere(mid, 1);
                g.x = mid[0] * (1 - round) + p[0] * round;
                g.y = mid[1] * (1 - round) + p[1] * round;
                g.z = mid[2] * (1 - round) + p[2] * round;
                var tk = g.sec.split(' · ')[0], tc = topc[tk] || (topc[tk] = [0, 0, 0, 0]);
                tc[0] += mid[0]; tc[1] += mid[1]; tc[2] += mid[2]; tc[3]++;
            }
        });
        galaxies.forEach(function(g){
            if(g.top && topc[g.top]){
                var c = topc[g.top], tmid = [c[0] / c[3], c[1] / c[3], c[2] / c[3]];
                var p = onSphere(tmid, 1.18);
                g.x = tmid[0] * (1 - round) + p[0] * round;
                g.y = tmid[1] * (1 - round) + p[1] * round;
                g.z = tmid[2] * (1 - round) + p[2] * round;
            }
        });
        window.COSMOS_COUNT = nodes.length;
        return true;
    }

    var rotY = 0.6, rotX = -0.25, zoom = 1, auto = true;
    var drag = null, hover = -1, moved = 0, lastTouch = 0;
    function pick(mx, my){
        if(!nodes){ return -1; }
        var best = -1, bd = 16 * 16;
        for(var i = 0; i < nodes.length; i++){
            var dx = nodes[i].sx - mx, dy = nodes[i].sy - my, dd = dx * dx + dy * dy;
            if(dd < bd){ bd = dd; best = i; }
        }
        return best;
    }
    canvas.addEventListener('pointerdown', function(e){
        drag = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX };
        moved = 0;
        try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
    });
    canvas.addEventListener('pointermove', function(e){
        lastTouch = performance.now();
        if(drag){
            var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
            rotY = drag.ry + dx * 0.005;
            rotX = Math.max(-1.4, Math.min(1.4, drag.rx + dy * 0.005));
            auto = false;
        } else {
            var r = canvas.getBoundingClientRect();
            hover = pick(e.clientX - r.left, e.clientY - r.top);
            canvas.style.cursor = hover >= 0 ? 'pointer' : 'grab';
        }
    });
    canvas.addEventListener('pointerup', function(e){
        if(drag && moved < 6){
            var r = canvas.getBoundingClientRect();
            var i = pick(e.clientX - r.left, e.clientY - r.top);
            if(i >= 0){ location.hash = '#!' + nodes[i].name; }
        }
        drag = null;
    });
    canvas.addEventListener('pointercancel', function(){ drag = null; });
    canvas.addEventListener('wheel', function(e){
        e.preventDefault();
        lastTouch = performance.now();
        zoom = Math.max(0.5, Math.min(2.4, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    }, { passive: false });

    function frame(){
        if(!canvas.isConnected){
            window.removeEventListener('resize', resize);
            if(ro){ ro.disconnect(); }
            return;
        }
        ctx.clearRect(0, 0, W, H);
        var cs = getComputedStyle(document.body);
        var col = (cs.getPropertyValue('--accent') || '#ff6600').trim();
        var ink = (cs.getPropertyValue('--text') || '#333').trim();
        var mut = (cs.getPropertyValue('--muted') || '#888').trim();
        drawDust(mut);   // back layer — behind plates, edges, stars
        if(!nodes){
            if(!build()){
                ctx.fillStyle = mut;
                ctx.font = '14px ' + GAME_FONT;
                ctx.textAlign = 'center';
                ctx.fillText(STR('cosmosLoading'), W / 2, H / 2);
                requestAnimationFrame(frame);
                return;
            }
        }
        // Auto-rotate, resuming a few seconds after the last touch.
        if(!drag && (auto || performance.now() - lastTouch > 5000)){
            auto = true;
            rotY += 0.0018;
        }
        // 프레임당 1회, accent에서 섹션(System)별 색을 파생한다.
        var base = toHsl(col), secColor = {}, gxColor = [];
        if(secMeta){
            for(var sk in secMeta){
                var sm = secMeta[sk];
                secColor[sk] = hslStr(base[0] + sm.gi * 137.5
                                      + (sm.ci - (sm.cn - 1) / 2) * 8, base[1], base[2]);
                gxColor[sm.gi] = hslStr(base[0] + sm.gi * 137.5, base[1], base[2]);
            }
        }
        function colOf(nd){ return secColor[nd.sec] || col; }
        var cy = Math.cos(rotY), sy = Math.sin(rotY);
        var cx = Math.cos(rotX), sx = Math.sin(rotX);
        var scale = Math.min(W, H) * 0.47 * zoom, f = 3.2;
        var midX = W / 2, midY = H * 0.54;
        function project(o){
            var x = o.x * cy + o.z * sy, z = -o.x * sy + o.z * cy;
            var y2 = o.y * cx - z * sx, z2 = o.y * sx + z * cx;
            var pr = f / (f + z2);
            o.sx = midX + x * scale * pr;
            o.sy = midY + y2 * scale * pr;
            o.ss = pr; o.sz = z2;
        }
        for(var i = 0; i < nodes.length; i++){ project(nodes[i]); }
        // 성운 — System별 화면 중심에 큰 소프트 무리를 깔아 클러스터가
        // "색의 구름"으로 먼저 읽히게 한다. 스프라이트 1장을 재사용하므로
        // 프레임 비용은 drawImage 십수 번(≈클러스터 수)뿐이다.
        var isDay = document.body.classList.contains('day');
        glowCtx.setTransform(1, 0, 0, 1, 0, 0);
        glowCtx.clearRect(0, 0, glowCv.width, glowCv.height);
        glowCtx.globalCompositeOperation = 'lighter';
        var neb = {};
        for(var nb = 0; nb < nodes.length; nb++){
            var nn = nodes[nb];
            var acc = neb[nn.sec] || (neb[nn.sec] = [0, 0, 0, 0, 0]);
            acc[0] += nn.sx; acc[1] += nn.sy; acc[2] += nn.ss; acc[3]++;
            acc[4] = Math.max(acc[4], Math.hypot(nn.sx - acc[0] / acc[3], nn.sy - acc[1] / acc[3]));
        }
        for(var nk in neb){
            var ac = neb[nk];
            if(ac[3] < 2){ continue; }
            var rad = Math.max(90, ac[4] * 1.9 + 60) * (0.6 + ac[2] / ac[3] * 0.6);
            drawGlow(secColor[nk] || col, ac[0] / ac[3], ac[1] / ac[3], rad,
                     isDay ? 0.4 : 0.6, 0);
        }
        // Name plates — dim, behind everything. World(대분류) plates
        // read bigger than the System plates inside them.
        ctx.textAlign = 'center';
        for(var g = 0; g < galaxies.length; g++){
            var gx = galaxies[g];
            project(gx);
            if(gx.big){
                ctx.font = '800 ' + Math.round(22 * gx.ss) + 'px ' + GAME_FONT;
                ctx.globalAlpha = Math.max(0.12, gx.ss * 0.3);
            } else {
                ctx.font = '700 ' + Math.round(14 * gx.ss) + 'px ' + GAME_FONT;
                ctx.globalAlpha = Math.max(0.1, gx.ss * 0.22);
            }
            // 명판은 자기 World 색 — 알파가 낮아(0.1~0.3) 은은하다.
            ctx.fillStyle = gxColor[gx.gi] || mut;
            ctx.fillText(gx.label, gx.sx, gx.sy);
        }
        ctx.lineWidth = 1;
        for(var e2 = 0; e2 < edges.length; e2++){
            var a = nodes[edges[e2][0]], b = nodes[edges[e2][1]];
            var hi = hover >= 0 && (edges[e2][0] === hover || edges[e2][1] === hover);
            ctx.globalAlpha = (hi ? 0.7 : 0.15) * ((a.ss + b.ss) / 2) * edges[e2][2];
            ctx.strokeStyle = hi ? colOf(nodes[hover]) : mut;
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        }
        var order = nodes.map(function(_, k){ return k; })
            .sort(function(p, q){ return nodes[q].sz - nodes[p].sz; });   // far → near
        var tNow = dustReduced ? 0 : performance.now() / 1000;
        for(var gl2 = 0; gl2 < order.length; gl2++){
            var ndg = nodes[order[gl2]];
            var rg = Math.max(2, (2.6 + ndg.ref / maxRef * 5.5) * ndg.ss);
            // 숨쉬기 — 헤일로를 ±30%로 흔든다. 처음엔 ±12%였는데 헤일로가 절반
            // 해상도 층에서 옅게 합성돼 화면 밝기 변동이 0.06%(실측)에 그쳐 사실상
            // 보이지 않았다 → 진폭을 키우고, 아래 별 코어에도 같은 위상을 건다.
            // 계산은 프레임당 sin 한 번뿐이라 그리기 비용은 그대로다.
            var br = dustReduced ? 1 : (1 + 0.3 * Math.sin(tNow * ndg.btw + ndg.bph));
            // 별 주위 발광 — 허브일수록 크고 진하게, 호버 시 확 밝아진다.
            drawGlow(colOf(ndg), ndg.sx, ndg.sy,
                     rg * (order[gl2] === hover ? 5.4 : 4.2) * br,
                     (order[gl2] === hover ? 0.9 : 1) * Math.max(0.3, ndg.ss) * br, 1);
        }
        // 모아 둔 발광·성운 층을 한 번에 얹는다 — 전면 합성은 프레임당 1회.
        ctx.save();
        ctx.globalCompositeOperation = isDay ? 'source-over' : 'lighter';
        ctx.globalAlpha = isDay ? 0.16 : 0.26;
        ctx.drawImage(glowCv, 0, 0, W, H);
        ctx.restore();
        ctx.globalAlpha = 1;
        for(var o = 0; o < order.length; o++){
            var nd2 = nodes[order[o]];
            // 코어도 같은 위상으로 숨쉰다 — 반지름 ±13%, 밝기 ±22%.
            // 헤일로만으론 눈에 안 띄어(0.06% 변동) 코어까지 함께 흔든다.
            var bs = dustReduced ? 1 : Math.sin(tNow * nd2.btw + nd2.bph);
            var r2 = Math.max(2, (2.6 + nd2.ref / maxRef * 5.5) * nd2.ss * (1 + 0.13 * bs));
            ctx.globalAlpha = Math.max(0.16, Math.min(0.98,
                (0.25 + nd2.ss * 0.5) * (1 + 0.22 * bs)));
            ctx.fillStyle = colOf(nd2);
            ctx.beginPath(); ctx.arc(nd2.sx, nd2.sy, r2, 0, 6.2832); ctx.fill();
            if(order[o] === hover){
                ctx.globalAlpha = 0.9;
                ctx.strokeStyle = colOf(nd2); ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(nd2.sx, nd2.sy, r2 + 5, 0, 6.2832); ctx.stroke();
                ctx.lineWidth = 1;
            }
        }
        // Labels: hubs stay named; the hovered star gets a bold label.
        ctx.textAlign = 'center';
        for(var L2 = 0; L2 < nodes.length; L2++){
            var nd3 = nodes[L2];
            if(L2 !== hover && nd3.ref < labelMin){ continue; }
            ctx.font = (L2 === hover ? '700 14px ' : '600 12px ') + GAME_FONT;
            ctx.globalAlpha = L2 === hover ? 1 : Math.max(0.25, nd3.ss * 0.55);
            ctx.fillStyle = ink;
            ctx.fillText(nd3.title, nd3.sx, nd3.sy - (8 + nd3.ref / maxRef * 5));
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
