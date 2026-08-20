// Theme toggle.
// The light (day) theme is the default. The switch in the sidebar footer
// toggles a `day` class on <body>: checked = day (light), unchecked = dark.
// The choice is remembered in the same localStorage settings blob.
//
// 클래스를 뒤집는 일 자체는 즉시 끝난다. 시간이 걸리는 것은 그 전환을 실어 나르는
// 먹이다(아래). 애니메이션을 거는 지점은 이 파일 하나뿐이다 — index.html의 조기 적용
// IIFE와 app.js의 applySettings()도 같은 클래스를 건드리지만, 그쪽은 새로고침·설정
// 저장 경로라 사용자가 스위치를 누른 것이 아니므로 즉시 전환이어야 한다.
function nightDayHandler(target){
    var isDay = target.checked;
    themeInk(isDay, function(){ document.body.classList.toggle('day', isDay); });
    try{
        var s = JSON.parse(localStorage.getItem('wikiSettings')) || {};
        s.theme = isDay ? 'day' : 'night';
        localStorage.setItem('wikiSettings', JSON.stringify(s));
    }catch(e){}
}

// ---- 테마 전환의 먹 번짐 ----
// 페이지를 캔버스로 떠오지 않는다. 옛 --bg 색 한 겹을 화면에 덮고 그 아래에서 테마를
// 즉시 바꾼 뒤, 그 겹을 먹이 번지듯 파내면 이미 바뀐 새 테마가 드러난다 — 그래서
// 크롬 전용 실험 API(html-in-canvas) 없이도 전 브라우저에서 같게 돈다.
// 지우개는 검색 화면 커서 자취와 같은 난류 마스크(style.css의 --ink-erase)다.
var THEME_FX = { mask: null, ready: false, busy: false };

// 설정값. 사이트 기본(config.json → SITE_DEFAULTS)을 개인 저장값이 덮는다.
// app.js에 의존하지 않도록 localStorage를 직접 읽는다(로드 순서 무관).
function themeFxOpts(){
    var s = {}, d = window.SITE_DEFAULTS || {};
    try{ s = JSON.parse(localStorage.getItem('wikiSettings')) || {}; }catch(e){}
    function pick(k, dflt){
        if(s[k] !== undefined){ return s[k]; }
        if(d[k] !== undefined){ return d[k]; }
        return dflt;
    }
    var ms = parseInt(pick('themeFxMs', 750), 10);
    if(isNaN(ms)){ ms = 750; }
    return { mode: pick('themeFx', 'ink') === 'off' ? 'off' : 'ink',
             ms: Math.max(400, Math.min(1400, ms)),
             both: pick('themeFxBoth', true) !== false };
}

// 마스크를 SVG <img>로 두고 매 프레임 그리면 크롬이 그때마다 feTurbulence를 다시
// 래스터한다 — 검색 화면이 5fps로 떨어졌던 그 라이브 필터다. 한가할 때 일반 캔버스에
// 한 번 구워 두고, 이후엔 캔버스끼리만 블릿한다(필터 재평가 0). 1024²라 4MB쯤 잡으므로
// 효과를 끈 사람·모션 최소화를 켠 사람에게는 굽지 않는다.
function themeFxBake(){
    if(THEME_FX.mask){ return; }
    if(themeFxOpts().mode === 'off'){ return; }
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){ return; }
    var host = document.getElementById('theme-switch');
    if(!host){ return; }
    var raw = getComputedStyle(host).getPropertyValue('--ink-erase').trim();
    var m = /^url\(\s*"?([\s\S]*?)"?\s*\)$/.exec(raw);
    if(!m){ return; }
    var S = 1024, c = document.createElement('canvas');
    c.width = c.height = S;
    var cx = c.getContext('2d');
    if(!cx){ return; }
    var img = new Image();
    img.onload = function(){
        cx.drawImage(img, 0, 0, S, S);
        THEME_FX.mask = c;
        THEME_FX.ready = true;
    };
    img.src = m[1];
}

// 확대된 마스크를 그대로 그리면 화면 밖까지 래스터해 비용이 폭발한다(실측 10fps).
// 보이는 만큼만 — 소스 부분사각형을 계산해 뷰포트로 잘라 그린다. R이 커질수록 소스
// 영역이 작아지므로 프레임 비용이 화면 면적 이상으로는 절대 늘지 않는다.
function themeFxBlit(g, img, cx, cy, R, W, H){
    var x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R);
    var x1 = Math.min(W, cx + R), y1 = Math.min(H, cy + R);
    if(x1 <= x0 || y1 <= y0){ return; }
    var k = (img.width || img.naturalWidth) / (R * 2);
    var sw = (x1 - x0) * k, sh = (y1 - y0) * k;
    if(sw <= 0 || sh <= 0){ return; }
    g.drawImage(img, (x0 - cx + R) * k, (y0 - cy + R) * k, sw, sh,
                     x0, y0, x1 - x0, y1 - y0);
}

// 젖은 테두리용 고리 — 마스크를 accent로 물들인 뒤 안쪽을 파낸다. 실제 먹도 번짐의
// 끝에서 안료가 몰려 진해진다. 색이 새 테마 값이라 전환마다 한 번 굽는다.
function themeFxRim(img, color, size){
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, size, size);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, size, size);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(img, size * 0.10, size * 0.10, size * 0.80, size * 0.80);
    return c;
}

// toDay: 이제부터 낮인가. flip: 실제로 클래스를 뒤집는 함수(반드시 한 번 호출된다).
function themeInk(toDay, flip){
    var o = themeFxOpts();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = window.innerWidth, H = window.innerHeight;
    // 양방향이 꺼져 있으면 밤 → 낮으로 갈 때만 번진다.
    if(o.mode === 'off' || reduce || THEME_FX.busy || !THEME_FX.ready
       || (!o.both && !toDay) || !W || !H){
        flip(); return;
    }
    var cv = document.createElement('canvas');
    cv.id = 'theme-fx';
    cv.setAttribute('aria-hidden', 'true');
    var eff = Math.min(window.devicePixelRatio || 1, 2) * 0.5;   // 먹은 본래 흐리다
    cv.width = Math.max(1, Math.round(W * eff));
    cv.height = Math.max(1, Math.round(H * eff));
    var ctx = cv.getContext('2d');
    var hole = document.createElement('canvas');
    hole.width = cv.width; hole.height = cv.height;
    var hx = hole.getContext('2d');
    if(!ctx || !hx){ flip(); return; }
    hx.setTransform(eff, 0, 0, eff, 0, 0);

    // 옛 배경색은 반드시 뒤집기 '전에' 읽는다.
    var oldBg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    if(!oldBg){ flip(); return; }
    // 번짐은 누른 자리에서 시작한다. 사이드바가 접혀 있으면 화면 중앙에서.
    var host = document.getElementById('theme-switch');
    var r = host ? host.getBoundingClientRect() : null;
    var ox = (r && r.width) ? r.left + r.width / 2 : W / 2;
    var oy = (r && r.height) ? r.top + r.height / 2 : H / 2;
    var diag = Math.sqrt(W * W + H * H);
    // 마스크 알파가 바깥에서 0이라 전선이 화면 모서리를 '지나가야' 그 자리가 마른다.
    var RMAX = diag * 1.5;
    var far = Math.max(Math.sqrt(ox * ox + oy * oy), Math.sqrt((W - ox) * (W - ox) + oy * oy),
                       Math.sqrt(ox * ox + (H - oy) * (H - oy)),
                       Math.sqrt((W - ox) * (W - ox) + (H - oy) * (H - oy)));
    var ink = THEME_FX.mask;

    THEME_FX.busy = true;
    document.body.appendChild(cv);
    flip();                                   /* 아래에서 테마는 이미 바뀐다 */
    var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#888';
    var rim = themeFxRim(ink, accent, 512);
    var t0 = 0, prev = 0;

    requestAnimationFrame(function frame(now){
        if(!cv.isConnected){ THEME_FX.busy = false; return; }
        if(!t0){ t0 = prev = now; }
        var p = Math.min(1, (now - t0) / o.ms);
        var dt = Math.min(50, Math.max(4, now - prev)); prev = now;
        // p^0.95면 처음부터 먹이 트고, 전선이 모서리에 닿는 게 ≈0.73, 다 마르는 게
        // ≈0.96으로 진행이 길이 전체에 퍼진다.
        var R = Math.pow(p, 0.95) * RMAX;

        // ① 구멍을 누적한다 — 지운 자리를 되돌리지 않으므로 중심은 금세 완전히 젖고
        //    전선은 옅게 남는다. 프레임 시간으로 정규화해 길이·프레임률이 달라도 같게
        //    스미고, 뒤로 갈수록 진하게(1+5p³) 해 끝에 모서리까지 확실히 마른다.
        hx.globalCompositeOperation = 'source-over';
        hx.globalAlpha = Math.min(1, dt / 16.7 * 0.5 * (1 + 5 * p * p * p));
        themeFxBlit(hx, ink, ox, oy, R, W, H);

        // ② 아직 마르지 않은 종이 + 젖은 테두리. 불투명이라 clearRect가 필요 없다.
        ctx.setTransform(eff, 0, 0, eff, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = oldBg;
        ctx.fillRect(0, 0, W, H);
        if(R * 1.03 * 0.8 < far){        /* 고리가 화면을 다 지나가면 그릴 것이 없다 */
            ctx.globalAlpha = 0.8 * (1 - p * 0.4);
            themeFxBlit(ctx, rim, ox, oy, R * 1.03, W, H);
        }

        // ③ 누적한 구멍으로 파낸다 — 경계가 스트로크가 아니라 마스크 알파라
        //    자를 곳이 없다. 이게 "먹이 스민" 느낌의 전부다.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(hole, 0, 0);

        if(p < 1){ requestAnimationFrame(frame); }
        else{
            if(cv.parentNode){ cv.parentNode.removeChild(cv); }
            THEME_FX.busy = false;
        }
    });
}

// 마스크는 첫 전환 전에 준비돼 있어야 하지만 로드와 경쟁하면 안 된다 — 한가할 때 굽는다.
(function(){
    var idle = window.requestIdleCallback || function(f){ return setTimeout(f, 1500); };
    function go(){ idle(themeFxBake); }
    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', go);
    }else{ go(); }
})();
