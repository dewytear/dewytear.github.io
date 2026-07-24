// music.js — 배경 음악(YouTube IFrame) — index.html에서 추출한 모듈 (동작 불변 이동).
// 클래식 스크립트: 최상위 선언은 전역(window) 공유. 로드 순서는 index.html 참조.
// Accept a YouTube URL (watch / youtu.be / embed / shorts) or a raw
// 11-char video id; return the id, or '' if it doesn't look like one.
function parseYouTubeId(input){
    input = (input || '').trim();
    if(!input){ return ''; }
    var m = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/))([A-Za-z0-9_-]{11})/);
    if(m){ return m[1]; }
    if(/^[A-Za-z0-9_-]{11}$/.test(input)){ return input; }
    return '';
}

// ---- Floating background music (YouTube IFrame API) ----
(function(){
    var DEFAULT_ID = 'jzUkPTTOGoI';
    function resolveId(){
        try{ return parseYouTubeId((effSettings().music) || '') || DEFAULT_ID; }
        catch(e){ return DEFAULT_ID; }
    }
    var VIDEO_ID = resolveId();
    var VIDEO_URL = 'https://www.youtube.com/watch?v=' + VIDEO_ID;
    var player, ready = false, playing = false, wantPlay = false, failed = false;
    var btn = document.getElementById('music-btn');

    // If the API never loads (offline / blocked by an ad- or tracker
    // blocker), tell the user instead of leaving a dead button.
    var apiTimer = setTimeout(function(){
        if(!player){ fail(STR('musicFail')); }
    }, 6000);

    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = function(){ fail(STR('musicFail')); };
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = function(){
        clearTimeout(apiTimer);
        player = new YT.Player('yt-music', {
            // Real (off-screen) size — Safari refuses playback on a
            // zero-size/hidden media element even after a user tap.
            height: '200', width: '200', videoId: VIDEO_ID,
            playerVars: { autoplay: 0, controls: 0, loop: 1,
                          playlist: VIDEO_ID, playsinline: 1,
                          origin: location.origin },
            events: {
                onReady: function(){
                    ready = true;
                    try{ player.setVolume(35); }catch(e){}
                    // Fallback for a tap that arrived before the player
                    // object even existed (see toggleMusic).
                    if(wantPlay){ start(); }
                },
                onStateChange: function(e){
                    playing = (e.data === YT.PlayerState.PLAYING);
                    if(playing){ failed = false; }
                    render();
                },
                onError: function(){
                    // 2=bad id · 5=HTML5 error · 100=removed ·
                    // 101/150=embedding disabled by the uploader.
                    fail(STR('musicEmbed'));
                }
            }
        });
    };
    function start(){
        try{ player.playVideo(); player.setVolume(35); }catch(e){}
    }
    function fail(msg){
        failed = true; playing = false; wantPlay = false;
        if(btn){
            btn.classList.remove('playing'); btn.classList.add('idle', 'blocked');
            btn.title = STR('musicBlockedTitle');
            btn.setAttribute('aria-label', btn.title);
        }
        showMusicNote();
        try{ console.warn('[music] ' + msg); }catch(e){}
    }
    // A one-time bubble explaining the block (usually Safari's tracker
    // prevention on youtube.com) and pointing to the YouTube fallback.
    function showMusicNote(){
        if(document.getElementById('music-note')){ return; }
        var n = document.createElement('div');
        n.id = 'music-note';
        n.innerHTML = STR('musicNotice');
        document.body.appendChild(n);
        void n.offsetWidth;
        n.classList.add('show');
        setTimeout(function(){ if(n.parentNode){ n.classList.remove('show'); } }, 9000);
        setTimeout(function(){ if(n.parentNode){ n.remove(); } }, 9400);
    }
    function render(){
        if(!btn || failed){ return; }
        btn.classList.toggle('playing', playing);
        btn.classList.toggle('idle', !playing);
        btn.setAttribute('aria-label', playing ? '배경음악 정지' : '배경음악 재생');
        btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
        btn.title = playing ? '배경음악 정지' : '배경음악 재생';
    }
    window.toggleMusic = function(){
        // Blocked (e.g. Safari tracker prevention): open the track on
        // YouTube directly — this tap is a user gesture, so it's allowed.
        if(failed){
            var note = document.getElementById('music-note');
            if(note){ note.remove(); }
            window.open(VIDEO_URL, '_blank', 'noopener');
            return;
        }
        // Player object not created yet (API script still loading):
        // remember the intent; onReady will honour it.
        if(!player){
            wantPlay = true;
            if(btn){ btn.classList.add('playing'); btn.classList.remove('idle'); }
            return;
        }
        failed = false;
        if(playing){ player.pauseVideo(); wantPlay = false; }
        else{
            // Call playVideo() synchronously inside the user gesture. The
            // YT API queues commands issued before onReady, so playback
            // starts with sound instead of being deferred to a
            // non-gesture callback (which browsers block).
            start();
        }
    };
    // Settings can swap the track (a YouTube link/id). Apply live when
    // the player exists; otherwise it takes effect on the next load
    // (resolveId reads the saved setting at init).
    window.setMusicVideo = function(raw){
        var id = parseYouTubeId(raw || '') || DEFAULT_ID;
        if(id === VIDEO_ID){ return; }
        VIDEO_ID = id;
        VIDEO_URL = 'https://www.youtube.com/watch?v=' + id;
        if(player && player.cueVideoById){
            try{
                player.cueVideoById(id);
                failed = false;
                if(btn){ btn.classList.remove('blocked'); }
            }catch(e){}
        }
    };
})();
