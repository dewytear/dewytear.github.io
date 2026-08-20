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
    themeInk(function(){ document.body.classList.toggle('day', isDay); }, isDay);
    try{
        var s = JSON.parse(localStorage.getItem('wikiSettings')) || {};
        s.theme = isDay ? 'day' : 'night';
        localStorage.setItem('wikiSettings', JSON.stringify(s));
    }catch(e){}
}

// ---- 테마 전환의 먹 번짐 ----
// 브라우저의 View Transitions가 옛 화면과 새 화면을 각각 스냅샷으로 떠 준다. 그래서
// 전환 중에도 글자·카드가 사라지지 않고, 먹 경계 안쪽은 새 테마, 바깥쪽은 옛 테마의
// 같은 화면이 보인다. 실제 애니메이션은 style.css의 ::view-transition-new(root)가
// 마스크를 키우며 하고, 이 함수는 좌표·길이·마스크만 넘긴 뒤 손을 뗀다 — 프레임당
// 자바스크립트 계산이 없다.
//
// 옛 방식(캔버스로 옛 배경색 한 겹을 덮고 먹으로 파내기)은 전환 구간에서 화면이
// 통째로 비었다. 페이지를 스냅샷으로 뜰 방법이 없었기 때문인데, 그건 캔버스에
// html을 그리는 크롬 전용 실험 API를 전제한 이야기였다. View Transitions는 표준으로
// 같은 것을 해 주므로 스냅샷을 브라우저에서 받아 쓴다.
var THEME_FX_BUSY = false;
// 마스크를 SVG 데이터 URI 그대로 넘기면 크롬이 mask-size가 바뀔 때마다 feTurbulence를
// 다시 래스터한다 — 실측 17fps. 검색 화면이 라이브 필터로 5fps까지 떨어졌던 그 함정이
// CSS 마스크 쪽에서 되풀이되는 것이다. 한가할 때 캔버스에 한 번 굽고 비트맵 URL로
// 넘기면 이후엔 브라우저가 배율만 바꿔 그린다.
var THEME_FX_MASK = '';

function themeFxBake(){
    if(THEME_FX_MASK){ return; }
    if(themeFxOpts().mode === 'off'){ return; }
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){ return; }
    var host = document.getElementById('theme-switch');
    if(!host){ return; }
    var raw = getComputedStyle(host).getPropertyValue('--ink-erase').trim();
    var m = /^url\(\s*"?([\s\S]*?)"?\s*\)$/.exec(raw);
    if(!m){ return; }
    var S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    var cx = c.getContext('2d');
    if(!cx){ return; }
    var img = new Image();
    img.onload = function(){
        cx.drawImage(img, 0, 0, S, S);
        try{
            if(c.toBlob){
                c.toBlob(function(blob){
                    if(blob){ THEME_FX_MASK = 'url("' + URL.createObjectURL(blob) + '")'; }
                }, 'image/png');
            }else{
                THEME_FX_MASK = 'url("' + c.toDataURL('image/png') + '")';
            }
        }catch(e){}
    };
    img.src = m[1];
}

// 마스크는 첫 전환 전에 준비돼 있어야 하지만 로드와 경쟁하면 안 된다 — 한가할 때 굽는다.
(function(){
    var idle = window.requestIdleCallback || function(f){ return setTimeout(f, 1500); };
    function go(){ idle(themeFxBake); }
    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', go);
    }else{ go(); }
})();

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

// flip: 실제로 클래스를 뒤집는 함수(어느 경로로도 반드시 한 번 호출된다).
// toDay: 이제부터 낮인가 — 양방향을 끈 경우의 방향 판정에 쓴다.
function themeInk(flip, toDay){
    var o = themeFxOpts();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 양방향이 꺼져 있으면 밤 → 낮으로 갈 때만 번진다.
    if(o.mode === 'off' || reduce || THEME_FX_BUSY || !document.startViewTransition
       || (!o.both && !toDay)){
        flip(); return;
    }
    var W = window.innerWidth, H = window.innerHeight;
    if(!W || !H){ flip(); return; }

    // 번짐은 누른 자리에서 시작한다. 사이드바가 접혀 있으면 화면 중앙에서.
    var host = document.getElementById('theme-switch');
    var r = host ? host.getBoundingClientRect() : null;
    var ox = (r && r.width) ? r.left + r.width / 2 : W / 2;
    var oy = (r && r.height) ? r.top + r.height / 2 : H / 2;
    // 마스크 안쪽 '고원'(불투명 구간)이 화면의 가장 먼 구석까지 닿아야 전환이
    // 완결된다. 고원 반지름은 마스크 한 변의 약 0.29배이므로 3.6배를 잡는다.
    var far = Math.max(Math.sqrt(ox * ox + oy * oy),
                       Math.sqrt((W - ox) * (W - ox) + oy * oy),
                       Math.sqrt(ox * ox + (H - oy) * (H - oy)),
                       Math.sqrt((W - ox) * (W - ox) + (H - oy) * (H - oy)));
    // 마스크는 style.css가 정본이다(난류 파라미터의 단일 출처). 구운 비트맵이 있으면
    // 그것을 쓰고, 아직 없으면 SVG 원본으로 돈다(느리지만 한 번뿐이다). 전환 때만
    // 루트로 옮겨 준다 — 뷰 트랜지션 의사요소는 루트의 자식이라 거기서 상속받는다.
    var mask = THEME_FX_MASK;
    if(!mask){
        mask = host ? getComputedStyle(host).getPropertyValue('--ink-erase').trim() : '';
        themeFxBake();          /* 다음 전환은 비트맵으로 */
    }
    if(!mask){ flip(); return; }

    var root = document.documentElement.style;
    root.setProperty('--tfx-mask', mask);
    root.setProperty('--tfx-x', ox.toFixed(1) + 'px');
    root.setProperty('--tfx-y', oy.toFixed(1) + 'px');
    root.setProperty('--tfx-r', Math.round(far * 3.6) + 'px');
    root.setProperty('--tfx-dur', o.ms + 'ms');

    THEME_FX_BUSY = true;
    var done = function(){
        THEME_FX_BUSY = false;
        root.removeProperty('--tfx-mask');   // 마스크 문자열을 계속 물고 있지 않는다
    };
    var vt;
    try{ vt = document.startViewTransition(flip); }
    catch(e){ done(); flip(); return; }
    vt.finished.then(done, done);
}
