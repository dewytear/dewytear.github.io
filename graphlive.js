// ---- 그래프 스튜디오 (#!graph) — 위키 전체를 펼치는 라이브 지식그래프 ----
//
// cosmos(#!cosmos)의 9개 뷰와 별개의 **독립 화면**이다(2026-08-01 사용자 결정).
// 두 모드가 한 엔진(물리·카메라·렌더러·라벨)을 공유한다:
//   ·탐색 — KNOWLEDGE 전체(문서 + 개념)를 force-directed로 펼치고,
//           팬/줌/노드 드래그(물방울 물리)/클릭 포커스+카드.
//   ·제작 — arrows.app식 교육 모드. 빈 도화지에 노드·관계를 직접 그린다.
//           localStorage 자동 저장 + JSON 내보내기/불러오기.
//
// 계약: window.GraphLive = { mount(screen), unmount() }.
//   mount는 화면 셸(.gl-screen) 안에 캔버스·오버레이를 만들고,
//   unmount는 rAF·리스너·옵저버·DOM을 **전부** 회수한다 — 라우터(route())가
//   화면을 떠날 때마다 부르므로 no-op 안전해야 한다.
//
// 성능 규칙(이 저장소의 선례를 따른다 — cosmos.js softSprite 주석 참조):
//   ·매 프레임 재래스터 금지 — 변형은 ctx transform, dim은 globalAlpha(라이브
//     CSS filter는 5fps 사고 전례).
//   ·idle이면 rAF 자체를 끊는다(배터리) — 시뮬 알파 냉각 + 출렁임 에너지 +
//     최근 입력 시각으로 판정하고, 모든 입력·테마 변경이 wake()로 되살린다.
//   ·라벨은 캔버스 fillText가 아니라 DOM 풀 — check_i18n_render가 실제로 본다.
//
// 물방울(핵심): 물리 위치 p와 시각 위치 q의 2층 모델. q가 p를 부족감쇠
// 스프링(ζ≈0.35·ω=18)으로 쫓아, 드래그하면 늘어나며 따라오고 놓으면 2~3회
// 출렁이고 정착한다. squash/stretch는 |q'| 기반 타원 변형(면적 보존).
// prefers-reduced-motion이면 q≡p·변형 0·수렴을 오프라인으로 끝낸다.
(function(){
'use strict';

var REL_KINDS = ['prerequisite', 'implements', 'example-of', 'evidence-for', 'supersedes'];
var REL_HUE = { 2: 0, 3: 50, 4: 110, 5: 200, 6: 300 };   // accent 기준 색상 오프셋
var K_CONCEPT = 0, K_FOLDER = 1, K_MEMBER = 7, K_PLAIN = 9;

var DEFAULTS = {
    rep: 1200, len: 120, k: 0.03, grav: 0.03, damp: 0.85, wob: 0.6,
    scale: 1, lab: 1, con: 'shared', eC: true, eF: false, eR: true, arrow: true,
    style: 'auto',      // auto = 밤이면 잉크·글래스, 낮이면 Bloom-클린 (2026-08-01 결정)
    mode: 'explore'
};
var LS_KEY = 'graphLab', MK_KEY = 'graphMaker';
var reduce = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 설정: 기본값과의 차이만 저장(사이트 설정의 setOrClear와 같은 태도)
function loadP(){
    var p = {};
    Object.keys(DEFAULTS).forEach(function(k){ p[k] = DEFAULTS[k]; });
    try{
        var s = JSON.parse(localStorage.getItem(LS_KEY));
        if(s && s.v === 1){ Object.keys(DEFAULTS).forEach(function(k){
            if(s[k] !== undefined) p[k] = s[k]; }); }
    }catch(_){ }
    return p;
}
var saveTimer = null;
function saveP(P){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){
        var out = { v: 1 };
        Object.keys(DEFAULTS).forEach(function(k){
            if(P[k] !== DEFAULTS[k]) out[k] = P[k];
        });
        try{ localStorage.setItem(LS_KEY, JSON.stringify(out)); }catch(_){ }
    }, 400);
}

var R = null;   // 런타임 — mount가 만들고 unmount가 지운다

/* ═══════════════ 모델 (탐색) ═══════════════ */
// KNOWLEDGE(문서)에서 노드·엣지를 빌드한다. 개념 노드는 설정(없음/공유/전부)에
// 따라 포함. 클러스터는 KNOWLEDGE_STATS.clusters의 section 접두어 매칭 —
// gvModel(cosmos.js)과 같은 규약이고, 색은 accent hue + i·137.5°(공통 규칙).
function buildModel(P){
    var K = window.KNOWLEDGE || {}, stats = window.KNOWLEDGE_STATS || {};
    var names = Object.keys(K);
    var clusters = (stats.clusters || []).map(function(c){ return c.section; });
    function clusterOf(section){
        var best = -1, len = -1;
        for(var i = 0; i < clusters.length; i++){
            var cs = clusters[i];
            if(section === cs || (section && section.indexOf(cs + ' · ') === 0)){
                if(cs.length > len){ best = i; len = cs.length; }
            }
        }
        return best;
    }
    // 개념 df
    var df = {};
    names.forEach(function(nm){ (K[nm].concepts || []).forEach(function(c){
        df[c] = (df[c] || 0) + 1; }); });

    var meta = [], idx = {};
    names.forEach(function(nm){
        var d = K[nm];
        idx[nm] = meta.length;
        meta.push({ id: nm, title: d.title || nm, kind: 0,
                    cl: clusterOf(d.section || ''), df: 0,
                    section: d.section || '', summary: (d.summary || '') });
    });
    var conIdx = {};
    if(P.con !== 'none'){
        Object.keys(df).sort(function(a, b){ return df[b] - df[a]; }).forEach(function(c){
            if(P.con === 'shared' && df[c] < 2) return;
            conIdx[c] = meta.length;
            meta.push({ id: 'c:' + c, title: conceptLabel(c), kind: 1,
                        cl: -1, df: df[c], section: '', summary: '' });
        });
    }
    var n = meta.length;
    var g = { n: n, meta: meta, idx: idx, edges: [], adj: [],
        px: new Float32Array(n), py: new Float32Array(n),
        vx: new Float32Array(n), vy: new Float32Array(n),
        qx: new Float32Array(n), qy: new Float32Array(n),
        qvx: new Float32Array(n), qvy: new Float32Array(n),
        deg: new Float32Array(n), r: new Float32Array(n),
        clusterCount: Math.max(clusters.length, 1) };
    for(var a = 0; a < n; a++) g.adj.push([]);
    var seen = {};
    function addEdge(a2, b2, kind){
        var key = (kind >= 2 ? a2 + '>' + b2 : Math.min(a2, b2) + '-' + Math.max(a2, b2)) + ':' + kind;
        if(seen[key]) return; seen[key] = 1;
        g.edges.push([a2, b2, kind]);
        g.deg[a2]++; g.deg[b2]++;
        g.adj[a2].push(b2); g.adj[b2].push(a2);
    }
    names.forEach(function(nm){
        var d = K[nm], i = idx[nm];
        (d.related || []).forEach(function(r){
            var j = idx[r.name]; if(j === undefined) return;
            addEdge(i, j, r.via === 'folder' ? K_FOLDER : K_CONCEPT);
        });
        (d.relations || []).forEach(function(r){
            var j = idx[r.target]; if(j === undefined) return;
            var t = REL_KINDS.indexOf(r.type); if(t < 0) return;
            addEdge(i, j, 2 + t);
        });
        (d.concepts || []).forEach(function(c){
            var j = conIdx[c]; if(j === undefined) return;
            addEdge(i, j, K_MEMBER);
        });
    });
    // 초기 배치: 클러스터 골든앵글 앵커 + 결정적 지터(새로고침마다 같은 그림)
    var rnd = mulberry32(42);
    var R0 = Math.min(window.innerWidth, window.innerHeight) * 0.34;
    g.anchor = [];
    for(var c2 = 0; c2 < g.clusterCount; c2++){
        var an = c2 * 2.39996;
        g.anchor.push([Math.cos(an) * R0, Math.sin(an) * R0]);
    }
    for(var i2 = 0; i2 < n; i2++){
        var m = meta[i2], ci = m.cl >= 0 ? m.cl : (i2 % g.clusterCount);
        g.px[i2] = g.anchor[ci][0] + (rnd() - 0.5) * 140;
        g.py[i2] = g.anchor[ci][1] + (rnd() - 0.5) * 140;
        g.qx[i2] = g.px[i2]; g.qy[i2] = g.py[i2];
        g.r[i2] = m.kind === 1 ? 3.5 : Math.min(4 + Math.sqrt(g.deg[i2]) * 1.6, 14);
    }
    g.edges.sort(function(x, y){ return x[2] - y[2]; });   // dash 상태 전환 최소화
    return g;
}

/* ═══════════════ 물리 ═══════════════ */
function tick(){
    var g = R.G, P = R.P, n = g.n;
    for(var i = 0; i < n; i++){
        if(i === R.dragI) continue;
        var fx = 0, fy = 0, xi = g.px[i], yi = g.py[i];
        for(var j = 0; j < n; j++){
            if(j === i) continue;
            var dx = xi - g.px[j], dy = yi - g.py[j];
            var d2 = dx * dx + dy * dy; if(d2 < 80) d2 = 80;
            var f = P.rep / d2, d = Math.sqrt(d2);
            fx += dx / d * f; fy += dy / d * f;
        }
        var m = g.meta[i];
        if(m.cl >= 0){
            fx += (g.anchor[m.cl][0] - xi) * P.grav;
            fy += (g.anchor[m.cl][1] - yi) * P.grav;
        } else {
            fx += -xi * P.grav * 0.35; fy += -yi * P.grav * 0.35;
        }
        g.vx[i] = (g.vx[i] + fx * R.alpha) * P.damp;
        g.vy[i] = (g.vy[i] + fy * R.alpha) * P.damp;
    }
    for(var e = 0; e < g.edges.length; e++){
        var ed = g.edges[e], a = ed[0], b = ed[1], kd = ed[2];
        var rest = kd === K_FOLDER ? P.len * 0.7
                 : kd === K_MEMBER ? P.len * 0.55
                 : kd >= 2 ? P.len * 1.25 : P.len;
        var dx2 = g.px[b] - g.px[a], dy2 = g.py[b] - g.py[a];
        var d3 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
        var f2 = (d3 - rest) * P.k * R.alpha;
        var ux = dx2 / d3 * f2, uy = dy2 / d3 * f2;
        if(a !== R.dragI){ g.vx[a] += ux; g.vy[a] += uy; }
        if(b !== R.dragI){ g.vx[b] -= ux; g.vy[b] -= uy; }
    }
    for(var i3 = 0; i3 < n; i3++){
        if(i3 === R.dragI) continue;
        g.px[i3] += g.vx[i3]; g.py[i3] += g.vy[i3];
    }
    R.alpha += (R.alphaTarget - R.alpha) * 0.02;
}
// 물방울 층 — q가 p를 쫓는다. 반환값은 출렁임 에너지(idle 판정용).
function wobblePass(dt){
    var g = R.G, P = R.P;
    var wz = reduce ? 1 : (1 - P.wob * 0.65), om = 18, energy = 0;
    for(var i = 0; i < g.n; i++){
        var ax = om * om * (g.px[i] - g.qx[i]) - 2 * wz * om * g.qvx[i];
        var ay = om * om * (g.py[i] - g.qy[i]) - 2 * wz * om * g.qvy[i];
        g.qvx[i] += ax * dt; g.qvy[i] += ay * dt;
        g.qx[i] += g.qvx[i] * dt; g.qy[i] += g.qvy[i] * dt;
        var e2 = Math.abs(g.qvx[i]) + Math.abs(g.qvy[i]);
        if(e2 > energy) energy = e2;
    }
    return energy;
}
function mkWobble(dt){
    var wz = reduce ? 1 : (1 - R.P.wob * 0.65), om = 18, energy = 0;
    R.MK.nodes.forEach(function(nd){
        if(nd.qx === undefined){ nd.qx = nd.x; nd.qy = nd.y; nd.qvx = 0; nd.qvy = 0; }
        var ax = om * om * (nd.x - nd.qx) - 2 * wz * om * nd.qvx;
        var ay = om * om * (nd.y - nd.qy) - 2 * wz * om * nd.qvy;
        nd.qvx += ax * dt; nd.qvy += ay * dt;
        nd.qx += nd.qvx * dt; nd.qy += nd.qvy * dt;
        var e2 = Math.abs(nd.qvx) + Math.abs(nd.qvy);
        if(e2 > energy) energy = e2;
    });
    return energy;
}

/* ═══════════════ 카메라 ═══════════════ */
function toScreen(x, y){ return [x * R.cam.s + R.cam.tx, y * R.cam.s + R.cam.ty]; }
function toWorld(x, y){ return [(x - R.cam.tx) / R.cam.s, (y - R.cam.ty) / R.cam.s]; }
function stageXY(ev){
    var b = R.cv.getBoundingClientRect();
    return [ev.clientX - b.left, ev.clientY - b.top];
}
function fit(){
    var xs = [], ys = [];
    if(R.P.mode === 'explore'){
        for(var i = 0; i < R.G.n; i++){ xs.push(R.G.px[i]); ys.push(R.G.py[i]); }
    } else {
        R.MK.nodes.forEach(function(nd){ xs.push(nd.x); ys.push(nd.y); });
    }
    var W = R.cv.clientWidth, H = R.cv.clientHeight;
    if(!xs.length){ R.cam.s = 1; R.cam.tx = W / 2; R.cam.ty = H / 2; return; }
    var mnx = Math.min.apply(0, xs), mxx = Math.max.apply(0, xs);
    var mny = Math.min.apply(0, ys), mxy = Math.max.apply(0, ys);
    var pad = 80;
    var s = Math.min((W - pad * 2) / Math.max(mxx - mnx, 10),
                     (H - pad * 2) / Math.max(mxy - mny, 10));
    R.cam.s = Math.max(0.15, Math.min(s, 2.2));
    R.cam.tx = W / 2 - (mnx + mxx) / 2 * R.cam.s;
    R.cam.ty = H / 2 - (mny + mxy) / 2 * R.cam.s;
    wake();
}

/* ═══════════════ 렌더 ═══════════════ */
function styleNow(){
    if(R.P.style !== 'auto') return R.P.style;
    return document.body.classList.contains('day') ? 'bloom' : 'ink';
}
function cssVar(v){ return getComputedStyle(document.body).getPropertyValue(v).trim(); }
function hslOf(color){
    var c = R.colCtx; c.fillStyle = '#000'; c.fillStyle = color;
    var m = c.fillStyle, r, g, b;
    if(m[0] === '#'){
        r = parseInt(m.substr(1, 2), 16) / 255;
        g = parseInt(m.substr(3, 2), 16) / 255;
        b = parseInt(m.substr(5, 2), 16) / 255;
    } else {
        var p = m.match(/[\d.]+/g) || [0, 0, 0];
        r = p[0] / 255; g = p[1] / 255; b = p[2] / 255;
    }
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn;
    if(d){
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
        h *= 60;
    }
    return [h, s * 100, l * 100];
}
function hsl(c, a, dl){
    return 'hsla(' + c[0] + ',' + c[1] + '%,'
         + Math.max(8, Math.min(92, c[2] + (dl || 0))) + '%,' + (a == null ? 1 : a) + ')';
}
function palette(acc, day, bloom){
    var cols = [];
    for(var i = 0; i < R.G.clusterCount; i++){
        cols.push([(acc[0] + i * 137.5) % 360, bloom ? 62 : 55, day ? 42 : 64]);
    }
    return cols;
}
function draw(){
    var cv = R.cv, ctx = R.ctx, W = cv.clientWidth, H = cv.clientHeight;
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var day = document.body.classList.contains('day');
    var bloom = styleNow() === 'bloom';
    var acc = hslOf(cssVar('--accent'));
    var cols = palette(acc, day, bloom);
    var edgeH = hslOf(cssVar('--muted'));
    var P = R.P;
    if(P.mode === 'explore') drawExplore(ctx, W, H, day, bloom, acc, cols, edgeH);
    else drawMaker(ctx, W, H, day, bloom, acc, cols, edgeH);
}
function drawExplore(ctx, W, H, day, bloom, acc, cols, edgeH){
    var g = R.G, P = R.P, focus = R.sel >= 0;
    var srch = !focus && R.searchSet;   // 포커스가 검색보다 우선
    var lastK = -1;
    for(var e = 0; e < g.edges.length; e++){
        var ed = g.edges[e], a = ed[0], b = ed[1], k = ed[2];
        if(k === K_CONCEPT && !P.eC) continue;
        if(k === K_FOLDER && !P.eF) continue;
        if(k >= 2 && k <= 6 && !P.eR) continue;
        var lit = focus ? (a === R.sel || b === R.sel)
                : srch ? (R.searchSet.has(a) && R.searchSet.has(b)) : true;
        if(k !== lastK){ ctx.setLineDash(k === K_FOLDER ? [2, 5] : []); lastK = k; }
        var A = toScreen(g.qx[a], g.qy[a]), B = toScreen(g.qx[b], g.qy[b]);
        if(Math.max(A[0], B[0]) < 0 || Math.min(A[0], B[0]) > W
        || Math.max(A[1], B[1]) < 0 || Math.min(A[1], B[1]) > H) continue;
        var rel = k >= 2 && k <= 6;
        ctx.strokeStyle = rel
            ? hsl([(acc[0] + REL_HUE[k]) % 360, 65, day ? 45 : 62], lit ? (focus ? 0.9 : 0.55) : 0.05)
            : (k === K_MEMBER
                ? hsl([acc[0], 10, day ? 55 : 60], lit ? (focus ? 0.5 : 0.16) : 0.03)
                : hsl(edgeH, lit ? (focus ? 0.7 : 0.3) : 0.05));
        ctx.lineWidth = rel ? 1.4 : 0.8;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
        if(rel && P.arrow && lit) arrow(ctx, A, B, g.r[b] * P.scale * R.cam.s + 5);
    }
    ctx.setLineDash([]);
    var twoPass = focus || srch;
    for(var pass = twoPass ? 0 : 1; pass < 2; pass++){
        for(var i = 0; i < g.n; i++){
            var lit2 = focus ? (i === R.sel || R.nbr.has(i))
                     : srch ? R.searchSet.has(i) : true;
            if(twoPass && ((pass === 0) === lit2)) continue;
            node(ctx, g.qx[i], g.qy[i], g.r[i] * P.scale * Math.max(R.cam.s, 0.5),
                 g.qvx[i], g.qvy[i], g.meta[i].kind,
                 g.meta[i].cl >= 0 ? cols[g.meta[i].cl] : [acc[0], 8, day ? 52 : 62],
                 lit2 ? 1 : 0.14, i === R.sel, bloom, day, acc, W, H);
        }
    }
}
function arrow(ctx, A, B, tipGap){
    var dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if(L < 26) return;
    var t = 1 - tipGap / L, px = A[0] + dx * t, py = A[1] + dy * t;
    var ang = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - 7 * Math.cos(ang - 0.42), py - 7 * Math.sin(ang - 0.42));
    ctx.lineTo(px - 7 * Math.cos(ang + 0.42), py - 7 * Math.sin(ang + 0.42));
    ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
}
function node(ctx, wx, wy, r, qvx, qvy, kind, c, aMul, isSel, bloom, day, acc, W, H){
    var S = toScreen(wx, wy);
    if(S[0] < -30 || S[0] > W + 30 || S[1] < -30 || S[1] > H + 30) return;
    var u = reduce ? 0 : Math.min(Math.hypot(qvx, qvy) * 0.018, 0.45);
    var ang = Math.atan2(qvy, qvx);
    ctx.save();
    ctx.translate(S[0], S[1]);
    if(u > 0.01){ ctx.rotate(ang); ctx.scale(1 + u, 1 / (1 + u)); ctx.rotate(-ang); }
    if(kind === 1){                       // 개념 = 마름모 (문서=원과 시각 구분)
        ctx.rotate(Math.PI / 4);
        var rr = r * 1.15;
        ctx.fillStyle = hsl(c, 0.75 * aMul, day ? 6 : 4);
        ctx.strokeStyle = hsl(c, aMul, day ? -14 : 14);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(-rr / 1.7, -rr / 1.7, rr * 1.18, rr * 1.18);
        ctx.fill(); ctx.stroke();
    } else if(bloom){                     // Bloom-클린: 디스크 + 진한 링
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7);
        ctx.fillStyle = hsl(c, aMul, day ? 20 : 2); ctx.fill();
        ctx.lineWidth = Math.max(r * 0.18, 1.6);
        ctx.strokeStyle = hsl(c, aMul, day ? -15 : -18); ctx.stroke();
        if(isSel){ ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, 7);
            ctx.strokeStyle = hsl(acc, 0.95); ctx.lineWidth = 2; ctx.stroke(); }
    } else {                              // 잉크·글래스: 소프트 글로우 + 코어
        var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
        gr.addColorStop(0, hsl(c, 0.8 * aMul));
        gr.addColorStop(1, hsl(c, 0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7);
        ctx.fillStyle = hsl(c, aMul, 16); ctx.fill();
        if(isSel){ ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, 7);
            ctx.strokeStyle = hsl(acc, 0.9); ctx.lineWidth = 1.6; ctx.stroke(); }
    }
    ctx.restore();
}
function drawMaker(ctx, W, H, day, bloom, acc, cols, edgeH){
    var P = R.P;
    ctx.setLineDash([]);
    ctx.font = '10.5px sans-serif'; ctx.textAlign = 'center';
    R.MK.edges.forEach(function(ed){
        var na = mkById(ed.a), nb = mkById(ed.b); if(!na || !nb) return;
        if(na.qx === undefined){ na.qx = na.x; na.qy = na.y; }
        if(nb.qx === undefined){ nb.qx = nb.x; nb.qy = nb.y; }
        var A = toScreen(na.qx, na.qy), B = toScreen(nb.qx, nb.qy);
        var rel = ed.type >= 2 && ed.type <= 6;
        ctx.strokeStyle = rel
            ? hsl([(acc[0] + REL_HUE[ed.type]) % 360, 65, day ? 45 : 62], 0.85)
            : hsl(edgeH, 0.5);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
        ctx.fillStyle = cssVar('--muted');
        ctx.fillText(rel ? relTypeLabel(REL_KINDS[ed.type - 2]) : STR('mkRelPlain'),
                     (A[0] + B[0]) / 2, (A[1] + B[1]) / 2 - 5);
        if(rel) arrow(ctx, A, B, 16 * R.cam.s + 5);
    });
    if(R.rubber){
        var rn = R.MK.nodes[R.rubber.from];
        if(rn){
            var R1 = toScreen(rn.qx || rn.x, rn.qy || rn.y);
            ctx.strokeStyle = hsl(acc, 0.7); ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(R1[0], R1[1]); ctx.lineTo(R.rubber.x, R.rubber.y);
            ctx.stroke(); ctx.setLineDash([]);
        }
    }
    R.MK.nodes.forEach(function(nd, i){
        if(nd.qx === undefined){ nd.qx = nd.x; nd.qy = nd.y; nd.qvx = 0; nd.qvy = 0; }
        node(ctx, nd.qx, nd.qy, 13 * P.scale * Math.max(R.cam.s, 0.5),
             nd.qvx || 0, nd.qvy || 0, 0, cols[i % cols.length], 1,
             R.mkSel === i, bloom, day, acc, W, H);
        var S = toScreen(nd.qx, nd.qy), r2 = 13 * P.scale * Math.max(R.cam.s, 0.5);
        if(nd.pin){
            ctx.beginPath(); ctx.arc(S[0], S[1], r2 + 4, 0, 7);
            ctx.strokeStyle = hsl(acc, 0.45); ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
        }
        if(R.mkHover === i && !R.rubber){
            ctx.beginPath(); ctx.arc(S[0], S[1], r2 + 9, 0, 7);
            ctx.strokeStyle = hsl(acc, 0.5); ctx.lineWidth = 8 * Math.min(R.cam.s, 1); ctx.stroke();
        }
        ctx.fillStyle = cssVar('--text'); ctx.font = '600 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(nd.label, S[0], S[1] + r2 + 16);
    });
}

/* ═══════════════ 라벨 풀 (DOM — i18n 렌더 게이트가 본다) ═══════════════ */
function labels(){
    var used = 0, pool = R.pool;
    if(R.P.mode === 'explore'){
        var g = R.G, P = R.P, focus = R.sel >= 0;
        var K = Math.round(14 * R.cam.s * R.cam.s * P.lab);
        K = Math.max(8, Math.min(K, 80));
        var grid = {}, cell = 64;
        function fits(x, y){
            var k = ((x / cell) | 0) + ':' + ((y / cell) | 0);
            if(grid[k]) return false; grid[k] = 1; return true;
        }
        var srch = !focus && R.searchSet;
        var shown = [];
        if(focus){ shown.push(R.sel); R.nbr.forEach(function(x){ shown.push(x); }); }
        else if(srch){ R.searchSet.forEach(function(x){ if(shown.length < 60) shown.push(x); }); }
        if(R.hoverI >= 0 && shown.indexOf(R.hoverI) < 0) shown.push(R.hoverI);
        for(var o = 0; o < R.order.length && shown.length < K + (focus ? R.nbr.size : 0); o++){
            var idx = R.order[o];
            if(focus && (idx === R.sel || R.nbr.has(idx))) continue;
            if(g.meta[idx].kind === 1 && R.cam.s < 1.3) continue;
            shown.push(idx);
        }
        var W = R.cv.clientWidth, H = R.cv.clientHeight;
        for(var s2 = 0; s2 < shown.length && used < pool.length; s2++){
            var i = shown[s2], S = toScreen(g.qx[i], g.qy[i]);
            if(S[0] < 0 || S[0] > W || S[1] < 0 || S[1] > H) continue;
            var forced = (focus && (i === R.sel || R.nbr.has(i)))
                      || (srch && R.searchSet.has(i)) || i === R.hoverI;
            if(!forced && !fits(S[0], S[1])) continue;
            var el = pool[used++];
            if(el.textContent !== g.meta[i].title) el.textContent = g.meta[i].title;
            el.className = 'gl-lb on' + (g.meta[i].kind === 1 ? ' c' : '')
                         + ((focus || srch) && !forced ? ' dim' : '');
            el.style.transform = 'translate(-50%,0) translate(' + S[0] + 'px,'
                + (S[1] + g.r[i] * P.scale * Math.max(R.cam.s, 0.5) + 7) + 'px)';
        }
    }
    for(; used < pool.length; used++){
        if(pool[used].className !== 'gl-lb') pool[used].className = 'gl-lb';
    }
}

/* ═══════════════ 루프 — idle이면 rAF를 끊는다 ═══════════════ */
function wake(){
    if(!R) return;
    R.hot = performance.now();
    if(!R.running){ R.running = true; R.raf = requestAnimationFrame(frame); }
}
function frame(ts){
    if(!R || !R.cv.isConnected){ if(R) R.running = false; return; }
    var dt = Math.min((ts - R.lastT) / 1000 || 0.016, 0.033); R.lastT = ts;
    var energy = 0;
    if(!R.paused){
        if(R.P.mode === 'explore'){
            if(R.alpha > 0.004) tick();
            energy = wobblePass(dt);
        } else {
            energy = mkWobble(dt);
        }
    }
    draw(); labels();
    if(R.stateEl){
        R.stateEl.textContent = R.paused ? STR('glPaused')
            : (R.P.mode === 'explore' && R.alpha <= 0.004 && energy < 0.5
                ? STR('glSleep') : 'α ' + R.alpha.toFixed(2));
    }
    var active = R.dragI >= 0 || R.rubber || R.mkDragI >= 0 || R.pinch
        || (!R.paused && (R.alpha > 0.004 || energy > 0.5))
        || performance.now() - R.hot < 1200;
    if(active){ R.raf = requestAnimationFrame(frame); }
    else { R.running = false; }
}

/* ═══════════════ 포커스 카드 (.c2-card 어휘 재사용) ═══════════════ */
function select(i){
    var g = R.G, m = g.meta[i];
    R.sel = i; R.nbr = new Set(g.adj[i]);
    var card = R.card;
    var h = '<button type="button" class="c2-close" aria-label="' + escapeHtml(STR('c2Close')) + '">&times;</button>'
        + '<div class="c2-eyebrow">' + escapeHtml(m.kind === 1
            ? STRF('glConceptShared', { n: m.df }) : m.section) + '</div>'
        + '<div class="c2-title">' + escapeHtml(m.title) + '</div>'
        + (m.summary ? '<div class="gl-sum">' + escapeHtml(m.summary) + '</div>' : '');
    // 개념 칩(이 문서에 이어진 개념 노드들)
    var chips = '';
    g.adj[i].forEach(function(j){
        if(g.meta[j].kind === 1) chips += '<span>' + escapeHtml(g.meta[j].title) + '</span>';
    });
    if(chips) h += '<div class="c2-concepts">' + chips + '</div>';
    // relations 타입별 그룹 (기존 relType* STR 재사용 — 새 번역 0)
    var byType = {};
    g.edges.forEach(function(ed){
        if(ed[2] < 2 || ed[2] > 6) return;
        if(ed[0] === i || ed[1] === i){
            var other = ed[0] === i ? ed[1] : ed[0];
            (byType[ed[2]] = byType[ed[2]] || []).push([other, ed[0] === i]);
        }
    });
    Object.keys(byType).forEach(function(k){
        h += '<div class="gl-rt">' + escapeHtml(relTypeLabel(REL_KINDS[k - 2])) + '</div><ul class="c2-links">';
        byType[k].forEach(function(pr){
            h += '<li><a href="#" data-go="' + pr[0] + '">'
               + (pr[1] ? '&rarr; ' : '&larr; ') + escapeHtml(g.meta[pr[0]].title) + '</a></li>';
        });
        h += '</ul>';
    });
    // 이웃 문서
    var nbrDocs = g.adj[i].filter(function(j){ return g.meta[j].kind === 0; });
    h += '<div class="gl-rt">' + escapeHtml(STRF('glNbrDocs', { n: nbrDocs.length })) + '</div><ul class="c2-links">';
    nbrDocs.slice(0, 6).forEach(function(j){
        h += '<li><a href="#" data-go="' + j + '">' + escapeHtml(g.meta[j].title) + '</a></li>';
    });
    h += '</ul>';
    if(m.kind === 0){
        h += '<a class="c2-open" href="#!' + encodeURIComponent(m.id) + '">' + escapeHtml(STR('c2Open')) + '</a>';
    }
    h += '<button type="button" class="gl-seed pill">' + escapeHtml(STR('glSeed')) + '</button>';
    card.innerHTML = h;
    card.classList.add('on');
    R.panel.classList.remove('open');
    card.querySelector('.c2-close').onclick = clearSel;
    card.querySelectorAll('[data-go]').forEach(function(a2){
        a2.onclick = function(ev){ ev.preventDefault();
            var j = +this.getAttribute('data-go'); select(j); panTo(j); };
    });
    card.querySelector('.gl-seed').onclick = function(){ seedToMaker(); };
    wake();
}
function clearSel(){ if(!R) return; R.sel = -1; R.nbr = null; R.card.classList.remove('on'); wake(); }
function panTo(i){
    R.cam.tx = R.cv.clientWidth / 2 - R.G.px[i] * R.cam.s;
    R.cam.ty = R.cv.clientHeight / 2 - R.G.py[i] * R.cam.s;
    wake();
}
function seedToMaker(){
    if(R.sel < 0) return;
    var g = R.G, sel = R.sel;
    mkSnap();
    var copied = {};
    function add(i){
        if(copied[i] !== undefined) return copied[i];
        var m = g.meta[i], id = 'seed:' + m.id;
        copied[i] = id;
        if(!mkById(id)){
            R.MK.nodes.push({ id: id, label: m.title,
                x: g.px[i] - g.px[sel], y: g.py[i] - g.py[sel], pin: false });
        }
        return id;
    }
    add(sel);
    g.adj[sel].forEach(function(j){ if(g.meta[j].kind === 0) add(j); });
    g.edges.forEach(function(ed){
        if(copied[ed[0]] !== undefined && copied[ed[1]] !== undefined && ed[2] !== K_MEMBER){
            R.MK.edges.push({ a: copied[ed[0]], b: copied[ed[1]],
                type: ed[2] >= 2 && ed[2] <= 6 ? ed[2] : K_PLAIN });
        }
    });
    mkSave(); setMode('maker'); fit();
}

/* ═══════════════ 제작 모드 ═══════════════ */
function mkById(id){
    for(var i = 0; i < R.MK.nodes.length; i++) if(R.MK.nodes[i].id === id) return R.MK.nodes[i];
    return null;
}
function mkLoad(){
    try{
        var s = JSON.parse(localStorage.getItem(MK_KEY));
        if(s && s.v === 1 && Array.isArray(s.nodes) && Array.isArray(s.edges)) return s;
    }catch(_){ }
    return { v: 1, nodes: [], edges: [] };
}
function mkSnap(){
    R.mkUndo.push(JSON.stringify({ v: 1, nodes: R.MK.nodes, edges: R.MK.edges }));
    if(R.mkUndo.length > 20) R.mkUndo.shift();
}
function mkSave(){
    try{ localStorage.setItem(MK_KEY, JSON.stringify({ v: 1,
        nodes: R.MK.nodes.map(function(n){ return { id: n.id, label: n.label,
            x: Math.round(n.x), y: Math.round(n.y), pin: !!n.pin }; }),
        edges: R.MK.edges })); }catch(_){ }
    R.hint.classList.toggle('on', R.P.mode === 'maker' && !R.MK.nodes.length);
    wake();
}
function editLabel(i){
    R.editI = i;
    var nd = R.MK.nodes[i], S = toScreen(nd.qx || nd.x, nd.qy || nd.y);
    var inp = R.nodein;
    inp.style.display = 'block';
    inp.style.left = S[0] + 'px'; inp.style.top = S[1] + 'px';
    inp.value = nd.label; inp.focus(); inp.select();
}
function commitLabel(){
    if(R.editI < 0) return;
    var v = R.nodein.value.trim();
    if(v){ mkSnap(); R.MK.nodes[R.editI].label = v; }
    else { R.MK.nodes.splice(R.editI, 1); }
    R.editI = -1; R.nodein.style.display = 'none'; mkSave();
}
function openPicker(x, y, fromI, toI){
    var pk = R.picker, acc = hslOf(cssVar('--accent'));
    R.pkFrom = R.MK.nodes[fromI].id; R.pkTo = R.MK.nodes[toI].id;
    pk.innerHTML = '';
    var types = [[K_PLAIN, STR('mkRelPlain')]];
    REL_KINDS.forEach(function(t, ix){ types.push([2 + ix, relTypeLabel(t)]); });
    types.forEach(function(t){
        var b = document.createElement('button');
        b.type = 'button';
        var sw = document.createElement('span'); sw.className = 'sw';
        sw.style.borderColor = t[0] === K_PLAIN ? cssVar('--muted')
            : 'hsl(' + ((acc[0] + REL_HUE[t[0]]) % 360) + ',65%,55%)';
        b.appendChild(sw); b.appendChild(document.createTextNode(t[1]));
        b.onclick = function(){
            mkSnap(); R.MK.edges.push({ a: R.pkFrom, b: R.pkTo, type: t[0] });
            mkSave(); closePicker();
        };
        pk.appendChild(b);
    });
    var box = R.stage.getBoundingClientRect();
    pk.style.left = Math.min(x, box.width - 170) + 'px';
    pk.style.top = Math.min(y, box.height - 240) + 'px';
    pk.classList.add('on');
}
function closePicker(){ if(R) R.picker.classList.remove('on'); }
// 선택 툴바 — 노드를 탭하면 옆에 [이름]·[연결]·[삭제] 필이 뜬다.
// 모바일의 세 구멍(더블클릭 없음·할로 조준 불가·Delete 키 없음)을 메우는
// 대체 경로이자, 데스크톱에서도 동작을 눈에 보이게 하는 발견성 장치다.
function updateSelbar(){
    var sb = R.selbar;
    if(R.P.mode !== 'maker' || R.mkSel < 0 || !R.MK.nodes[R.mkSel]){
        sb.classList.remove('on'); return;
    }
    var nd = R.MK.nodes[R.mkSel], S = toScreen(nd.qx || nd.x, nd.qy || nd.y);
    var box = R.stage.getBoundingClientRect();
    sb.style.left = Math.max(8, Math.min(S[0], box.width - 180)) + 'px';
    sb.style.top = Math.max(8, S[1] - 13 * R.cam.s - 46) + 'px';
    sb.classList.add('on');
}
function mkDeleteSel(){
    if(R.mkSel < 0) return;
    mkSnap();
    var id = R.MK.nodes[R.mkSel].id;
    R.MK.nodes.splice(R.mkSel, 1);
    R.MK.edges = R.MK.edges.filter(function(e2){ return e2.a !== id && e2.b !== id; });
    R.mkSel = -1; updateSelbar(); mkSave();
}
function mkExport(){
    var blob = new Blob([JSON.stringify({ v: 1,
        nodes: R.MK.nodes.map(function(n){ return { id: n.id, label: n.label,
            x: Math.round(n.x), y: Math.round(n.y), pin: !!n.pin }; }),
        edges: R.MK.edges }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-knowledge-graph.json';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
}
function mkImport(file){
    var rd = new FileReader();
    rd.onload = function(){
        try{
            var s = JSON.parse(rd.result);
            if(!s || s.v !== 1 || !Array.isArray(s.nodes) || !Array.isArray(s.edges)) return;
            mkSnap();
            R.MK = { v: 1,
                nodes: s.nodes.filter(function(n){ return n && n.id && typeof n.label === 'string'; })
                    .map(function(n){ return { id: String(n.id), label: n.label,
                        x: +n.x || 0, y: +n.y || 0, pin: !!n.pin }; }),
                edges: s.edges.filter(function(e2){ return e2 && e2.a && e2.b; })
                    .map(function(e2){ return { a: String(e2.a), b: String(e2.b),
                        type: +e2.type || K_PLAIN }; }) };
            R.mkSel = -1; mkSave(); fit();
        }catch(_){ }
    };
    rd.readAsText(file);
}

/* ═══════════════ 화면 구성 ═══════════════ */
function el(tag, cls, html){
    var d = document.createElement(tag);
    if(cls) d.className = cls;
    if(html !== undefined) d.innerHTML = html;
    return d;
}
function pillBtn(label, title){
    var b = el('button', 'gl-pill');
    b.type = 'button'; b.textContent = label;
    if(title) b.title = title;
    return b;
}
function buildUI(screen){
    var stage = el('div', 'gl-stage');
    screen.appendChild(stage);
    var cv = el('canvas', 'gl-canvas');
    stage.appendChild(cv);
    var labelsEl = el('div', 'gl-labels');
    stage.appendChild(labelsEl);
    var hint = el('div', 'gl-hint', '<div>' + escapeHtml(STR('mkHintEmpty')) + '</div>');
    stage.appendChild(hint);

    // 좌상단: 모드 토글 + 제작 툴바
    var tl = el('div', 'gl-bar gl-tl');
    var seg = el('div', 'gl-seg');
    var bExplore = el('button', 'on'); bExplore.type = 'button'; bExplore.textContent = STR('glExplore');
    var bMaker = el('button'); bMaker.type = 'button'; bMaker.textContent = STR('glMaker');
    seg.appendChild(bExplore); seg.appendChild(bMaker);
    tl.appendChild(seg);
    var search = el('input', 'gl-search');
    search.type = 'search'; search.placeholder = STR('glSearch');
    search.setAttribute('aria-label', STR('glSearch'));
    tl.appendChild(search);
    var mkbar = el('div', 'gl-mkbar');
    var bUndo = pillBtn('↶ ' + STR('mkUndo'), 'Ctrl+Z');
    var bExport = pillBtn(STR('mkExport'));
    var bImport = pillBtn(STR('mkImport'));
    var bClear = pillBtn(STR('mkClear'));
    mkbar.appendChild(bUndo); mkbar.appendChild(bExport);
    mkbar.appendChild(bImport); mkbar.appendChild(bClear);
    tl.appendChild(mkbar);
    stage.appendChild(tl);

    // 우상단: 맞춤/일시정지/설정
    var tr = el('div', 'gl-bar gl-tr');
    var bFit = pillBtn('⌖ ' + STR('glFit'), '0');
    var bPause = pillBtn('⏸', STR('glPause'));
    var bGear = pillBtn('⚙ ' + STR('glSettings'));
    tr.appendChild(bFit); tr.appendChild(bPause); tr.appendChild(bGear);
    stage.appendChild(tr);

    var legend = el('div', 'gl-legend');
    stage.appendChild(legend);

    var card = el('div', 'c2-card gl-card');
    stage.appendChild(card);

    var panel = el('div', 'gl-panel');
    panel.innerHTML = panelHTML();
    stage.appendChild(panel);

    var picker = el('div', 'gl-picker');
    stage.appendChild(picker);
    var selbar = el('div', 'gl-selbar');
    var bRename = pillBtn(STR('mkRename'));
    var bLink = pillBtn(STR('mkLink'));
    var bDelete = pillBtn(STR('mkDelete'));
    selbar.appendChild(bRename); selbar.appendChild(bLink); selbar.appendChild(bDelete);
    stage.appendChild(selbar);
    var nodein = el('input', 'gl-nodein');
    nodein.placeholder = STR('mkLabelPh');
    stage.appendChild(nodein);
    var file = el('input');
    file.type = 'file'; file.accept = 'application/json'; file.style.display = 'none';
    stage.appendChild(file);

    return { stage: stage, cv: cv, labelsEl: labelsEl, hint: hint, legend: legend,
        card: card, panel: panel, picker: picker, nodein: nodein, file: file,
        selbar: selbar, bRename: bRename, bLink: bLink, bDelete: bDelete,
        search: search,
        seg: seg, bExplore: bExplore, bMaker: bMaker, mkbar: mkbar,
        bUndo: bUndo, bExport: bExport, bImport: bImport, bClear: bClear,
        bFit: bFit, bPause: bPause, bGear: bGear };
}
function fr(label, inner){
    return '<div class="gl-fr"><label>' + escapeHtml(label) + '</label>' + inner + '</div>';
}
function rangeHTML(id, min, max, step, val){
    return '<input type="range" id="' + id + '" min="' + min + '" max="' + max
         + '" step="' + step + '" value="' + val + '"><output>' + val + '</output>';
}
function panelHTML(){
    var P = R ? R.P : DEFAULTS;
    return '<h4>' + escapeHtml(STR('glPhysics')) + '</h4>'
        + fr(STR('glRepulsion'), rangeHTML('gl-rep', 200, 4000, 50, P.rep))
        + fr(STR('glSpringLen'), rangeHTML('gl-len', 60, 240, 5, P.len))
        + fr(STR('glSpringK'), rangeHTML('gl-k', 0.005, 0.08, 0.005, P.k))
        + fr(STR('glGravity'), rangeHTML('gl-grav', 0, 0.1, 0.005, P.grav))
        + fr(STR('glDamping'), rangeHTML('gl-damp', 0.6, 0.98, 0.01, P.damp))
        + fr(STR('glWobble'), rangeHTML('gl-wob', 0, 1, 0.05, P.wob))
        + '<h4>' + escapeHtml(STR('glDisplay')) + '</h4>'
        + fr(STR('glStyle'),
            '<select id="gl-style">'
          + '<option value="auto"' + (P.style === 'auto' ? ' selected' : '') + '>' + escapeHtml(STR('glStyleAuto')) + '</option>'
          + '<option value="ink"' + (P.style === 'ink' ? ' selected' : '') + '>' + escapeHtml(STR('glStyleInk')) + '</option>'
          + '<option value="bloom"' + (P.style === 'bloom' ? ' selected' : '') + '>' + escapeHtml(STR('glStyleBloom')) + '</option></select>')
        + fr(STR('glNodeScale'), rangeHTML('gl-scale', 0.6, 2, 0.1, P.scale))
        + fr(STR('glLabelDensity'),
            '<select id="gl-lab">'
          + '<option value="0.5"' + (P.lab === 0.5 ? ' selected' : '') + '>' + escapeHtml(STR('glLabLow')) + '</option>'
          + '<option value="1"' + (P.lab === 1 ? ' selected' : '') + '>' + escapeHtml(STR('glLabAuto')) + '</option>'
          + '<option value="2"' + (P.lab === 2 ? ' selected' : '') + '>' + escapeHtml(STR('glLabHigh')) + '</option></select>')
        + fr(STR('glConceptNodes'),
            '<select id="gl-con">'
          + '<option value="none"' + (P.con === 'none' ? ' selected' : '') + '>' + escapeHtml(STR('glConNone')) + '</option>'
          + '<option value="shared"' + (P.con === 'shared' ? ' selected' : '') + '>' + escapeHtml(STR('glConShared')) + '</option>'
          + '<option value="all"' + (P.con === 'all' ? ' selected' : '') + '>' + escapeHtml(STR('glConAll')) + '</option></select>')
        + fr(STR('glEdgeConcept'), '<input type="checkbox" id="gl-ec"' + (P.eC ? ' checked' : '') + '>')
        + fr(STR('glEdgeFolder'), '<input type="checkbox" id="gl-ef"' + (P.eF ? ' checked' : '') + '>')
        + fr(STR('glEdgeRel'), '<input type="checkbox" id="gl-er"' + (P.eR ? ' checked' : '') + '>')
        + fr(STR('glArrows'), '<input type="checkbox" id="gl-arrow"' + (P.arrow ? ' checked' : '') + '>')
        + '<h4>' + escapeHtml(STR('glPerf')) + '</h4>'
        + fr(STR('glState'), '<output id="gl-state" style="width:auto">—</output>')
        + '<div class="gl-fr"><button type="button" class="gl-small" id="gl-reset">'
        + escapeHtml(STR('glReset')) + '</button></div>';
}
function renderLegend(){
    var lg = R.legend;
    if(R.P.mode === 'maker'){
        lg.innerHTML = '<div class="row"><b>' + escapeHtml(STR('glMaker')) + '</b></div>'
            + '<div class="row">' + escapeHtml(STR('mkLegend1')) + '</div>'
            + '<div class="row">' + escapeHtml(STR('mkLegend2')) + '</div>';
        return;
    }
    lg.innerHTML = '<div class="row"><span class="dot"></span> ' + escapeHtml(STR('glLegendDoc')) + '</div>'
        + '<div class="row"><span class="dia"></span> ' + escapeHtml(STR('glLegendCon')) + '</div>'
        + '<div class="row"><span class="sw"></span> ' + escapeHtml(STR('glLegendConcept')) + '</div>'
        + '<div class="row"><span class="sw dash"></span> ' + escapeHtml(STR('glLegendFolder')) + '</div>'
        + '<div class="row"><span class="sw acc"></span> ' + escapeHtml(STR('glLegendRel')) + '</div>';
}
function setMode(m){
    R.P.mode = m; saveP(R.P);
    document.body.classList.toggle('gl-maker', m === 'maker');
    R.bExplore.classList.toggle('on', m === 'explore');
    R.bMaker.classList.toggle('on', m === 'maker');
    var sub = document.getElementById('gl-sub');
    if(sub) sub.textContent = STR(m === 'maker' ? 'glSubMaker' : 'glSub');
    clearSel(); closePicker();
    R.mkSel = -1; R.linkFrom = -1; updateSelbar();
    R.hint.firstChild.textContent = STR('mkHintEmpty');
    R.hint.classList.toggle('on', m === 'maker' && !R.MK.nodes.length);
    renderLegend(); fit();
}

/* ═══════════════ 입력 ═══════════════ */
function hitNode(mx, my){
    if(R.P.mode === 'explore'){
        var g = R.G, best = -1, bd = 1e9;
        for(var i = 0; i < g.n; i++){
            var S = toScreen(g.qx[i], g.qy[i]);
            var r = Math.max(g.r[i] * R.P.scale * Math.max(R.cam.s, 0.5) + 6, 11);
            var d2 = (S[0] - mx) * (S[0] - mx) + (S[1] - my) * (S[1] - my);
            if(d2 < r * r && d2 < bd){ bd = d2; best = i; }
        }
        return best;
    }
    for(var j = R.MK.nodes.length - 1; j >= 0; j--){
        var nd = R.MK.nodes[j];
        var S2 = toScreen(nd.qx || nd.x, nd.qy || nd.y);
        if(Math.hypot(S2[0] - mx, S2[1] - my) < 15 * R.cam.s + 6) return j;
    }
    return -1;
}
function mkHaloHit(mx, my){
    for(var j = R.MK.nodes.length - 1; j >= 0; j--){
        var nd = R.MK.nodes[j];
        var S2 = toScreen(nd.qx || nd.x, nd.qy || nd.y);
        var d = Math.hypot(S2[0] - mx, S2[1] - my), r = 13 * R.cam.s;
        if(d > r + 2 && d < r + 14) return j;
    }
    return -1;
}
function onDown(ev){
    wake();
    R.cv.setPointerCapture(ev.pointerId);
    var xy = stageXY(ev);
    R.pts.set(ev.pointerId, xy);
    if(R.pts.size === 2){
        var a = Array.from(R.pts.values());
        R.pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), s: R.cam.s,
            cx: (a[0][0] + a[1][0]) / 2, cy: (a[0][1] + a[1][1]) / 2 };
        R.dragI = -1; R.mkDragI = -1; R.rubber = null;
        return;
    }
    R.moved = 0;
    // 터치 더블탭 → 더블클릭 (모바일 제작 모드의 노드 생성·이름 편집 경로)
    if(ev.pointerType === 'touch'){
        var now = performance.now();
        if(R.lastTap && now - R.lastTap.t < 350
           && Math.hypot(xy[0] - R.lastTap.x, xy[1] - R.lastTap.y) < 28){
            R.lastTap = null;
            R.pts.delete(ev.pointerId);
            dblAt(xy);
            return;
        }
        R.lastTap = { t: now, x: xy[0], y: xy[1] };
    }
    if(R.P.mode === 'maker'){
        // 링크 모드(선택 툴바의 '연결') — 다음 탭한 노드로 관계를 잇는다
        if(R.linkFrom >= 0){
            var tgt0 = hitNode(xy[0], xy[1]);
            if(tgt0 >= 0 && tgt0 !== R.linkFrom) openPicker(xy[0], xy[1], R.linkFrom, tgt0);
            R.linkFrom = -1; updateSelbar(); R.pts.delete(ev.pointerId);
            R.hint.classList.remove('on');
            R.hint.firstChild.textContent = STR('mkHintEmpty');
            return;
        }
        var h = mkHaloHit(xy[0], xy[1]);
        if(h >= 0){ R.rubber = { from: h, x: xy[0], y: xy[1] }; return; }
        R.mkDragI = hitNode(xy[0], xy[1]);
        if(R.mkDragI >= 0){ mkSnap(); R.mkSel = R.mkDragI; updateSelbar(); return; }
    } else {
        R.dragI = hitNode(xy[0], xy[1]);
        if(R.dragI >= 0){
            R.alphaTarget = 0.3; R.alpha = Math.max(R.alpha, 0.3);
            return;
        }
    }
    R.panning = true; R.cv.classList.add('grabbing');
}
function onMove(ev){
    if(!R.pts.has(ev.pointerId) && ev.buttons === 0 && R.P.mode === 'maker'){
        var xy0 = stageXY(ev);
        R.mkHover = hitNode(xy0[0], xy0[1]);
        wake(); return;
    }
    if(R.pts.has(ev.pointerId)) R.pts.set(ev.pointerId, stageXY(ev));
    wake();
    if(R.pinch && R.pts.size === 2){
        var a = Array.from(R.pts.values());
        var d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
        var k = Math.max(0.15, Math.min(R.pinch.s * d / R.pinch.d, 4)) / R.cam.s;
        R.cam.s *= k;
        R.cam.tx = R.pinch.cx - (R.pinch.cx - R.cam.tx) * k;
        R.cam.ty = R.pinch.cy - (R.pinch.cy - R.cam.ty) * k;
        var cx2 = (a[0][0] + a[1][0]) / 2, cy2 = (a[0][1] + a[1][1]) / 2;
        R.cam.tx += cx2 - R.pinch.cx; R.cam.ty += cy2 - R.pinch.cy;
        R.pinch.cx = cx2; R.pinch.cy = cy2;
        return;
    }
    var xy = stageXY(ev);
    R.moved += Math.abs(ev.movementX || 0) + Math.abs(ev.movementY || 0);
    if(R.rubber){ R.rubber.x = xy[0]; R.rubber.y = xy[1]; return; }
    if(R.mkDragI >= 0){
        var w = toWorld(xy[0], xy[1]);
        R.MK.nodes[R.mkDragI].x = w[0]; R.MK.nodes[R.mkDragI].y = w[1];
        return;
    }
    if(R.dragI >= 0){
        // kinematic 드래그 — 고무줄 지연이 젤리 연쇄의 근원
        var w2 = toWorld(xy[0], xy[1]);
        R.G.px[R.dragI] += (w2[0] - R.G.px[R.dragI]) * 0.35;
        R.G.py[R.dragI] += (w2[1] - R.G.py[R.dragI]) * 0.35;
        return;
    }
    if(R.panning){ R.cam.tx += ev.movementX; R.cam.ty += ev.movementY; }
    else if(R.P.mode === 'maker'){ R.mkHover = hitNode(xy[0], xy[1]); }
    else {
        R.hoverI = hitNode(xy[0], xy[1]);
        R.cv.style.cursor = R.hoverI >= 0 ? 'pointer' : '';
    }
}
function onUp(ev){
    R.pts.delete(ev.pointerId);
    if(R.pts.size < 2) R.pinch = null;
    R.cv.classList.remove('grabbing');
    var xy = stageXY(ev);
    wake();
    if(R.rubber){
        var tgt = hitNode(xy[0], xy[1]);
        if(tgt >= 0 && tgt !== R.rubber.from) openPicker(xy[0], xy[1], R.rubber.from, tgt);
        R.rubber = null; return;
    }
    if(R.mkDragI >= 0){
        if(R.moved >= 6) R.MK.nodes[R.mkDragI].pin = true;   // 놓으면 핀 고정 (arrows.app식)
        mkSave(); R.mkDragI = -1; updateSelbar(); return;
    }
    if(R.dragI >= 0){
        R.alphaTarget = 0;
        if(R.moved < 6) select(R.dragI);   // 잡자마자 놓으면 드래그가 아니라 클릭
        R.dragI = -1; return;
    }
    if(R.panning){
        R.panning = false;
        if(R.moved < 6){
            var h = hitNode(xy[0], xy[1]);
            if(R.P.mode === 'explore'){ if(h >= 0) select(h); else clearSel(); }
            else { R.mkSel = h; updateSelbar(); }
        }
    }
}
function onWheel(ev){
    ev.preventDefault(); wake();
    var xy = stageXY(ev);
    var k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    var ns = Math.max(0.15, Math.min(R.cam.s * k, 4)); k = ns / R.cam.s;
    R.cam.tx = xy[0] - (xy[0] - R.cam.tx) * k;
    R.cam.ty = xy[1] - (xy[1] - R.cam.ty) * k;
    R.cam.s = ns;
}
function onDbl(ev){
    wake();
    dblAt(stageXY(ev));
}
// 더블클릭 본체 — 마우스 dblclick과 터치 더블탭(자체 감지)이 공유한다.
// touch-action:none 캔버스에서는 브라우저가 dblclick을 합성해 주지 않는
// 환경이 있어(모바일 제작 모드의 핵심 동작이 통째로 막힌다) 직접 감지한다.
function dblAt(xy){
    if(R.P.mode === 'maker'){
        var h = hitNode(xy[0], xy[1]);
        if(h >= 0){ editLabel(h); return; }
        var w = toWorld(xy[0], xy[1]);
        mkSnap();
        R.MK.nodes.push({ id: 'n' + Date.now(), label: '',
            x: w[0], y: w[1], qx: w[0], qy: w[1], qvx: 0, qvy: 0, pin: true });
        mkSave(); editLabel(R.MK.nodes.length - 1);
    } else {
        var h2 = hitNode(xy[0], xy[1]);
        if(h2 >= 0 && R.G.meta[h2].kind === 0){
            location.hash = '#!' + encodeURIComponent(R.G.meta[h2].id);   // cosmos2 규약
            return;
        }
        var k2 = 1.6, ns2 = Math.min(R.cam.s * k2, 4), kk = ns2 / R.cam.s;
        R.cam.tx = xy[0] - (xy[0] - R.cam.tx) * kk;
        R.cam.ty = xy[1] - (xy[1] - R.cam.ty) * kk;
        R.cam.s = ns2;
    }
}
function onKey(ev){
    if(!R) return;
    if(ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') return;
    if(ev.key === 'Escape'){ clearSel(); R.panel.classList.remove('open'); closePicker(); }
    else if(ev.key === '0'){ fit(); }
    else if(ev.key === '+' || ev.key === '='){ R.cam.s = Math.min(R.cam.s * 1.2, 4); wake(); }
    else if(ev.key === '-'){ R.cam.s = Math.max(R.cam.s / 1.2, 0.15); wake(); }
    else if(R.P.mode === 'maker'){
        if((ev.key === 'Delete' || ev.key === 'Backspace') && R.mkSel >= 0){
            mkDeleteSel();
        } else if((ev.key === 'z' || ev.key === 'Z') && (ev.ctrlKey || ev.metaKey)){
            var s = R.mkUndo.pop();
            if(s){ R.MK = JSON.parse(s); R.mkSel = -1; mkSave(); }
        }
    }
}

/* ═══════════════ 패널 배선 ═══════════════ */
function bindPanel(){
    var panel = R.panel;
    function range(id, key){
        var elx = panel.querySelector('#' + id);
        var out = elx.parentNode.querySelector('output');
        elx.addEventListener('input', function(){
            R.P[key] = parseFloat(elx.value);
            out.textContent = elx.value;
            R.alpha = Math.max(R.alpha, 0.5); R.alphaTarget = 0;
            saveP(R.P); wake();
        });
    }
    range('gl-rep', 'rep'); range('gl-len', 'len'); range('gl-k', 'k');
    range('gl-grav', 'grav'); range('gl-damp', 'damp'); range('gl-wob', 'wob');
    range('gl-scale', 'scale');
    panel.querySelector('#gl-style').addEventListener('change', function(){
        R.P.style = this.value; saveP(R.P); wake(); });
    panel.querySelector('#gl-lab').addEventListener('change', function(){
        R.P.lab = parseFloat(this.value); saveP(R.P); wake(); });
    panel.querySelector('#gl-con').addEventListener('change', function(){
        R.P.con = this.value; saveP(R.P);
        R.G = buildModel(R.P); buildOrder();
        R.alpha = 1;
        for(var i = 0; i < 60; i++) tick();
        for(var j = 0; j < R.G.n; j++){ R.G.qx[j] = R.G.px[j]; R.G.qy[j] = R.G.py[j]; }
        clearSel(); fit();
    });
    [['gl-ec', 'eC'], ['gl-ef', 'eF'], ['gl-er', 'eR'], ['gl-arrow', 'arrow']].forEach(function(pr){
        panel.querySelector('#' + pr[0]).addEventListener('change', function(){
            R.P[pr[1]] = this.checked; saveP(R.P); wake(); });
    });
    panel.querySelector('#gl-reset').addEventListener('click', function(){
        try{ localStorage.removeItem(LS_KEY); }catch(_){ }
        R.P = loadP();
        panel.innerHTML = panelHTML(); bindPanel();
        R.stateEl = panel.querySelector('#gl-state');
        R.G = buildModel(R.P); buildOrder();
        R.alpha = 1; clearSel(); fit();
    });
    R.stateEl = panel.querySelector('#gl-state');
}
function buildOrder(){
    var g = R.G, order = [];
    for(var i = 0; i < g.n; i++) order.push(i);
    order.sort(function(a, b){ return g.deg[b] - g.deg[a]; });
    R.order = order;
}

/* ═══════════════ mount / unmount ═══════════════ */
function mount(screen){
    unmount();
    var P = loadP();
    var ui = buildUI(screen);
    R = {
        P: P, screen: screen, stage: ui.stage, cv: ui.cv, ctx: ui.cv.getContext('2d'),
        labelsEl: ui.labelsEl, hint: ui.hint, legend: ui.legend, card: ui.card,
        panel: ui.panel, picker: ui.picker, nodein: ui.nodein, file: ui.file,
        bExplore: ui.bExplore, bMaker: ui.bMaker,
        selbarUI: { rename: ui.bRename, link: ui.bLink, del: ui.bDelete },
        colCtx: document.createElement('canvas').getContext('2d'),
        cam: { s: 1, tx: 0, ty: 0 }, pts: new Map(), pinch: null, panning: false,
        moved: 0, dragI: -1, hoverI: -1, sel: -1, nbr: null,
        mkSel: -1, mkHover: -1, mkDragI: -1, rubber: null, editI: -1, mkUndo: [],
        lastTap: null, linkFrom: -1, selbar: null, searchSet: null,
        alpha: 1, alphaTarget: 0, paused: false,
        raf: 0, running: false, lastT: 0, hot: performance.now(),
        pool: [], listeners: [], obs: null, stateEl: null,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        MK: null, G: null, order: []
    };
    R.MK = mkLoad();
    for(var pi = 0; pi < 84; pi++){
        var d = el('div', 'gl-lb');
        R.labelsEl.appendChild(d); R.pool.push(d);
    }
    // 캔버스 크기
    function resize(){
        if(!R) return;
        var w = R.stage.clientWidth, h = R.stage.clientHeight;
        R.cv.width = w * R.dpr; R.cv.height = h * R.dpr;
        wake();
    }
    resize();
    // 모델 + 워밍업(첫 페인트 전 동기 — reduce면 완전 수렴)
    R.G = buildModel(P); buildOrder();
    var warm = reduce ? 320 : 80;
    R.alpha = 1;
    for(var i = 0; i < warm; i++) tick();
    for(var j = 0; j < R.G.n; j++){ R.G.qx[j] = R.G.px[j]; R.G.qy[j] = R.G.py[j]; }

    // 리스너 (전부 기록해 unmount에서 회수)
    function on(target, type, fn, opts){
        target.addEventListener(type, fn, opts);
        R.listeners.push([target, type, fn, opts]);
    }
    on(R.cv, 'pointerdown', onDown);
    on(R.cv, 'pointermove', onMove);
    on(R.cv, 'pointerup', onUp);
    on(R.cv, 'pointercancel', onUp);
    on(R.cv, 'wheel', onWheel, { passive: false });
    on(R.cv, 'dblclick', onDbl);
    on(document, 'keydown', onKey);
    on(window, 'resize', function(){ resize(); fit(); });
    ui.bFit.onclick = fit;
    ui.bPause.onclick = function(){
        R.paused = !R.paused;
        this.classList.toggle('on', R.paused);
        this.title = STR(R.paused ? 'glResume' : 'glPause');
        wake();
    };
    ui.bGear.onclick = function(){ R.panel.classList.toggle('open'); clearSel(); };
    ui.bExplore.onclick = function(){ setMode('explore'); };
    ui.bMaker.onclick = function(){ setMode('maker'); };
    ui.bUndo.onclick = function(){
        var s = R.mkUndo.pop();
        if(s){ R.MK = JSON.parse(s); R.mkSel = -1; mkSave(); }
    };
    // 검색 스포트라이트 — 제목·개념 일치 노드만 깨어나고 나머지는 가라앉는다.
    // Enter는 첫 일치로 점프(선택+이동), Esc·비우기는 해제.
    on(ui.search, 'input', function(){
        var q = this.value.trim().toLowerCase();
        if(q.length < 2){ R.searchSet = null; wake(); return; }
        var set = new Set(), g = R.G;
        for(var i = 0; i < g.n; i++){
            if(g.meta[i].title.toLowerCase().indexOf(q) >= 0
            || g.meta[i].id.toLowerCase().indexOf(q) >= 0) set.add(i);
        }
        R.searchSet = set; wake();
    });
    on(ui.search, 'keydown', function(ev){
        ev.stopPropagation();
        if(ev.key === 'Escape'){ this.value = ''; R.searchSet = null; this.blur(); wake(); }
        if(ev.key === 'Enter' && R.searchSet && R.searchSet.size){
            var first = -1, bd = -1;
            R.searchSet.forEach(function(i){ if(R.G.deg[i] > bd){ bd = R.G.deg[i]; first = i; } });
            if(first >= 0){ select(first); panTo(first); }
        }
    });
    R.selbar = ui.selbar;
    ui.bRename.onclick = function(){ if(R.mkSel >= 0){ R.selbar.classList.remove('on'); editLabel(R.mkSel); } };
    ui.bLink.onclick = function(){
        if(R.mkSel < 0) return;
        R.linkFrom = R.mkSel; R.selbar.classList.remove('on');
        R.hint.firstChild.textContent = STR('mkLinkHint');   // "연결할 노드를 탭하세요"
        R.hint.classList.add('on');
        wake();
    };
    ui.bDelete.onclick = mkDeleteSel;
    ui.bExport.onclick = mkExport;
    ui.bImport.onclick = function(){ R.file.click(); };
    R.file.addEventListener('change', function(){
        if(this.files && this.files[0]) mkImport(this.files[0]);
        this.value = '';
    });
    on(R.nodein, 'keydown', function(ev){
        // 한글 IME 조합 중의 Enter는 글자 확정이지 입력 완료가 아니다 —
        // 이걸 안 거르면 마지막 글자가 잘린 채 커밋된다.
        if(ev.isComposing || ev.keyCode === 229){ ev.stopPropagation(); return; }
        if(ev.key === 'Enter') commitLabel();
        if(ev.key === 'Escape'){
            R.nodein.style.display = 'none';
            if(R.editI >= 0 && !R.MK.nodes[R.editI].label){ R.MK.nodes.splice(R.editI, 1); mkSave(); }
            R.editI = -1;
        }
        ev.stopPropagation();
    });
    on(R.nodein, 'blur', commitLabel);
    // 테마 변경 감시 — 색은 프레임마다 재읽지만, idle이면 rAF가 죽어 있으니 깨워야 한다
    R.obs = new MutationObserver(wake);
    R.obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    bindPanel();
    setMode(P.mode === 'maker' ? 'maker' : 'explore');
    wake();
}
function unmount(){
    if(!R) return;
    cancelAnimationFrame(R.raf);
    R.listeners.forEach(function(l){ l[0].removeEventListener(l[1], l[2], l[3]); });
    if(R.obs) R.obs.disconnect();
    document.body.classList.remove('gl-maker');
    if(R.stage && R.stage.parentNode) R.stage.parentNode.removeChild(R.stage);
    R = null;
}

/* ═══════════════ 화면 셸 (라우터가 부른다) ═══════════════ */
// KNOWLEDGE가 아직 안 왔으면 인덱스 로딩 프라미스를 기다린다(app.js __loadKnowledge).
window.showGraphLab = function(){
    setArticle(
        '<div class="gl-screen">'
      +   '<div class="gl-top">'
      +     '<h2 class="gl-head">◈ ' + escapeHtml(STR('glTitle')) + '</h2>'
      +     '<p class="gl-sub" id="gl-sub">' + escapeHtml(STR('glSub')) + '</p>'
      +   '</div>'
      + '</div>');
    var screen = document.querySelector('.gl-screen');
    (window.__loadKnowledge || Promise.resolve()).then(function(){
        if(!screen || !screen.isConnected) return;   // 그 사이 다른 화면으로 갔다
        GraphLive.mount(screen);
    });
};

window.GraphLive = { mount: mount, unmount: unmount };
})();
