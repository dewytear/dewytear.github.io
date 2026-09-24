#!/usr/bin/env node
// Retrieval-accuracy harness — "how often does this wiki find the right page?"
//
// Two things are measured, both against the REAL code and data:
//
//   1. SEARCH. The viewer's own searchDocs() (search.js) runs in a headless
//      browser, per language, over the frozen query set in
//      tools/eval/retrieval-set.json. Nothing is re-implemented: the page loads
//      index.html, waits for the knowledge index and the lazy full-text index,
//      then calls searchDocs(q) exactly as the search box does.
//        · Hit@1 / Hit@3 / Hit@8 (8 = SEARCH_LIMIT, what the screen shows), MRR,
//          zero-result rate — per language × query type.
//        · pair queries (answer spans two docs): both golds in search top-3,
//          in top-8, and in top-3 ∪ the related blocks of those three pages.
//        · a what-if for sentence queries: drop every term that matches no
//          document at all, then search again. Diagnostic only — the engine
//          is not changed.
//
//   2. GRAPH. related[] (what a reader sees under "연관 문서", and what an AI
//      follows in data/knowledge-graph.json) is computed from shared concepts
//      only. Author-drawn body links (`href="#!name"`) and human-typed
//      relations are an independent signal, so they are used as the yardstick:
//        · backed share   — related edges that coincide with a body link
//                           (either direction) or a typed relation
//        · link recall    — for each body link A→B, is B in A's related block
//                           (1 hop), or reachable in 2 hops?
//        · judged precision of the UNBACKED edges, if tools/eval/edge-audit.json
//          exists (verdicts are data; see that file's `about`).
//
// Why this lives in tools/eval/ and not tools/: everything directly under
// tools/ is byte-copied into the wiki-plugin bundle (check_plugin_sync.py).
// This harness drives the viewer (search.js), which the plugin does not ship,
// and the query set is this wiki's own content — like doc-entries, which the
// bundle also excludes. A sub-directory is outside the snapshot by design.
//
// Usage:
//   python3 -m http.server 8799 &                       # serve repo root
//   chromium --headless --remote-debugging-port=9333 &  # any Chromium
//   node tools/eval/retrieval.mjs [--set tools/eval/retrieval-set-fresh.json] [--json out.json]
//
// Env: CDP_PORT (9333), HTTP_PORT (8799).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = process.env.CDP_PORT || '9333';
const HTTP = process.env.HTTP_PORT || '8799';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(HERE));
const argOf = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const SET_PATH = argOf('--set') || path.join(HERE, 'retrieval-set.json');
const SET = JSON.parse(fs.readFileSync(SET_PATH, 'utf8'));
// Pages that quote the test queries verbatim would match them spuriously
// (evaluation leakage). The accuracy write-up itself does exactly that, so it
// is filtered out of every ranked list and related block before scoring.
const EXCLUDE = ['kgs-accuracy'];
const AUDIT_PATH = path.join(HERE, 'edge-audit.json');
const jsonOut = argOf('--json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n, d) => (d ? (100 * n / d) : 0);
const fmt = (x) => x.toFixed(1);

// ---------------------------------------------------------------- browser ---
async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target — is Chromium running with --remote-debugging-port?');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((r) => {
    const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (m.result && m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
    return m.result.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  return { send, ev, close: () => ws.close() };
}

async function runLang(cdp, lang, queries) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html#!welcome` });
  await sleep(1200);
  await cdp.ev(`localStorage.setItem('wikiSettings', JSON.stringify({lang:'${lang}'})); location.reload(); 'ok'`);
  await sleep(2500);
  // Same readiness the search box waits for: knowledge index, then bodies.
  const ready = await cdp.ev(`(async()=>{
    await window.__loadKnowledge;
    ensureTextIndex();
    for(let i=0;i<150 && !TEXT_INDEX_READY;i++){ await new Promise(r=>setTimeout(r,200)); }
    return { lang: currentLang(), docs: DOCS.length, know: Object.keys(KNOWLEDGE||{}).length,
             bodies: Object.keys(DOC_TEXT).length, ready: TEXT_INDEX_READY };
  })()`);
  if (!ready.ready || ready.lang !== lang) throw new Error(`index not ready for ${lang}: ${JSON.stringify(ready)}`);
  const out = await cdp.ev(`(()=>{
    const QS = ${JSON.stringify(queries.map((q) => q.q))};
    const EX = ${JSON.stringify(EXCLUDE)};
    // Take excluded pages out of the pool itself, not just out of the results:
    // a page quoting the query verbatim would otherwise satisfy the strict pass
    // and keep the engine's fallback passes from ever running.
    EX.forEach(nm => { const i = DOCS.findIndex(d => d.name === nm); if (i >= 0) DOCS.splice(i, 1); });
    const top = (q, n) => searchDocs(q).map(x => x.d.name).filter(nm => EX.indexOf(nm) === -1).slice(0, n);
    const rel = (nm) => ((KNOWLEDGE[nm] && KNOWLEDGE[nm].related) || []).map(r => r.name).filter(x => EX.indexOf(x) === -1);
    return QS.map(q => {
      const terms = q.trim().toLowerCase().split(/\\s+/);
      const dead = terms.filter(t => top(t, 1).length === 0);
      const live = terms.filter(t => dead.indexOf(t) === -1).join(' ');
      const ranked = top(q, 20);
      return { ranked, dead, relaxed: live && dead.length ? top(live, 20) : null,
               related3: ranked.slice(0, 3).map(nm => [nm, rel(nm)]) };
    });
  })()`);
  return { ready, out };
}

// ---------------------------------------------------------------- metrics ---
function rankOf(ranked, gold) {
  for (let i = 0; i < ranked.length; i++) if (gold.includes(ranked[i])) return i + 1;
  return null;
}
function searchStats(rows) {
  const n = rows.length; let h1 = 0, h3 = 0, h8 = 0, rr = 0, zero = 0;
  for (const r of rows) {
    if (!r.ranked.length) zero++;
    const k = rankOf(r.ranked, r.gold);
    if (k) { rr += 1 / k; if (k <= 1) h1++; if (k <= 3) h3++; if (k <= 8) h8++; }
  }
  return { n, hit1: pct(h1, n), hit3: pct(h3, n), hit8: pct(h8, n), mrr: n ? rr / n : 0, zero: pct(zero, n) };
}

// ------------------------------------------------------------------ graph ---
// --graph-root <dir> reads the graph and ko bodies from another checkout (e.g.
// a worktree of the commit before a change) so a before/after pair shares one
// harness. Excluded pages leave the graph too: their edges and links vanish.
const GRAPH_ROOT = argOf('--graph-root') || ROOT;
function graphStats() {
  const g = JSON.parse(fs.readFileSync(path.join(GRAPH_ROOT, 'data', 'knowledge-graph.json'), 'utf8'));
  const nodes = g.nodes.filter((n) => !EXCLUDE.includes(n.name))
    .map((n) => ({ ...n, related: (n.related || []).filter((r) => !EXCLUDE.includes(r.name)) }));
  const names = new Set(nodes.map((n) => n.name));
  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  // author-drawn body links, ko bodies (the canonical source)
  const links = []; const linkPairs = new Set();
  const lst = JSON.parse(fs.readFileSync(path.join(GRAPH_ROOT, 'list'), 'utf8'));
  const pathOf = {};
  (function walk(ns) { for (const n of ns) { if (n.children) walk(n.children); else if (n.name && n.path) pathOf[n.name] = n.path; } })(lst);
  for (const a of names) {
    const p = path.join(GRAPH_ROOT, 'docs', 'ko', pathOf[a] || a);
    if (!fs.existsSync(p)) continue;
    const seen = new Set();
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/href="#!([a-z0-9-]+)"/g)) {
      const b = m[1]; if (b === a || !names.has(b) || seen.has(b)) continue;
      seen.add(b); links.push([a, b]); linkPairs.add(key(a, b));
    }
  }
  const relPairs = new Set();
  for (const n of nodes) for (const r of (n.relations || [])) if (names.has(r.target)) relPairs.add(key(n.name, r.target));
  // related edges, directed as the reader sees them
  const edges = []; for (const n of nodes) for (const r of (n.related || [])) edges.push([n.name, r.name, r.via]);
  const out = (a) => (byName[a] ? (byName[a].related || []).map((r) => r.name) : []);
  const backed = edges.filter(([a, b]) => linkPairs.has(key(a, b)) || relPairs.has(key(a, b)));
  const unbacked = edges.filter(([a, b]) => !(linkPairs.has(key(a, b)) || relPairs.has(key(a, b))));
  const sameFolder = (a, b) => byName[a] && byName[b] && byName[a].section === byName[b].section;
  let l1 = 0, l2 = 0, cross = 0, cross1 = 0, cross2 = 0;
  for (const [a, b] of links) {
    const o1 = out(a); const hit1 = o1.includes(b);
    const hit2 = hit1 || o1.some((m) => out(m).includes(b));
    if (hit1) l1++; if (hit2) l2++;
    if (!sameFolder(a, b)) { cross++; if (hit1) cross1++; if (hit2) cross2++; }
  }
  return {
    docs: nodes.length, edges: edges.length,
    viaConcept: edges.filter((e) => e[2] === 'concept').length,
    viaFolder: edges.filter((e) => e[2] === 'folder').length,
    backed: backed.length, backedPct: pct(backed.length, edges.length),
    links: links.length, linkRecall1: pct(l1, links.length), linkRecall2: pct(l2, links.length),
    crossLinks: cross, crossRecall1: pct(cross1, cross), crossRecall2: pct(cross2, cross),
    relPairs: relPairs.size,
    unbacked: unbacked.map(([a, b, via]) => ({ from: a, to: b, via,
      shared: ((byName[a].related || []).find((r) => r.name === b) || {}).shared || [] })),
  };
}

// ------------------------------------------------------------------- main ---
async function main() {
  const byLang = {};
  for (const q of SET.queries) (byLang[q.lang] = byLang[q.lang] || []).push(q);
  const cdp = await connect();
  const rows = [];
  for (const lang of Object.keys(byLang)) {
    const qs = byLang[lang];
    const { ready, out } = await runLang(cdp, lang, qs);
    console.log(`[${lang}] docs=${ready.docs} knowledge=${ready.know} bodies=${ready.bodies}`);
    qs.forEach((q, i) => rows.push({ ...q, ...out[i] }));
  }
  cdp.close();

  const report = { set: path.basename(SET_PATH), frozen: SET.frozen, excluded: EXCLUDE, when: new Date().toISOString(), search: {}, pairs: null, relaxed: {}, graph: null };
  console.log('\n== SEARCH (single-answer queries) ==');
  console.log('lang type      n  Hit@1  Hit@3  Hit@8   MRR  zero%');
  const single = rows.filter((r) => r.type !== 'pair');
  const groups = {};
  for (const r of single) (groups[`${r.lang}|${r.type}`] = groups[`${r.lang}|${r.type}`] || []).push(r);
  for (const k of Object.keys(groups)) {
    const s = searchStats(groups[k]); report.search[k] = s;
    const [l, t] = k.split('|');
    console.log(`${l.padEnd(4)} ${t.padEnd(8)} ${String(s.n).padStart(3)}  ${fmt(s.hit1).padStart(5)}  ${fmt(s.hit3).padStart(5)}  ${fmt(s.hit8).padStart(5)}  ${s.mrr.toFixed(2)}  ${fmt(s.zero).padStart(5)}`);
  }
  const all = searchStats(single); report.search.all = all;
  console.log(`ALL           ${String(all.n).padStart(3)}  ${fmt(all.hit1).padStart(5)}  ${fmt(all.hit3).padStart(5)}  ${fmt(all.hit8).padStart(5)}  ${all.mrr.toFixed(2)}  ${fmt(all.zero).padStart(5)}`);

  console.log('\n== WHAT-IF: sentence queries with dead terms dropped ==');
  for (const lang of Object.keys(byLang)) {
    const qs = single.filter((r) => r.lang === lang && r.type === 'question');
    if (!qs.length) continue;
    const base = searchStats(qs);
    const rel = searchStats(qs.map((r) => ({ ...r, ranked: r.relaxed || r.ranked })));
    const withDead = qs.filter((r) => r.dead.length).length;
    report.relaxed[lang] = { n: qs.length, withDeadTerms: withDead, before: base, after: rel };
    console.log(`${lang}: ${withDead}/${qs.length} had a dead term · Hit@8 ${fmt(base.hit8)} → ${fmt(rel.hit8)} · zero ${fmt(base.zero)} → ${fmt(rel.zero)}`);
  }

  const pr = rows.filter((r) => r.type === 'pair');
  if (pr.length) {
    let t3 = 0, t8 = 0, hop = 0, foot = 0, footHop = 0;
    for (const r of pr) {
      const top3 = r.ranked.slice(0, 3), top8 = r.ranked.slice(0, 8);
      const reach = new Set(top3); for (const [, rel] of r.related3) rel.forEach((x) => reach.add(x));
      if (r.gold.every((g) => top3.includes(g))) t3++;
      if (r.gold.every((g) => top8.includes(g))) t8++;
      if (r.gold.every((g) => reach.has(g))) hop++;
      // foothold: search put at least one of the pair in the top 3
      if (r.gold.some((g) => top3.includes(g))) { foot++; if (r.gold.every((g) => reach.has(g))) footHop++; }
    }
    report.pairs = { n: pr.length, top3: pct(t3, pr.length), top8: pct(t8, pr.length), top3PlusHop: pct(hop, pr.length),
                     foothold: foot, footholdCompleted: footHop };
    console.log(`\n== PAIRS (both docs needed), n=${pr.length} ==`);
    console.log(`search top-3: ${fmt(report.pairs.top3)}%  · search top-8: ${fmt(report.pairs.top8)}%  · top-3 + 1 hop related: ${fmt(report.pairs.top3PlusHop)}%`);
    console.log(`with a foothold (≥1 of the pair in top-3): ${foot}/${pr.length} · completed by 1 hop: ${footHop}/${foot}`);
  }

  const g = graphStats(); report.graph = { ...g, unbacked: g.unbacked.length };
  console.log(`\n== GRAPH == docs ${g.docs} · related edges ${g.edges} (concept ${g.viaConcept} · folder ${g.viaFolder})`);
  console.log(`backed by a body link or typed relation: ${g.backed}/${g.edges} = ${fmt(g.backedPct)}%`);
  console.log(`body links ${g.links}: recall 1-hop ${fmt(g.linkRecall1)}% · 2-hop ${fmt(g.linkRecall2)}%`);
  console.log(`  cross-folder links ${g.crossLinks}: recall 1-hop ${fmt(g.crossRecall1)}% · 2-hop ${fmt(g.crossRecall2)}%`);
  if (fs.existsSync(AUDIT_PATH)) {
    const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8')).verdicts || {};
    const judged = g.unbacked.filter((e) => audit[`${e.from}>${e.to}`]);
    const c = { related: 0, weak: 0, unrelated: 0 };
    judged.forEach((e) => { c[audit[`${e.from}>${e.to}`].v]++; });
    const good = g.backed + c.related;
    report.graph.audit = { judged: judged.length, ...c, precisionStrict: pct(good, g.edges), precisionLoose: pct(good + c.weak, g.edges) };
    console.log(`unbacked edges judged ${judged.length}/${g.unbacked.length}: related ${c.related} · weak ${c.weak} · unrelated ${c.unrelated}`);
    console.log(`edge precision (backed + judged related): strict ${fmt(report.graph.audit.precisionStrict)}% · counting weak ${fmt(report.graph.audit.precisionLoose)}%`);
  } else {
    console.log(`(no edge-audit.json — ${g.unbacked.length} unbacked edges not judged)`);
  }

  if (jsonOut) {
    report.rows = rows.map(({ id, lang, type, q, gold, ranked, dead, relaxed }) =>
      ({ id, lang, type, q, gold, top8: ranked.slice(0, 8), rank: rankOf(ranked, gold), dead, relaxedTop8: relaxed ? relaxed.slice(0, 8) : null }));
    report.unbackedEdges = g.unbacked;
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
    console.log(`\nwrote ${jsonOut}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
