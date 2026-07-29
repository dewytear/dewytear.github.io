-- 내위키 좋아요·조회수 저장소 (Cloudflare D1)
--
-- KV가 아니라 D1을 쓰는 이유:
--   ① 무료 쓰기 한도 — KV 1,000/일 vs D1 100,000행/일. 조회수는 페이지뷰마다
--      쓰기 1회라 KV로는 금방 벽에 부딪힌다.
--   ② 원자적 증가 — KV는 읽고→더하고→쓰는 사이에 낀 요청이 조용히 유실된다.
--      D1은 `UPDATE SET n = n + 1` 한 줄로 끝난다.
--
-- 한 행 = 한 문서. `views.base`는 GoatCounter에서 이관해 온 시작값이고
-- (tools/seed_views.py 참조), `views.n`은 그 뒤로 이 Worker가 센 증가분이다.
-- 화면에 보이는 조회수는 base + n. 이관 없이 시작하면 모든 문서가 0으로
-- 리셋된 것처럼 보이므로, 교체 시점에 base를 반드시 채운다.
CREATE TABLE IF NOT EXISTS counters (
    doc     TEXT PRIMARY KEY,   -- list의 불변 논리 ID (예: news-20260728-software-factories-fail)
    likes   INTEGER NOT NULL DEFAULT 0,
    views   INTEGER NOT NULL DEFAULT 0,   -- 이 Worker가 센 증가분
    base    INTEGER NOT NULL DEFAULT 0    -- GoatCounter에서 이관해 온 시작값
);
