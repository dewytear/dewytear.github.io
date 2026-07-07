// games.js — 검색 화면 미니게임: 패들 물리 · gameStage · SEARCH_GAMES 5종(2048 포함).
// index.html에서 추출 (동작 불변 이동). 검색 UI DOM 접근은 App.searchDock 계약으로,
// 색은 테마 토큰(gvToHsl)으로. 로드 순서: cosmos.js 이후(gvToHsl), app 부트 이전.
// ---- Search-field paddle drag ----
// The field doubles as the Breakout paddle: grab it and slide left or
// right. Click-to-focus and typing stay untouched — the drag only
// engages after a clear horizontal pull (8px, more X than Y), and the
// field glides back to center when you start typing.
function paddleReset(){
    var field = document.querySelector('.search-field');
    // Mid-drag searches (e.g. the concept-catch game auto-searching a
    // caught word) must not yank the paddle out of the player's hand.
    if(field && field.classList.contains('dragging')){ return; }
    if(field && field.style.transform){
        field.classList.add('paddle-home');
        field.style.transform = '';
        setTimeout(function(){ field.classList.remove('paddle-home'); }, 320);
    }
}
// ---- Orientation-change re-measure ----
// iOS Safari fires 'resize' during a rotation while layout metrics are
// still the pre-rotation values; each game measures the container once
// per resize and can bake a stale (landscape) width into its canvas,
// leaving the portrait page wider than the viewport (content shifts
// left, empty gap on the right). After a rotation, re-run the measure
// once layout has settled, and drop any stale paddle drag offset. The
// CSS `overflow-x: clip` guard hides the symptom; this fixes the cause
// for the canvas games (accurate re-measure).
(function(){
    function remeasure(){
        paddleReset();
        window.dispatchEvent(new Event('resize'));   // re-run each game's own resize()
    }
    function onRotate(){
        // Double rAF catches the next painted frame; the delayed pass
        // covers iOS still settling viewport metrics after the rotation.
        requestAnimationFrame(function(){ requestAnimationFrame(remeasure); });
        setTimeout(remeasure, 300);
    }
    window.addEventListener('orientationchange', onRotate);
})();

function enableSearchPaddle(){
    var field = document.querySelector('.search-field');
    var screen = document.querySelector('.search-screen');
    if(!field || !screen){ return; }
    var drag = null, offset = 0;
    function clampBound(){
        var room = (screen.getBoundingClientRect().width - field.offsetWidth) / 2 - 12;
        return Math.max(0, room);
    }
    field.addEventListener('pointerdown', function(e){
        if(e.button !== undefined && e.button !== 0){ return; }
        drag = { startX: e.clientX, startY: e.clientY, base: offset, on: false, id: e.pointerId };
    });
    field.addEventListener('pointermove', function(e){
        if(!drag){ return; }
        var mx = e.clientX - drag.startX, my = e.clientY - drag.startY;
        if(!drag.on){
            if(Math.abs(mx) < 8 || Math.abs(mx) <= Math.abs(my)){ return; }
            drag.on = true;   // a real horizontal pull — engage the paddle
            field.classList.add('dragging');
            try{ field.setPointerCapture(drag.id); }catch(err){}
        }
        var b = clampBound();
        offset = Math.max(-b, Math.min(b, drag.base + mx));
        field.style.transform = offset ? 'translateX(' + offset + 'px)' : '';
        e.preventDefault();
    });
    function endDrag(){
        if(drag && drag.on){ field.classList.remove('dragging'); }
        drag = null;
    }
    field.addEventListener('pointerup', endDrag);
    field.addEventListener('pointercancel', endDrag);
}

// ---- Search-screen mini games ----
// Four calm, decorative games share the canvas behind the search
// field; Settings(searchGame) picks which one runs. Every game
// self-terminates once its canvas leaves the DOM (no loop leaks)
// and all are skipped for reduced motion.
var SEARCH_GAME_ACTIVE = '';
// Which game to run: the visitor's own pick (stored per browser)
// wins; the owner's Settings choice is the default for new visitors.
function currentGameMode(){
    var pick = '';
    try{ pick = localStorage.getItem('wikiGamePick') || ''; }catch(e){}
    var mode = pick || effSettings().searchGame || 'g2048';
    return SEARCH_GAMES[mode] ? mode : 'g2048';
}
function startSearchGame(){
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){ return; }
    var canvas = document.querySelector('.search-game');
    if(!canvas || !canvas.getContext){ return; }
    // Tear down a previous 2048 board (DOM game, not on the canvas) so
    // switching games doesn't leave its board or key listeners behind.
    var stale = document.querySelector('.g2048');
    if(stale){ if(stale._cleanup){ stale._cleanup(); } stale.remove(); }
    var mode = currentGameMode();
    var screen = document.querySelector('.search-screen');
    if(screen){ screen.classList.toggle('g2048-on', mode === 'g2048'); }
    SEARCH_GAME_ACTIVE = mode;
    SEARCH_GAMES[mode](canvas);
    markGameDock(mode);
}
// Visitor-facing switcher: swap the game in place. The old canvas is
// replaced by a fresh clone, so the old loop sees isConnected=false
// and stops itself; the picked game starts on the new canvas.
function switchSearchGame(el){
    var mode = el.getAttribute('data-g');
    if(!SEARCH_GAMES[mode]){ return; }
    try{ localStorage.setItem('wikiGamePick', mode); }catch(e){}
    // Concept-catch fills the field as you play; switching games must
    // start clean so that query doesn't carry over (and 2048 doesn't
    // open in watermark mode). Clear the box, results, and the state.
    var box = document.getElementById('search-input');
    if(box && box.value){
        box.value = '';
        if(typeof renderSearchResults === 'function'){ renderSearchResults(''); }
    }
    var scr = document.querySelector('.search-screen');
    if(scr){ scr.classList.remove('searching'); }
    var old = document.querySelector('.search-game');
    if(old){
        var fresh = old.cloneNode(false);
        old.parentNode.replaceChild(fresh, old);
    }
    startSearchGame();
}
function markGameDock(mode){
    document.querySelectorAll('.game-dock button').forEach(function(b){
        b.classList.toggle('on', b.getAttribute('data-g') === mode);
    });
}

// Shared stage for the newer games: HiDPI sizing, self-termination,
// theme color and the live paddle (search field) box.
function gameStage(canvas){
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var st = { ctx: ctx, W: 0, H: 0, onResize: null };
    function resize(){
        // Size to the positioned ancestor (the absolute canvas's real
        // containing block) — in search view that's the whole card,
        // so the game field reaches up behind the title.
        var box = canvas.offsetParent || canvas.parentNode;
        var rect = box.getBoundingClientRect();
        st.W = rect.width; st.H = rect.height;
        canvas.width = st.W * dpr; canvas.height = st.H * dpr;
        canvas.style.width = st.W + 'px'; canvas.style.height = st.H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if(st.onResize){ st.onResize(); }
    }
    st.gone = function(){
        if(!canvas.isConnected){
            window.removeEventListener('resize', resize);
            if(ro){ ro.disconnect(); }
            return true;
        }
        return false;
    };
    st.accent = function(){
        return (getComputedStyle(document.body).getPropertyValue('--accent') || '#ff6600').trim();
    };
    st.paddle = function(){
        var field = document.querySelector('.search-field');
        if(!field){ return null; }
        var cr = canvas.getBoundingClientRect(), fr = field.getBoundingClientRect();
        return { x: fr.left - cr.left, y: fr.top - cr.top, w: fr.width, h: fr.height };
    };
    window.addEventListener('resize', resize);
    // The stage also grows without a window resize — search results
    // stretch the card — so track the containing block itself.
    var ro = null;
    if(window.ResizeObserver){
        ro = new ResizeObserver(resize);
        ro.observe(canvas.offsetParent || canvas.parentNode);
    }
    resize();
    return st;
}
var GAME_FONT = '"Pretendard Variable", Pretendard, sans-serif';
// Per-game best for THIS session only — reset on reload (no storage),
// per the "리셋 전까지의 기록" spec. Score itself stays a faint watermark.
var GAME_BEST = {};
function gameBestUpdate(mode, score){
    if(GAME_BEST[mode] == null || score > GAME_BEST[mode]){ GAME_BEST[mode] = score; }
    return GAME_BEST[mode] || 0;
}
// Draw the faint Score watermark (existing style) plus a smaller BEST
// under it, in the game's accent color. Used by every canvas game.
// Y for the big score watermark: vertically centered in the empty band
// between the top masthead title and the search heading, so it never
// collides with either (esp. short landscape). Falls back to 0.42H.
function gameWatermarkY(ctx, H){
    var y = H * 0.42;
    var mh = document.querySelector('#masthead');
    var sc = document.querySelector('.search-core');
    if(mh && sc){
        var cr = ctx.canvas.getBoundingClientRect();
        var mb = mh.getBoundingClientRect().bottom - cr.top;
        var stop = sc.getBoundingClientRect().top - cr.top;
        if(stop > mb){ y = (mb + stop) / 2; }
    }
    return y;
}
function drawScoreBest(ctx, W, H, col, mode, score){
    var best = gameBestUpdate(mode, score);
    var y = gameWatermarkY(ctx, H);
    var sw = 0;
    if(score > 0){
        ctx.globalAlpha = 0.08; ctx.fillStyle = col;
        ctx.font = '800 120px ' + GAME_FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(score, W / 2, y);
        sw = ctx.measureText(String(score)).width;
    }
    if(best > 0){
        ctx.globalAlpha = 0.22; ctx.fillStyle = col;
        ctx.font = '800 15px ' + GAME_FONT;
        // Same line, right of the score, baseline aligned to the score's
        // bottom (≈ +0.36·fontSize below the middle baseline).
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(STR('gameBest') + ' ' + best, W / 2 + sw / 2 + 12, y + 120 * 0.36);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    }
    ctx.globalAlpha = 1;
}
// Reflect a ball out of an axis-aligned rect; returns true on hit.
function reflectBall(ball, rx, ry, rw, rh){
    if(ball.x + ball.r < rx || ball.x - ball.r > rx + rw ||
       ball.y + ball.r < ry || ball.y - ball.r > ry + rh){ return false; }
    var overL = (ball.x + ball.r) - rx, overR = (rx + rw) - (ball.x - ball.r);
    var overT = (ball.y + ball.r) - ry, overB = (ry + rh) - (ball.y - ball.r);
    if(Math.min(overL, overR) < Math.min(overT, overB)){
        ball.vx = overL < overR ? -Math.abs(ball.vx) : Math.abs(ball.vx);
    } else {
        ball.vy = overT < overB ? -Math.abs(ball.vy) : Math.abs(ball.vy);
    }
    return true;
}
// Paddle "english": where the ball lands on the paddle steers it.
function paddleEnglish(ball, p){
    var t = (ball.x - (p.x + p.w / 2)) / (p.w / 2);
    t = Math.max(-1, Math.min(1, t));
    var sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    ball.vx = sp * 0.75 * t;
    ball.vy = -Math.sqrt(Math.max(sp * sp - ball.vx * ball.vx, sp * sp * 0.2));
}
function drawBallTrail(ctx, col, ball, trail){
    trail.push({ x: ball.x, y: ball.y });
    if(trail.length > 12){ trail.shift(); }
    for(var t = 0; t < trail.length; t++){
        ctx.globalAlpha = (t / trail.length) * 0.22;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(trail[t].x, trail[t].y, ball.r * (0.4 + 0.5 * t / trail.length), 0, 6.2832);
        ctx.fill();
    }
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
}

var SEARCH_GAMES = {};

// ① 벽돌깨기 (기본) — the original calm Breakout.
SEARCH_GAMES.breakout = function(canvas){
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, bricks = [], ball, trail = [], broken = 0;

    function accent(){
        return (getComputedStyle(document.body).getPropertyValue('--accent') || '#ff6600').trim();
    }
    function layoutBricks(){
        bricks = [];
        var cols = Math.max(6, Math.floor(W / 96));
        var rows = 3, pad = 12;
        var bw = (W - pad * (cols + 1)) / cols, bh = 15;
        var top = Math.max(46, H * 0.13);
        for(var r = 0; r < rows; r++){
            for(var c = 0; c < cols; c++){
                bricks.push({ x: pad + c * (bw + pad), y: top + r * (bh + pad),
                              w: bw, h: bh, alive: true, flash: 0 });
            }
        }
    }
    function resetBall(){
        var sp = Math.max(2.4, W / 520);
        var dir = Math.random() < 0.5 ? -1 : 1;
        ball = { x: W / 2, y: H * 0.62, vx: sp * 0.8 * dir, vy: -sp, r: Math.max(5, W / 240) };
        ball.sp0 = Math.hypot(ball.vx, ball.vy);   // base speed for the time ramp
        ball.born = performance.now();
    }
    function resize(){
        // Positioned ancestor = the search backdrop's containing
        // block — in search view that's the whole card.
        var box = canvas.offsetParent || canvas.parentNode;
        var rect = box.getBoundingClientRect();
        W = rect.width; H = rect.height;
        canvas.width = W * dpr; canvas.height = H * dpr;
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layoutBricks();
        if(!ball || ball.x > W || ball.y > H){ resetBall(); }
    }
    // Reflect the ball out of an axis-aligned rect; returns true on hit.
    function bounce(rx, ry, rw, rh){
        if(ball.x + ball.r < rx || ball.x - ball.r > rx + rw ||
           ball.y + ball.r < ry || ball.y - ball.r > ry + rh){ return false; }
        var overL = (ball.x + ball.r) - rx, overR = (rx + rw) - (ball.x - ball.r);
        var overT = (ball.y + ball.r) - ry, overB = (ry + rh) - (ball.y - ball.r);
        var minX = Math.min(overL, overR), minY = Math.min(overT, overB);
        if(minX < minY){
            ball.vx = overL < overR ? -Math.abs(ball.vx) : Math.abs(ball.vx);
        } else {
            ball.vy = overT < overB ? -Math.abs(ball.vy) : Math.abs(ball.vy);
        }
        return true;
    }
    resize();
    resetBall();
    window.addEventListener('resize', resize);
    // Follow the card when it grows without a window resize
    // (search results stretching the pane).
    var ro = null;
    if(window.ResizeObserver){
        ro = new ResizeObserver(resize);
        ro.observe(canvas.offsetParent || canvas.parentNode);
    }

    function frame(){
        if(!canvas.isConnected){
            window.removeEventListener('resize', resize);
            if(ro){ ro.disconnect(); }
            return;
        }
        ctx.clearRect(0, 0, W, H);
        var col = accent();

        // Gentle time ramp: +60% speed over ~90s, then hold.
        var target = ball.sp0 * (1 + Math.min(0.6,
            (performance.now() - ball.born) / 90000 * 0.6));
        var cur = Math.hypot(ball.vx, ball.vy);
        if(cur > 0){ ball.vx *= target / cur; ball.vy *= target / cur; }

        ball.x += ball.vx; ball.y += ball.vy;
        if(ball.x - ball.r < 0){ ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
        if(ball.x + ball.r > W){ ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
        if(ball.y - ball.r < 0){ ball.y = ball.r; ball.vy = Math.abs(ball.vy); }
        if(ball.y + ball.r > H){ ball.y = H - ball.r; ball.vy = -Math.abs(ball.vy); }

        // The search field is the paddle. Like real Breakout, WHERE
        // the ball lands on the paddle steers it: center = straight
        // up, edges = sharp angles ("english"). Each bounce keeps the
        // magnitude; only the time ramp above changes it.
        var field = document.querySelector('.search-field');
        if(field){
            var cr = canvas.getBoundingClientRect(), fr = field.getBoundingClientRect();
            var px = fr.left - cr.left, py = fr.top - cr.top;
            if(bounce(px, py, fr.width, fr.height) && ball.vy < 0){
                var t = (ball.x - (px + fr.width / 2)) / (fr.width / 2);
                t = Math.max(-1, Math.min(1, t));
                var sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                ball.vx = sp * 0.75 * t;
                ball.vy = -Math.sqrt(Math.max(sp * sp - ball.vx * ball.vx,
                                              sp * sp * 0.2));
            }
        }

        var anyAlive = false;
        for(var i = 0; i < bricks.length; i++){
            var b = bricks[i];
            if(b.flash > 0){ b.flash -= 0.06; }
            if(b.alive){
                anyAlive = true;
                if(bounce(b.x, b.y, b.w, b.h)){ b.alive = false; b.flash = 1; broken++; }
            }
            if(b.alive || b.flash > 0){
                ctx.globalAlpha = b.alive ? 0.15 : Math.max(0, b.flash) * 0.4;
                ctx.fillStyle = col;
                var pop = b.alive ? 0 : (1 - b.flash) * 4;
                roundRect(ctx, b.x - pop, b.y - pop, b.w + pop * 2, b.h + pop * 2, 4);
                ctx.fill();
            }
        }
        if(!anyAlive){ layoutBricks(); }

        drawScoreBest(ctx, W, H, col, 'breakout', broken);

        // Trail + ball.
        trail.push({ x: ball.x, y: ball.y });
        if(trail.length > 12){ trail.shift(); }
        for(var t = 0; t < trail.length; t++){
            ctx.globalAlpha = (t / trail.length) * 0.22;
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.arc(trail[t].x, trail[t].y, ball.r * (0.4 + 0.5 * t / trail.length), 0, 6.2832);
            ctx.fill();
        }
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, 6.2832);
        ctx.fill();
        ctx.globalAlpha = 1;

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

// ② 개념 별똥별 받기 — concepts from the knowledge index drift down;
// catch one with the paddle and it searches itself. Play = explore.
SEARCH_GAMES.concept = function(canvas){
    var st = gameStage(canvas);
    var FALLBACK = ['스킬', '하네스', '오케스트레이터', '서브에이전트',
                    '세컨드브레인', '벡터검색', '지식그래프', 'CLAUDE.md'];
    var words = [], pops = [], lastSpawn = 0, caught = 0;
    function spawn(now){
        var pool = ALL_CONCEPTS.length ? ALL_CONCEPTS : FALLBACK;
        words.push({
            text: pool[Math.floor(Math.random() * pool.length)],
            x: 40 + Math.random() * Math.max(1, st.W - 80),
            y: -16, vy: 0.35 + Math.random() * 0.4,
            sway: Math.random() * 6.2832,
            size: 13 + Math.random() * 6
        });
        lastSpawn = now;
    }
    function frame(now){
        if(st.gone()){ return; }
        var ctx = st.ctx; ctx.clearRect(0, 0, st.W, st.H);
        var col = st.accent();
        if(words.length < 6 && now - lastSpawn > 1500){ spawn(now); }
        var p = st.paddle();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for(var i = words.length - 1; i >= 0; i--){
            var w = words[i];
            w.y += w.vy; w.sway += 0.02;
            var wx = w.x + Math.sin(w.sway) * 14;
            if(p && wx >= p.x - 8 && wx <= p.x + p.w + 8 &&
               w.y >= p.y - 4 && w.y <= p.y + p.h){
                // Caught: pop + search that concept.
                pops.push({ x: wx, y: p.y, r: 6, a: 0.7 });
                caught++;
                var box = document.getElementById('search-input');
                if(box){ box.value = w.text; renderSearchResults(w.text); }
                words.splice(i, 1);
                continue;
            }
            if(w.y - w.size > st.H){ words.splice(i, 1); continue; }
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = col;
            ctx.font = '600 ' + w.size.toFixed(1) + 'px ' + GAME_FONT;
            ctx.fillText(w.text, wx, w.y);
        }
        for(var j = pops.length - 1; j >= 0; j--){
            var q = pops[j];
            q.r += 1.8; q.a -= 0.03;
            if(q.a <= 0){ pops.splice(j, 1); continue; }
            ctx.globalAlpha = q.a;
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.stroke();
        }
        drawScoreBest(ctx, st.W, st.H, col, 'concept', caught);
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

// ③ 퐁 랠리 — an AI paddle up top returns your serves; the faint
// number counts the rally. Miss (either side) and it resets.
SEARCH_GAMES.pong = function(canvas){
    var st = gameStage(canvas);
    var ball = null, trail = [], rally = 0;
    var rampT0 = performance.now();   // speed ramp restarts on a miss
    var ai = { x: 0, y: 54, w: 150, h: 12 };
    function reset(){
        // Twice the Breakout pace — Pong wants snappy rallies.
        var sp = Math.max(4.8, st.W / 260);
        ball = { x: st.W / 2, y: st.H * 0.45,
                 vx: (Math.random() < 0.5 ? -1 : 1) * sp * 0.7,
                 vy: sp, r: Math.max(5, st.W / 240) };
        ball.sp0 = Math.hypot(ball.vx, ball.vy);
        rampT0 = performance.now();
    }
    st.onResize = function(){
        ai.w = Math.max(120, st.W * 0.14);
        if(!ball || ball.x > st.W || ball.y > st.H){ reset(); }
    };
    st.onResize();
    function frame(){
        if(st.gone()){ return; }
        var ctx = st.ctx; ctx.clearRect(0, 0, st.W, st.H);
        var col = st.accent();
        // Gentle rally ramp: +50% speed over ~45s, reset on a miss.
        var ramp = 1 + Math.min(0.5, (performance.now() - rampT0) / 45000 * 0.5);
        var target = ball.sp0 * ramp;
        var cur = Math.hypot(ball.vx, ball.vy);
        if(cur > 0){ ball.vx *= target / cur; ball.vy *= target / cur; }
        // AI tracks the ball with capped speed — keeps up with the
        // faster ball on normal returns but loses sharp-angle shots.
        // Its cap grows with the ramp so long rallies stay winnable
        // for the AI too, just faster for the human.
        var maxV = Math.max(3.4, st.W / 300) * ramp;
        ai.x += Math.max(-maxV, Math.min(maxV, (ball.x - ai.w / 2) - ai.x));
        ai.x = Math.max(8, Math.min(st.W - ai.w - 8, ai.x));
        ball.x += ball.vx; ball.y += ball.vy;
        if(ball.x - ball.r < 0){ ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
        if(ball.x + ball.r > st.W){ ball.x = st.W - ball.r; ball.vx = -Math.abs(ball.vx); }
        if(ball.y - ball.r < 0){ ball.y = ball.r; ball.vy = Math.abs(ball.vy); rally = 0; rampT0 = performance.now(); }
        if(ball.y + ball.r > st.H){ ball.y = st.H - ball.r; ball.vy = -Math.abs(ball.vy); rally = 0; rampT0 = performance.now(); }
        if(reflectBall(ball, ai.x, ai.y, ai.w, ai.h) && ball.vy > 0){ rally++; }
        var p = st.paddle();
        if(p && reflectBall(ball, p.x, p.y, p.w, p.h) && ball.vy < 0){
            paddleEnglish(ball, p); rally++;
        }
        drawScoreBest(ctx, st.W, st.H, col, 'pong', rally);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = col;
        roundRect(ctx, ai.x, ai.y, ai.w, ai.h, 6);
        ctx.fill();
        drawBallTrail(ctx, col, ball, trail);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

// ④ 종이비행기 글라이딩 — click the empty background (or press
// Space/↑ outside the input) to lift the plane through the gates.
// A brush against a gate just fades and restarts; nothing harsh.
SEARCH_GAMES.plane = function(canvas){
    var st = gameStage(canvas);
    var screen = canvas.parentNode;
    var plane, gates, tick, crashed, score, lastGate;
    function reset(){ plane = { x: st.W * 0.28, y: st.H * 0.4, vy: 0 };
                      gates = []; tick = 0; crashed = 0; score = 0; lastGate = 0; }
    reset();
    function flap(){ if(!crashed){ plane.vy = -3.2; } }
    function onDown(e){
        if(!e.target.closest('.search-core') && !e.target.closest('.game-dock')){ flap(); }
    }
    function onKey(e){
        if(e.target && e.target.id === 'search-input'){ return; }
        if(e.code === 'Space' || e.code === 'ArrowUp'){ flap(); e.preventDefault(); }
    }
    screen.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    function frame(){
        if(st.gone()){
            screen.removeEventListener('pointerdown', onDown);
            window.removeEventListener('keydown', onKey);
            return;
        }
        var ctx = st.ctx; ctx.clearRect(0, 0, st.W, st.H);
        var col = st.accent();
        tick++;
        if(crashed > 0){
            crashed--;
            if(crashed === 0){ reset(); }
        } else {
            plane.vy = Math.min(plane.vy + 0.09, 4);
            plane.y += plane.vy;
            if(plane.y < 18){ plane.y = 18; plane.vy = 0; }
            if(plane.y > st.H - 18){ plane.y = st.H - 18; plane.vy = -1; }
            // Gentle survival ramp: +70% scroll speed over ~60s of
            // flight, reset by a crash. Gates spawn by time-distance
            // so their on-screen spacing stays constant as it speeds up.
            var ramp = 1 + Math.min(0.7, tick / 3600 * 0.7);
            if(tick - lastGate >= 170 / ramp){
                var gapH = Math.max(150, st.H * 0.3);
                gates.push({ x: st.W + 40, w: 26, gapH: gapH,
                             gapY: 70 + Math.random() * Math.max(1, st.H - gapH - 160),
                             passed: false });
                lastGate = tick;
            }
            var speed = Math.max(1.4, st.W / 700) * ramp;
            for(var i = gates.length - 1; i >= 0; i--){
                var g = gates[i];
                g.x -= speed;
                if(g.x + g.w < -20){ gates.splice(i, 1); continue; }
                if(plane.x + 11 > g.x && plane.x - 11 < g.x + g.w){
                    if(plane.y < g.gapY || plane.y > g.gapY + g.gapH){ crashed = 40; }
                    else if(!g.passed){ g.passed = true; score++; }
                }
            }
        }
        gates.forEach(function(g){
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = col;
            roundRect(ctx, g.x, -8, g.w, g.gapY + 8, 10); ctx.fill();
            roundRect(ctx, g.x, g.gapY + g.gapH, g.w, st.H - (g.gapY + g.gapH) + 8, 10); ctx.fill();
        });
        drawScoreBest(ctx, st.W, st.H, col, 'plane', score);
        if(tick < 300 && score === 0){
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = col;
            ctx.font = '600 13px ' + GAME_FONT;
            ctx.textAlign = 'center';
            // Same spot the score watermark uses (between the top title
            // and the search heading) — the hint only shows at score 0,
            // the watermark only at score>0, so they never clash.
            ctx.fillText(STR('planeHint'), st.W / 2, gameWatermarkY(st.ctx, st.H));
        }
        // The plane: a folded-paper triangle tilted by its climb rate.
        var ang = Math.max(-0.5, Math.min(0.7, plane.vy * 0.09));
        ctx.save();
        ctx.translate(plane.x, plane.y);
        ctx.rotate(ang);
        ctx.globalAlpha = crashed ? Math.max(0.1, crashed / 40 * 0.7) : 0.7;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(23, 0); ctx.lineTo(-16, -12); ctx.lineTo(-7, 0); ctx.lineTo(-16, 12);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha *= 0.5;
        ctx.strokeStyle = col; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(23, 0); ctx.lineTo(-7, 0); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};
// ⓪ 지식 2048 — merge tiles up THIS wiki's own knowledge ladder
// (태그→개념→…→세컨드 브레인). A real DOM board (crisp labels, theme
// color via --accent alpha so it matches the other ambient games).
// Playable when idle; while a search query is present the board
// recedes to a faint watermark (.search-screen.searching) so it never
// blocks the field. Session-only Best (resets on reload).
var G2048_LADDER = {
    ko: { 2:'태그',4:'개념',8:'노트',16:'문서',32:'볼트',64:'시스템',
          128:'도메인',256:'월드',512:'지식 지도',1024:'지식 그래프',2048:'세컨드 브레인' },
    en: { 2:'Tag',4:'Concept',8:'Note',16:'Document',32:'Vault',64:'System',
          128:'Domain',256:'World',512:'Knowledge Map',1024:'Knowledge Graph',2048:'Second Brain' }
};
SEARCH_GAMES.g2048 = function(canvas){
    var screen = canvas.parentNode;   // .search-screen
    if(!screen){ return; }
    var lang = (typeof currentLang === 'function') ? currentLang() : 'ko';
    var LAB = G2048_LADDER[lang] || G2048_LADDER.en;   // zh/ja → en labels
    var N = 4, score = 0, won = false, over = false, animating = false, nextId = 1;
    var msgKind = null;                    // 'win' | 'over' while the overlay is up
    var SLIDE = 120;                       // ms; matches .g2048-tile transition
    var board = [];                        // board[r][c] = tile | null
    for(var r0 = 0; r0 < N; r0++){ board.push([null, null, null, null]); }
    var tiles = [];                        // live tile objects {id,r,c,val,el,mergedFrom}

    var wrap = document.createElement('div');
    wrap.className = 'g2048';
    var wells = '';
    for(var i = 0; i < N * N; i++){ wells += '<div class="g2048-cell"></div>'; }
    wrap.innerHTML =
        '<div class="g2048-hud">'
      +   '<span class="g2048-score" aria-live="polite">0</span>'
      +   '<span class="g2048-best">' + STR('gameBest') + ' 0</span>'
      +   '<button type="button" class="g2048-new" title="' + STR('g2048New') + '" aria-label="' + STR('g2048New') + '">&#8635;</button>'
      + '</div>'
      + '<div class="g2048-board">' + wells + '</div>'
      + '<div class="g2048-msg" hidden></div>';
    screen.appendChild(wrap);
    var cells = wrap.querySelectorAll('.g2048-cell');
    var scoreEl = wrap.querySelector('.g2048-score');
    var bestEl = wrap.querySelector('.g2048-best');
    var boardEl = wrap.querySelector('.g2048-board');
    var msgEl = wrap.querySelector('.g2048-msg');
    boardEl.appendChild(msgEl);   // overlay lives inside the board so it aligns exactly

    function fmt(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function styleTile(t){
        // Only the value ladder's *strength* (alpha %) is written inline;
        // the actual colors resolve in CSS from theme tokens, so existing
        // tiles follow day/night flips live instead of freezing.
        var idx = Math.round(Math.log(t.val) / Math.LN2);
        var alpha = Math.min(0.30 + 0.065 * (idx - 1), 0.96);
        var inner = t.el.firstChild;
        inner.style.setProperty('--ta', (alpha * 100).toFixed(1) + '%');
        inner.style.setProperty('--tb', (Math.min(alpha + 0.28, 1) * 100).toFixed(1) + '%');
        inner.classList.toggle('hi', alpha > 0.5);
        inner.innerHTML = '<span class="g2048-lab">' + escapeHtml(LAB[t.val] || String(t.val)) + '</span>'
                        + '<span class="g2048-num">' + t.val + '</span>';
    }
    // Position a tile over its background well. Reading the well's own
    // offsets keeps tiles aligned to the grid at any size/gap. animate
    // false → snap (initial paint / resize); true → CSS transition slides.
    function place(t, animate){
        var cell = cells[t.r * N + t.c];
        if(!animate){ t.el.style.transition = 'none'; }
        t.el.style.width = cell.offsetWidth + 'px';
        t.el.style.height = cell.offsetHeight + 'px';
        t.el.style.transform = 'translate(' + cell.offsetLeft + 'px,' + cell.offsetTop + 'px)';
        if(!animate){ void t.el.offsetWidth; t.el.style.transition = ''; }
    }
    function newTile(r, c, val, isNew){
        var el = document.createElement('div');
        el.className = 'g2048-tile';
        el.appendChild(document.createElement('div')).className = 'g2048-tile-inner';
        boardEl.appendChild(el);
        var t = { id: nextId++, r: r, c: c, val: val, el: el, mergedFrom: false };
        styleTile(t); place(t, false);
        tiles.push(t); board[r][c] = t;
        if(isNew){ el.classList.add('spawn'); setTimeout(function(){ el.classList.remove('spawn'); }, 200); }
        return t;
    }
    function spawnTile(){
        var empt = [];
        for(var r = 0; r < N; r++){ for(var c = 0; c < N; c++){ if(!board[r][c]){ empt.push([r, c]); } } }
        if(!empt.length){ return; }
        var p = empt[Math.floor(Math.random() * empt.length)];
        newTile(p[0], p[1], Math.random() < 0.9 ? 2 : 4, true);
    }
    function repositionAll(){ for(var i = 0; i < tiles.length; i++){ place(tiles[i], false); } }

    var VEC = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
    function inB(r, c){ return r >= 0 && r < N && c >= 0 && c < N; }
    function farthest(r, c, v){
        var pr = r, pc = c, nr = r + v[0], nc = c + v[1];
        while(inB(nr, nc) && !board[nr][nc]){ pr = nr; pc = nc; nr += v[0]; nc += v[1]; }
        return { far: [pr, pc], next: inB(nr, nc) ? [nr, nc] : null };
    }
    function movesLeft(){
        for(var r = 0; r < N; r++){ for(var c = 0; c < N; c++){
            var t = board[r][c]; if(!t){ return true; }
            if(c < N - 1 && board[r][c + 1] && board[r][c + 1].val === t.val){ return true; }
            if(r < N - 1 && board[r + 1][c] && board[r + 1][c].val === t.val){ return true; }
        } }
        return false;
    }
    function move(dir){
        if(over || animating || msgKind){ return; }   // overlay up → tap decides first
        var v = VEC[dir], rs = [0, 1, 2, 3], cs2 = [0, 1, 2, 3];
        if(v[0] === 1){ rs = [3, 2, 1, 0]; }
        if(v[1] === 1){ cs2 = [3, 2, 1, 0]; }
        tiles.forEach(function(t){ t.mergedFrom = false; });
        var moved = false, gained = 0, absorbed = [], upgraded = [];
        rs.forEach(function(r){ cs2.forEach(function(c){
            var t = board[r][c]; if(!t){ return; }
            var f = farthest(r, c, v);
            var nt = f.next ? board[f.next[0]][f.next[1]] : null;
            if(nt && nt.val === t.val && !nt.mergedFrom){
                board[r][c] = null; t.r = nt.r; t.c = nt.c; place(t, true); absorbed.push(t);
                nt.val *= 2; nt.mergedFrom = true; upgraded.push(nt);
                score += nt.val; gained += nt.val; if(nt.val === 2048){ won = true; }
                moved = true;
            } else if(f.far[0] !== r || f.far[1] !== c){
                board[r][c] = null; board[f.far[0]][f.far[1]] = t;
                t.r = f.far[0]; t.c = f.far[1]; place(t, true); moved = true;
            }
        }); });
        if(!moved){ return; }
        scoreEl.textContent = fmt(score);
        bestEl.textContent = STR('gameBest') + ' ' + fmt(gameBestUpdate('g2048', score));
        animating = true;
        setTimeout(function(){
            absorbed.forEach(function(t){
                if(t.el.parentNode){ t.el.parentNode.removeChild(t.el); }
                var i = tiles.indexOf(t); if(i >= 0){ tiles.splice(i, 1); }
            });
            upgraded.forEach(function(t){
                styleTile(t); t.el.classList.add('merged');
                setTimeout(function(){ t.el.classList.remove('merged'); }, 200);
            });
            spawnTile();
            animating = false;
            if(won){ msgKind = 'win'; celebrate(); won = false; }
            else if(!movesLeft()){ over = true; msgKind = 'over'; showMsg(STR('g2048Over')); }
        }, SLIDE);
    }
    function showMsg(text){ msgEl.classList.remove('win'); msgEl.textContent = text; msgEl.hidden = false; }
    function hideMsg(){ msgEl.hidden = true; msgEl.classList.remove('win'); }
    function showWinMsg(){
        msgEl.innerHTML = '<span class="g2048-msg-title">' + escapeHtml(STR('g2048WinTitle')) + '</span>'
                        + '<span class="g2048-msg-sub">' + escapeHtml(STR('g2048WinSub')) + '</span>';
        msgEl.classList.add('win');
        msgEl.hidden = false;
    }

    // ── Second Brain celebration ──────────────────────────────────
    // Two acts on a canvas over the board: the ladder labels ascend
    // into the 2048 tile (lineage absorbed), then every tile dissolves
    // into particles that reassemble as a slowly-orbiting knowledge-
    // graph constellation. Colors derive from the live --accent token
    // (golden-angle hues, same idea as the cosmos world colors), so
    // the show matches whichever theme is active.
    var fxCanvas = null, fxRaf = 0, fxTimers = [];
    function stopFx(){
        if(fxRaf){ cancelAnimationFrame(fxRaf); fxRaf = 0; }
        fxTimers.forEach(clearTimeout); fxTimers = [];
        if(fxCanvas && fxCanvas.parentNode){ fxCanvas.parentNode.removeChild(fxCanvas); }
        fxCanvas = null;
        tiles.forEach(function(t){
            t.el.style.opacity = ''; t.el.style.transition = '';
            var inner = t.el.firstChild;
            inner.style.transform = ''; inner.style.transition = ''; inner.style.boxShadow = '';
        });
    }
    function fxT(fn, ms){ fxTimers.push(setTimeout(fn, ms)); }
    function celebrate(){
        stopFx();
        if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
            showWinMsg(); return;
        }
        var W = boardEl.clientWidth, H = boardEl.clientHeight;
        var DPR = Math.min(2, window.devicePixelRatio || 1);
        fxCanvas = document.createElement('canvas');
        fxCanvas.className = 'g2048-fx';
        fxCanvas.width = W * DPR; fxCanvas.height = H * DPR;
        boardEl.appendChild(fxCanvas);
        var ctx = fxCanvas.getContext('2d');
        function hue0(){
            var a = (getComputedStyle(document.body).getPropertyValue('--accent') || '#4db6ac').trim();
            return gvToHsl(a)[0];
        }
        var L = document.body.classList.contains('day') ? 46 : 64;
        function col(h, a){ return 'hsla(' + h.toFixed(1) + ', 62%, ' + L + '%, ' + a + ')'; }
        function centerOf(t){ return [t.el.offsetLeft + t.el.offsetWidth / 2, t.el.offsetTop + t.el.offsetHeight / 2]; }
        function ease(k){ return 1 - Math.pow(1 - k, 3); }
        var winT = null;
        tiles.forEach(function(t){ if(t.val >= 2048 && (!winT || t.val > winT.val)){ winT = t; } });
        if(!winT){ winT = tiles[tiles.length - 1]; }
        var wc = centerOf(winT);

        // Act 1 — lineage ascension: distinct ladder values on the
        // board fly into the win tile, which swells and glows.
        var vals = [];
        tiles.forEach(function(t){ if(t !== winT && vals.indexOf(t.val) === -1){ vals.push(t.val); } });
        vals.sort(function(a, b){ return a - b; });
        var flights = [];
        var winInner = winT.el.firstChild;
        winInner.style.transition = 'transform 0.25s ease, box-shadow 0.25s ease';
        vals.forEach(function(v, i){
            fxT(function(){
                var src = null;
                tiles.forEach(function(t){ if(!src && t.val === v){ src = t; } });
                if(!src){ return; }
                flights.push({ c: centerOf(src), t0: performance.now(), label: LAB[v] || String(v) });
                src.el.style.transition = 'transform 0.12s ease-out, opacity 0.4s ease';
                src.el.style.opacity = 0.25;
                winInner.style.transform = 'scale(' + (1 + 0.05 * (i + 1)) + ')';
                winInner.style.boxShadow = '0 0 ' + (8 + i * 4) + 'px color-mix(in srgb, var(--accent) 60%, transparent)';
            }, 400 + i * 240);
        });
        var act1End = 400 + vals.length * 240 + 400;

        // Act 2 — constellation: particles leave the tiles and settle
        // into 4 concept clusters with intra-cluster edges + a few
        // cross-World bridges, then orbit slowly.
        var CX = W / 2, CY = H / 2, R = Math.min(W, H);
        var clusters = [
            { dh: 0,     x: -0.21 * R, y: -0.16 * R, n: 20 },
            { dh: 137.5, x:  0.23 * R, y: -0.12 * R, n: 15 },
            { dh: 275,   x: -0.16 * R, y:  0.22 * R, n: 13 },
            { dh: 52.5,  x:  0.19 * R, y:  0.19 * R, n: 12 }
        ];
        var nodes = [], parts = [], edges = [], born = 0;
        clusters.forEach(function(cl){
            for(var i = 0; i < cl.n; i++){
                var a = Math.random() * 6.283, r = R * (0.03 + Math.random() * 0.13);
                nodes.push({ x: CX + cl.x + Math.cos(a) * r, y: CY + cl.y + Math.sin(a) * r * 0.8,
                             dh: cl.dh, cl: cl, s: 1.8 + Math.random() * 2, id: born++ });
            }
        });
        nodes.forEach(function(n){
            for(var k = 0; k < 2; k++){
                var m = nodes[Math.floor(Math.random() * nodes.length)];
                if(m !== n && (m.cl === n.cl || Math.random() < 0.06)){ edges.push([n, m]); }
            }
        });
        var srcs = tiles.length ? tiles : [winT];
        nodes.forEach(function(n, i){
            var c = centerOf(srcs[i % srcs.length]);
            parts.push({ x0: c[0] + (Math.random() - 0.5) * 24, y0: c[1] + (Math.random() - 0.5) * 24, n: n });
        });
        var act2Start = 0;
        fxT(function(){
            act2Start = performance.now();
            tiles.forEach(function(t){
                t.el.style.transition = 'transform 0.12s ease-out, opacity 0.6s ease';
                t.el.style.opacity = 0;
            });
        }, act1End);
        fxT(showWinMsg, act1End + 1900);

        function frame(now){
            ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
            var h0 = hue0();
            flights.forEach(function(f){
                var k = (now - f.t0) / 600; if(k < 0 || k >= 1){ return; }
                var e = ease(k);
                var x = f.c[0] + (wc[0] - f.c[0]) * e, y = f.c[1] + (wc[1] - f.c[1]) * e - Math.sin(k * 3.14) * H * 0.1;
                ctx.font = '700 ' + (12 * DPR) + 'px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'center';
                ctx.fillStyle = col(h0, 1 - k * 0.5);
                ctx.fillText(f.label, x * DPR, y * DPR);
                ctx.beginPath(); ctx.arc(x * DPR, (y + 7) * DPR, 2.2 * DPR, 0, 6.283);
                ctx.fill();
            });
            if(act2Start){
                var t2 = (now - act2Start) / 1000;
                var k2 = Math.min(1, Math.max(0, (t2 - 0.15) / 1.5)), e2 = ease(k2);
                var rot = t2 > 1.8 ? (t2 - 1.8) * 0.08 : 0;
                var cr = Math.cos(rot), sr = Math.sin(rot);
                var P = parts.map(function(p){
                    var x = p.x0 + (p.n.x - p.x0) * e2, y = p.y0 + (p.n.y - p.y0) * e2;
                    if(rot){ var dx = x - CX, dy = y - CY; x = CX + dx * cr - dy * sr; y = CY + dx * sr + dy * cr; }
                    return [x, y];
                });
                if(k2 > 0.72){
                    ctx.lineWidth = 1 * DPR;
                    var ea = (k2 - 0.72) / 0.28 * 0.32;
                    edges.forEach(function(ed){
                        var A = P[ed[0].id], B = P[ed[1].id];
                        ctx.strokeStyle = col(h0 + ed[0].dh, ea);
                        ctx.beginPath(); ctx.moveTo(A[0] * DPR, A[1] * DPR); ctx.lineTo(B[0] * DPR, B[1] * DPR); ctx.stroke();
                    });
                }
                parts.forEach(function(p, i){
                    var tw = 0.75 + 0.25 * Math.sin(now / 320 + p.n.id);
                    ctx.fillStyle = col(h0 + p.n.dh, 0.9 * tw * Math.max(0.15, e2));
                    ctx.beginPath(); ctx.arc(P[i][0] * DPR, P[i][1] * DPR, p.n.s * DPR, 0, 6.283); ctx.fill();
                });
            }
            fxRaf = requestAnimationFrame(frame);
        }
        fxRaf = requestAnimationFrame(frame);
    }
    function clearTiles(){
        tiles.forEach(function(t){ if(t.el.parentNode){ t.el.parentNode.removeChild(t.el); } });
        tiles = [];
        for(var r = 0; r < N; r++){ board[r] = [null, null, null, null]; }
    }
    function newGame(){
        stopFx();
        clearTiles(); score = 0; won = false; over = false; animating = false;
        msgKind = null;
        hideMsg();
        scoreEl.textContent = '0';
        bestEl.textContent = STR('gameBest') + ' ' + fmt(gameBestUpdate('g2048', 0));
        spawnTile(); spawnTile();
    }
    var ro = null;
    if(window.ResizeObserver){ ro = new ResizeObserver(function(){ repositionAll(); }); ro.observe(boardEl); }

    var searching = function(){ return screen.classList.contains('searching'); };
    function onKey(e){
        if(!wrap.isConnected){ cleanup(); return; }
        if(searching()){ return; }   // query present → keys belong to the field
        var k = e.key, dir = '';
        if(k === 'ArrowLeft' || k === 'a' || k === 'A'){ dir = 'left'; }
        else if(k === 'ArrowRight' || k === 'd' || k === 'D'){ dir = 'right'; }
        else if(k === 'ArrowUp' || k === 'w' || k === 'W'){ dir = 'up'; }
        else if(k === 'ArrowDown' || k === 's' || k === 'S'){ dir = 'down'; }
        else { return; }
        e.preventDefault();
        move(dir);
    }
    var ts = null;
    function onTStart(e){ if(searching()){ return; } var t = e.touches ? e.touches[0] : e; ts = { x: t.clientX, y: t.clientY }; }
    function onTMove(e){ if(ts && !searching() && e.cancelable){ e.preventDefault(); } }   // stop iOS from turning the swipe into a page scroll
    function onTEnd(e){
        if(!ts || searching()){ ts = null; return; }
        var t = e.changedTouches ? e.changedTouches[0] : e;
        var dx = t.clientX - ts.x, dy = t.clientY - ts.y; ts = null;
        if(Math.max(Math.abs(dx), Math.abs(dy)) < 24){ return; }
        move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }
    window.addEventListener('keydown', onKey);
    boardEl.addEventListener('touchstart', onTStart, { passive: true });
    boardEl.addEventListener('touchmove', onTMove, { passive: false });
    boardEl.addEventListener('touchend', onTEnd);
    wrap.querySelector('.g2048-new').addEventListener('click', function(e){ e.stopPropagation(); newGame(); });
    msgEl.addEventListener('click', function(){
        // Win overlay is a milestone, not an ending — dismiss and keep
        // playing on the same board. Only game over restarts.
        if(msgKind === 'win'){ msgKind = null; stopFx(); hideMsg(); return; }
        newGame();
    });
    function cleanup(){
        stopFx();
        window.removeEventListener('keydown', onKey);
        boardEl.removeEventListener('touchstart', onTStart);
        boardEl.removeEventListener('touchmove', onTMove);
        boardEl.removeEventListener('touchend', onTEnd);
        if(ro){ ro.disconnect(); }
    }
    wrap._cleanup = cleanup;
    wrap._celebrate = function(){ msgKind = 'win'; celebrate(); };

    newGame();
};
