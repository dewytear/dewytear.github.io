/**
 * 내위키 좋아요·조회수 Worker (Cloudflare Workers + D1)
 *
 * GitHub Pages는 정적이라 쓰기가 없다. 좋아요처럼 "누르면 남는" 것과, 4시간
 * 캐시 없이 즉시 반영되는 조회수를 위해 바깥에 아주 작은 쓰기 계층을 둔다.
 *
 *   GET  /v1/counters?doc=<name>          → { doc, likes, views }
 *   GET  /v1/totals                       → { likes, docs }   사이트 합계
 *   POST /v1/like     { "doc": "<name>" } → { doc, likes, views }
 *   POST /v1/view     { "doc": "<name>" } → { doc, likes, views }   봇 UA는 세지 않음
 *   GET  /v1/seed                          조회수 이관 화면 (일회성, 멱등)
 *   POST /v1/seed     { "docs": [...] }  → { ok, done, seeded, failed }
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

// 봇 걸러내기 — **조회수에만** 적용한다.
//
// 좋아요는 사람이 눌러야 오르지만 조회수는 페이지가 열리면 자동으로 오른다.
// 그래서 봇이 곧바로 수치를 부풀린다. GoatCounter는 이 걸러내기를 서버에서
// 해 주고 있었고, 조회수를 이 Worker로 가져오는 순간 그 책임도 함께 온다.
//
// UA는 자칭이라 작정한 봇은 못 막는다 — 그건 이 방어의 알려진 한계이고,
// 좋아요의 중복 방지와 같은 태도다(막을 수 있는 값싼 것부터 막는다).
// `headless`가 목록에 있는 이유는 남의 봇이 아니라 **우리 CI**다:
// i18n-render가 44화면, diagram-bounds가 도식 문서 전부를 실제 Chrome으로
// 여니, 막지 않으면 PR마다 조회수가 오른다.
const BOT_RE = /bot|crawl|spider|slurp|headless|preview|scrape|monitor|curl|wget|python|node-fetch|lighthouse|pingdom/i;

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

// ── 조회수 이관 (일회성) ──────────────────────────────────────────────
//
// **왜 Worker가 하나.** 이관은 GoatCounter의 문서별 수치를 `base`에 심는
// 일이고, 원래 설계는 `worker/seed_views.py`를 사람이 로컬에서 돌려 SQL을
// 붙여넣는 것이었다. 그런데 AI 작업 샌드박스는 프록시가 goatcounter.com을
// 막아 그 스크립트를 돌릴 수 없고, 그러면 남는 건 "대표님 PC에 Python과
// wrangler를 갖추고 로그인하세요"다 — 설계가 사람에게 일을 미루는 모양이다.
// Cloudflare에는 네트워크 제약이 없으니 **여기서 하는 것이 맞다.**
//
// **비밀키가 없는 이유.** 이 엔드포인트가 쓰는 값은 GoatCounter의 공개
// 카운터이고, 쓰는 조건은 `base = 0`(아직 이관되지 않은 행)뿐이다. 즉 누가
// 호출해도 결과는 **참값 한 번 심기**이고 두 번 호출해도 달라지지 않는다.
// 지킬 것이 없는 곳에 자물쇠를 달면 자물쇠 관리가 새 위험이 된다.
//
// 이관이 끝나면 이 절은 지워도 된다. 남겨 두어도 하는 일이 없다.
const GC_HOST = 'https://dewytear.goatcounter.com';

// 무료 플랜은 **요청당 서브리퀘스트 50개**가 상한이다. 문서가 180편이 넘으니
// 한 번에 다 돌 수 없어 배치로 나눈다(페이지가 스스로 이어서 호출한다).
const SEED_BATCH = 40;

/** 문서 목록의 정본은 위키다 — doc-dates.json이 list에서 생성된 전체 문서다. */
const DOC_LIST_URL = 'https://dewytear.github.io/data/doc-dates.json';

async function seedBatch(db, request, origin) {
    let docs = [];
    try { docs = (await request.json()).docs || []; } catch (_) { /* 아래서 걸린다 */ }
    docs = docs.filter((d) => typeof d === 'string' && DOC_RE.test(d)).slice(0, SEED_BATCH);
    if (!docs.length) return json({ error: 'docs' }, origin, 400);

    const seeded = [];
    const failed = [];
    await Promise.all(docs.map(async (doc) => {
        let n = null;
        try {
            const r = await fetch(`${GC_HOST}/counter/${encodeURIComponent(doc)}.json`);
            // 집계 0건은 404로 오지만 본문은 정상 JSON이라 상태코드는 보지 않는다.
            const j = await r.json();
            // count는 자릿수 구분자(가는 공백·쉼표)가 섞인 문자열이다.
            const parsed = parseInt(String((j && j.count) || '').replace(/\D/g, ''), 10);
            n = isNaN(parsed) ? null : parsed;
        } catch (_) { n = null; }
        if (n === null) { failed.push(doc); return; }
        // `WHERE base = 0`이 멱등성의 전부다 — 이미 이관된 행은 건드리지 않으니
        // 여러 번 호출해도 수치가 겹쳐 오르지 않는다.
        await db.prepare(
            `INSERT INTO counters (doc, base) VALUES (?, ?)
             ON CONFLICT(doc) DO UPDATE SET base = excluded.base WHERE counters.base = 0`
        ).bind(doc, n).run();
        if (n > 0) seeded.push(doc);
    }));
    return json({ ok: true, done: docs.length, seeded: seeded.length, failed }, origin);
}

/**
 * 한 번 열면 끝나는 이관 화면. 문서 목록은 Worker가 위키에서 읽어 심어 두고
 * (브라우저에서 읽으면 크로스오리진이라 사이트 CORS 설정에 매인다),
 * 배치 호출은 이 페이지의 스크립트가 순서대로 이어 간다.
 */
async function seedPage(origin) {
    let names = [];
    let err = '';
    try {
        const r = await fetch(DOC_LIST_URL);
        const j = await r.json();
        names = Object.keys((j && j.docs) || {}).filter((d) => DOC_RE.test(d));
    } catch (e) { err = String(e); }

    const head = '<!doctype html><meta charset="utf-8"><title>조회수 이관</title>'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<style>body{font:15px/1.7 -apple-system,BlinkMacSystemFont,"Pretendard",sans-serif;'
        + 'max-width:34rem;margin:12vh auto;padding:0 1.2rem;background:#212a3a;color:#e8ecf3}'
        + 'b{color:#7fd1c1}code{background:#2b3648;padding:.1em .4em;border-radius:4px}'
        + '#log{white-space:pre-wrap;color:#9aa7bd;font-size:13px;margin-top:1rem}</style>';

    if (!names.length) {
        return new Response(
            `${head}<h1>조회수 이관</h1><p>문서 목록을 읽지 못했습니다.</p><p><code>${esc(err)}</code></p>`,
            { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors(origin) } },
        );
    }

    const body = `${head}<h1>조회수 이관</h1>
<p>GoatCounter의 문서별 조회수를 D1의 <code>base</code>로 옮깁니다.
문서 <b>${names.length}편</b>. 이미 옮겨진 문서는 건너뛰므로 <b>여러 번 열어도 안전</b>합니다.</p>
<p id="st">시작합니다…</p><div id="log"></div>
<script>
const NAMES = ${JSON.stringify(names)}, SIZE = ${SEED_BATCH};
const st = document.getElementById('st'), log = document.getElementById('log');
let done = 0, seeded = 0, failed = [];
(async () => {
  for (let i = 0; i < NAMES.length; i += SIZE) {
    const docs = NAMES.slice(i, i + SIZE);
    st.textContent = '이관 중… ' + done + ' / ' + NAMES.length;
    try {
      const r = await fetch('/v1/seed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docs }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'unknown');
      done += j.done; seeded += j.seeded; failed = failed.concat(j.failed || []);
    } catch (e) {
      log.textContent += '배치 실패: ' + e + '\\n';
      done += docs.length; failed = failed.concat(docs);
    }
  }
  st.innerHTML = '<b>완료</b> — ' + done + '편 확인, 조회수가 있는 ' + seeded + '편을 옮겼습니다.';
  if (failed.length) log.textContent += '못 읽은 문서 ' + failed.length + '편: ' + failed.join(', ');
})();
</script>`;
    return new Response(body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) },
    });
}

function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
        // 같은 오리진(이 Worker가 스스로 낸 /v1/seed 페이지)은 언제나 허용한다 —
        // 브라우저는 same-origin POST에도 Origin을 실어 보내므로 명시해야 한다.
        if (origin && origin !== url.origin && !ALLOWED_ORIGINS.includes(origin)) {
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
                // 봇은 조회수만 올리지 못하게 한다. 400이 아니라 **현재 수치를
                // 그대로 돌려준다** — 봇에게 오류를 주면 재시도를 부르고, 사람이
                // 쓰는 클라이언트와 응답 모양이 달라지면 배선이 복잡해진다.
                if (col === 'views' && BOT_RE.test(request.headers.get('User-Agent') || '')) {
                    return json(await read(db, doc), origin);
                }
                return json(await bump(db, doc, col), origin);
            }

            // 조회수 이관 (일회성). 자세한 사정은 파일 아래쪽 seed 절에.
            if (url.pathname === '/v1/seed') {
                if (request.method === 'GET') return seedPage(origin);
                if (request.method === 'POST') return seedBatch(db, request, origin);
            }

            return json({ error: 'not-found' }, origin, 404);
        } catch (e) {
            // 클라이언트는 어차피 UI를 감춘다. 자세한 이유는 Worker 로그에만.
            console.error(e);
            return json({ error: 'server' }, origin, 500);
        }
    },
};
