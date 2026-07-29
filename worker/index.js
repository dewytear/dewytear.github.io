/**
 * 내위키 좋아요·조회수 Worker (Cloudflare Workers + D1)
 *
 * GitHub Pages는 정적이라 쓰기가 없다. 좋아요처럼 "누르면 남는" 것과, 4시간
 * 캐시 없이 즉시 반영되는 조회수를 위해 바깥에 아주 작은 쓰기 계층을 둔다.
 *
 *   GET  /v1/counters?doc=<name>          → { doc, likes, views }
 *   GET  /v1/totals                       → { likes, docs }   사이트 합계
 *   POST /v1/like     { "doc": "<name>" } → { doc, likes, views }
 *   POST /v1/view     { "doc": "<name>" } → { doc, likes, views }
 *
 * 배포본: https://dewytear-wiki.youngjinkwak-5ee.workers.dev
 *   D1 `dewytear-wiki` (165681cc-…) 바인딩 `DB`. 설정은 저장소 맨 위 wrangler.toml —
 *   Workers Builds가 master 푸시마다 자동 배포한다. 살아 있는지 보려면 브라우저로
 *   `/v1/totals`를 열면 된다(정상: {"likes":0,"docs":0}).
 *
 * 실패는 조용하다 — 클라이언트(app.js)가 null을 받으면 UI를 아예 감춘다.
 * Worker가 죽어도 위키 본문은 그대로 읽힌다. 이 계층은 장식이지 뼈대가 아니다.
 *
 * ── 중복 방지 방침 (2026-07-29 결정) ────────────────────────────────────
 * 좋아요 1인 1회는 **브라우저 localStorage 표식**으로만 막는다. 서버는 누가
 * 눌렀는지 **저장하지 않는다** — IP도, 해시도, 쿠키도 남기지 않는다. 그래서
 * 시크릿창·다른 기기로는 우회된다. 그걸 알고 고른 것이다: 개인 위키의 좋아요는
 * 부풀려져도 잃는 게 없고, 대신 "쿠키·개인정보 수집 없음"이라는 약속을 그대로
 * 지킬 수 있다. 아래 방어는 그 약속을 깨지 않는 선까지만 한다.
 *   ① Origin 허용목록 — 다른 사이트가 이 엔드포인트를 끼워 쓰는 것을 막는다
 *   ② 문서 이름 정규식 — 쓰레기 행이 무한히 생기는 것을 막는다
 *   ③ 아이솔레이트 메모리 스로틀 — 같은 IP의 연타를 잠깐 눌러 둔다.
 *      **메모리에만** 있고 어디에도 쓰지 않으며 아이솔레이트가 죽으면 사라진다.
 * 작정하고 `curl`을 도는 사람은 못 막는다. 그건 이 설계의 알려진 한계다.
 */

const ALLOWED_ORIGINS = [
    'https://dewytear.github.io',
    'http://127.0.0.1:8799',   // 로컬 검증 하네스
    'http://localhost:8799',
];

// list의 논리 ID 규칙 — 소문자·숫자·하이픈. 여기서 걸러 두면 D1에 임의 키가
// 쌓이지 않는다(무료 한도 5GB는 넉넉하지만, 쓰레기가 섞이면 수치를 못 믿는다).
const DOC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// 아이솔레이트 메모리 스로틀 — IP당 이 창 안에서 최대 N번. 저장하지 않는다.
const THROTTLE_WINDOW_MS = 10_000;
const THROTTLE_MAX = 20;
const throttle = new Map();

function throttled(ip) {
    if (!ip) return false;
    const now = Date.now();
    const hit = throttle.get(ip);
    if (!hit || now - hit.t > THROTTLE_WINDOW_MS) {
        throttle.set(ip, { t: now, n: 1 });
        // 맵이 무한히 자라지 않게 창이 지난 항목을 가끔 걷어낸다.
        if (throttle.size > 5000) {
            for (const [k, v] of throttle) {
                if (now - v.t > THROTTLE_WINDOW_MS) throttle.delete(k);
            }
        }
        return false;
    }
    hit.n += 1;
    return hit.n > THROTTLE_MAX;
}

function cors(origin) {
    const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
    };
}

function json(body, origin, status) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            // 이 숫자는 즉시 반영이 목적이다 — 캐시하지 않는다.
            // (GoatCounter의 4시간 서버 캐시를 벗어나려고 만든 계층이다.)
            'Cache-Control': 'no-store',
            ...cors(origin),
        },
    });
}

/** 문서 한 행을 읽는다. 없으면 0으로 채운 객체. */
async function read(db, doc) {
    const row = await db.prepare(
        'SELECT likes, views, base FROM counters WHERE doc = ?'
    ).bind(doc).first();
    return {
        doc,
        likes: row ? row.likes : 0,
        views: row ? row.views + row.base : 0,
    };
}

/**
 * 한 칸을 1 올린다. UPSERT 한 문장이라 원자적이다 —
 * 읽고→더하고→쓰는 왕복이 없으니 동시 요청이 서로를 덮어쓰지 않는다.
 */
async function bump(db, doc, col) {
    await db.prepare(
        `INSERT INTO counters (doc, ${col}) VALUES (?, 1)
         ON CONFLICT(doc) DO UPDATE SET ${col} = ${col} + 1`
    ).bind(doc).run();
    return read(db, doc);
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors(origin) });
        }
        // 브라우저에서 오는 요청은 Origin이 있어야 하고 허용목록에 있어야 한다.
        // (Origin 없는 요청 — curl 등 — 은 막지 않는다. 막아 봐야 헤더 한 줄이라
        //  보안이 되지 못하고, 정직하게 "못 막는다"고 적어 두는 편이 낫다.)
        if (origin && !ALLOWED_ORIGINS.includes(origin)) {
            return json({ error: 'origin' }, origin, 403);
        }

        const db = env.DB;
        if (!db) return json({ error: 'no-db' }, origin, 500);

        try {
            if (request.method === 'GET' && url.pathname === '/v1/counters') {
                const doc = url.searchParams.get('doc') || '';
                if (!DOC_RE.test(doc)) return json({ error: 'doc' }, origin, 400);
                return json(await read(db, doc), origin);
            }

            // 사이트 전체 좋아요 합계. 방문자별로 나눠 세는 것이 아니라 —
            // 누른 사람이 누구인지 서버는 애초에 모른다 — 문서마다의 counters.likes를
            // 그냥 더한다. 그 열 자체가 이미 **모든 방문자의 클릭 합계**다.
            if (request.method === 'GET' && url.pathname === '/v1/totals') {
                const row = await db.prepare(
                    'SELECT COALESCE(SUM(likes), 0) AS likes, COUNT(*) AS docs FROM counters WHERE likes > 0'
                ).first();
                return json({ likes: row.likes, docs: row.docs }, origin);
            }

            if (request.method === 'POST'
                && (url.pathname === '/v1/like' || url.pathname === '/v1/view')) {
                if (throttled(request.headers.get('CF-Connecting-IP'))) {
                    return json({ error: 'slow-down' }, origin, 429);
                }
                let doc = '';
                try { doc = (await request.json()).doc || ''; } catch (_) { /* 아래서 걸린다 */ }
                if (!DOC_RE.test(doc)) return json({ error: 'doc' }, origin, 400);
                const col = url.pathname === '/v1/like' ? 'likes' : 'views';
                return json(await bump(db, doc, col), origin);
            }

            return json({ error: 'not-found' }, origin, 404);
        } catch (e) {
            // 클라이언트는 어차피 UI를 감춘다. 자세한 이유는 Worker 로그에만.
            console.error(e);
            return json({ error: 'server' }, origin, 500);
        }
    },
};
