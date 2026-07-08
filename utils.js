// utils.js — 순수 유틸(전역 의존 없음) — index.html에서 추출한 모듈 (동작 불변 이동).
// 클래식 스크립트: 최상위 선언은 전역(window) 공유. 로드 순서는 index.html 참조.
function escapeHtml(s){
    return String(s).replace(/[&<>"]/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
}

function roundRect(ctx, x, y, w, h, r){
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
