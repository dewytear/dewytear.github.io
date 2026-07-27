#!/usr/bin/env node
// Rendered-screen i18n verifier — "does any Korean actually reach the screen
// in a non-Korean language?"
//
// Why this exists (2026-07-28). Every other i18n gate compares FILES: STRINGS
// key parity, list labels, doc-entries overlays, concept-dictionary coverage.
// All of them were green while three separate surfaces rendered Korean to
// Japanese readers. The worst case proved the point: the 2D concepts view had
// a perfect 302/302 dictionary loaded and still painted Korean keys, because
// graphviews.js dropped `conceptLabels` at the render boundary — a wiring bug
// no file comparison can see. (English had the same bug, unreported, since
// #328.) So this checker renders the real screens in a real browser and reads
// the text back, exactly as tools/check_diagram_bounds.mjs does for diagrams.
//
// Usage:
//   python3 -m http.server 8799 &                       # serve repo root
//   chromium --headless --remote-debugging-port=9333 &  # any Chromium
//   node tools/check_i18n_render.mjs [lang ...]          # default: all non-ko LANGS_READY
//
// Env: CDP_PORT (9333), HTTP_PORT (8799). Exits non-zero on any leak.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = process.env.CDP_PORT || '9333';
const HTTP = process.env.HTTP_PORT || '8799';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Languages under test come from i18n.js's LANGS_READY (the switch that
// actually turns a language on), minus Korean.
function readyLangs() {
  const t = fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8');
  const m = /LANGS_READY\s*=\s*\[([^\]]*)\]/.exec(t);
  if (!m) throw new Error('LANGS_READY not found in i18n.js');
  return [...m[1].matchAll(/['"]([\w-]+)['"]/g)].map((x) => x[1]).filter((l) => l !== 'ko');
}

// ---------------------------------------------------------------------------
// ALLOWLIST — Korean that is CORRECT to see in a non-Korean UI.
//
// Rule (deliberate, do not relax): every entry is an EXPLICIT STRING plus the
// reason it is exempt. No regexes, no wildcards, no prefix matching. A gate
// whose exemptions cannot be read is decoration, not a gate. If this list
// starts growing past a screenful, that is a signal the UI has a real problem,
// not a signal to loosen the rule.
// ---------------------------------------------------------------------------
const ALLOW = [
  // The work-log folders on disk are literally named `MM월` / `DD일`
  // (docs/ko/work-log/2026/07/28/…). wl-guide documents how to create a log
  // file, so it must quote the REAL path — in every language, including the
  // English one, which has printed `07월 > 03일` since it was written. The
  // sidebar shows the translated folder titles (`July` / `28日`) via
  // title_<lang>; only this one guide shows the physical names.
  ['월', 'wl-guide quotes the on-disk folder name `MM월`'],
  ['일', 'wl-guide quotes the on-disk folder name `DD일`'],
  //
  // Nothing else is exempt. The detector is live, not vacuous — running the
  // sweep against `ko` reports Korean on every screen.
  //
  // One exemption we expect to need eventually: the settings language
  // <select>, which lists each language in its own endonym ('한국어'). It is
  // behind a password prompt, so the sweep does not reach it today; add it
  // here WITH THIS REASON if the screen ever becomes reachable.
];
const ALLOW_STRINGS = ALLOW.map((a) => a[0]);

// THIRD-PARTY EMBEDS — excluded structurally, not by string.
//
// The background-music player is a YouTube iframe, and YouTube sets its
// `title` to the video's own title. The owner's playlist is Korean, so that
// attribute is Korean on every screen in every language — and it changes
// whenever the track changes, so no string allowlist could ever cover it.
// It is not our UI text and we cannot translate it, so the ELEMENT is out of
// scope. (This only shows up where the runner can reach youtube.com, which is
// why CI caught it and a sandboxed local run did not.)
const EXCLUDE = '#yt-music, iframe';

// Work-log BODIES are Korean-only by policy (tools/i18n.md): dated logs
// (wl-YYYYMMDD-*) fall back to ko in every language and that is correct.
// Their nav LABELS are translated, so only the article body is exempt.
const KO_FALLBACK_ROUTES = new Set(
  (() => {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'list'), 'utf8'));
    const out = [];
    const walk = (ns) => {
      for (const n of ns) {
        if (n.children) walk(n.children);
        else if (n.name && /^wl-\d{8}-/.test(n.name)) out.push(n.name);
      }
    };
    walk(Array.isArray(list) ? list : list.children || []);
    return out;
  })(),
);

// Screens to sweep. `hash` is the route; `prep` is optional in-page setup run
// after navigation (used to reach sub-views that have no route of their own).
const SCREENS = [
  { id: 'home', hash: '#!welcome' },
  { id: 'search', hash: '#!search' },
  { id: 'knowledge-map', hash: '#!ai-map' },
  { id: 'dz-map', hash: '#!dz-map' },
  { id: 'doc:kgs-overview', hash: '#!kgs-overview' },
  { id: 'doc:ccb-what', hash: '#!ccb-what' },
  { id: 'folder:tutorial', hash: '#!ccb-overview' },
  // work-log의 안내 문서. 날짜 붙은 일지와 달리 본문도 병행 대상이라
  // 여기서 검사한다 — 2026-07-28에 라벨만 번역되고 ja 본문이 없어
  // "메뉴는 일본어인데 열면 한국어"였던 자리다.
  { id: 'doc:wl-guide', hash: '#!wl-guide' },
  // Graph: one entry per view. The 2D group holds the view that was broken.
  ...['3d', '3d2', '3d3'].map((v) => ({
    id: `graph:${v}`, hash: '#!cosmos',
    prep: `(()=>{const g=document.querySelector('[data-gvg="3d"]'); if(g)g.click();
                 const b=document.querySelector('[data-gv="${v}"]'); if(b)b.click(); return !!b;})()`,
  })),
  ...['bundling', 'chord', 'packing', 'concepts', 'arc', 'matrix'].map((v) => ({
    id: `graph:${v}`, hash: '#!cosmos',
    prep: `(()=>{const g=document.querySelector('[data-gvg="2d"]'); if(g)g.click();
                 const b=document.querySelector('[data-gv="${v}"]'); if(b)b.click(); return !!b;})()`,
  })),
  // Search dock games. Only 2048 is inspectable here — it draws a real DOM
  // board. The other four paint to <canvas>, and canvas text is invisible to
  // any DOM sweep (see COVERAGE note below), so they are listed for the dock
  // chrome only.
  ...['concept', 'g2048', 'breakout', 'pong', 'plane'].map((g) => ({
    id: `game:${g}`, hash: '#!search',
    prep: `(()=>{const b=document.querySelector('.game-dock [data-g="${g}"]');
                 if(b)b.click(); return !!b;})()`,
  })),
];

// COVERAGE — what this checker cannot see, and what covers it instead.
//
// Canvas. games.js draws the concept meteors, breakout, pong and the paper
// plane with ctx.fillText. That text never enters the DOM, so no amount of
// DOM walking will find Korean in it. Those two surfaces are covered by the
// STATIC gates in tools/validate_i18n.py instead:
//   · meteor words        → concept-dict-coverage (they are concept labels)
//   · 2048 ladder + others → hidden-lang-dict (per-language literal dicts)
// That split is the point: neither layer is sufficient alone.
//
// Settings. The settings screen sits behind a password prompt, so the sweep
// does not reach it. Its strings are plain STR() keys, covered by
// strings-parity.

async function main() {
  const cli = process.argv.slice(2);
  const langs = cli.length ? cli : readyLangs();

  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target — is Chromium running with --remote-debugging-port?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((r) => {
    const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => (await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  const findings = [];
  let checked = 0;

  for (const lang of langs) {
    // Pin the language explicitly — first visit auto-detects the browser
    // language, so an unpinned headless run would silently render en.
    await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html#!welcome` });
    await new Promise((r) => setTimeout(r, 1200));
    await ev(`localStorage.setItem('wikiSettings', JSON.stringify({lang:'${lang}'})); location.reload(); 'ok'`);
    await new Promise((r) => setTimeout(r, 2600));

    for (const scr of SCREENS) {
      const skipBody = KO_FALLBACK_ROUTES.has(scr.hash.replace('#!', ''));
      const hits = await ev(`(async()=>{
        location.hash = ${JSON.stringify(scr.hash)};
        await new Promise(r=>setTimeout(r,900));
        ${scr.prep ? `try{ ${scr.prep} }catch(e){}` : ''}
        await new Promise(r=>setTimeout(r,1400));
        const ALLOW = ${JSON.stringify(ALLOW_STRINGS)};
        const EXCLUDE = ${JSON.stringify(EXCLUDE)};
        const HAN = /[\\uac00-\\ud7a3]/;
        const SKIP_BODY = ${skipBody ? 'true' : 'false'};
        const out = [], seen = new Set();
        function record(where, text){
          let t = (text||'').replace(/\\s+/g,' ').trim();
          if(!t || !HAN.test(t)) return;
          for(const a of ALLOW){ t = t.split(a).join(''); }
          if(!HAN.test(t)) return;
          const frag = (text||'').replace(/\\s+/g,' ').trim().slice(0,90);
          const key = where + '|' + frag;
          if(seen.has(key)) return;
          seen.add(key);
          out.push({ where, text: frag });
        }
        // Visible text nodes, attributed to the nearest identifiable ancestor.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while((n = walker.nextNode())){
          const el = n.parentElement;
          if(!el) continue;
          if(el.closest('script,style,noscript,template')) continue;
          if(el.closest(EXCLUDE)) continue;   // 서드파티 임베드는 우리 문구가 아니다
          if(SKIP_BODY && el.closest('#article')) continue;
          const cs = getComputedStyle(el);
          if(cs.display==='none' || cs.visibility==='hidden') continue;
          if(!el.getClientRects().length) continue;
          const host = el.closest('[id]');
          record((host && host.id ? '#'+host.id : el.tagName.toLowerCase()), n.nodeValue);
        }
        // Accessible names are UI text too — they were a real leak (music button).
        document.querySelectorAll('[aria-label],[title]').forEach(el=>{
          if(!el.getClientRects().length) return;
          if(el.closest(EXCLUDE)) return;
          record('@'+(el.id || el.className || el.tagName.toLowerCase()),
                 (el.getAttribute('aria-label')||'') + ' ' + (el.getAttribute('title')||''));
        });
        return out;
      })()`);
      checked++;
      const bad = hits || [];
      for (const h of bad) findings.push({ lang, screen: scr.id, ...h });
      process.stdout.write(bad.length ? 'X' : '.');
    }
    process.stdout.write(` ${lang}\n`);
  }

  ws.close();
  console.log(`${checked} screen renders checked (${langs.join('/')}).`);
  if (findings.length) {
    console.log(`\n${findings.length} KOREAN LEAK(S) — 이 언어 화면에 한국어가 그려진다:`);
    for (const f of findings) {
      console.log(`  [${f.lang}] ${f.screen} ${f.where}: ${f.text}`);
    }
    console.log('\n의도된 한국어라면 tools/check_i18n_render.mjs의 ALLOW에 '
      + '문자열과 사유를 함께 등록할 것 (정규식 금지).');
    process.exit(1);
  }
  console.log('OK: no Korean text rendered in any non-Korean language.');
}

main().catch((e) => { console.error(e); process.exit(1); });
