#!/usr/bin/env node
// Exhaustive diagram-bounds verifier (browser-rendered, exact).
//
// tools/validate_design.py already gates diagram overflow in CI using a
// per-character LOWER BOUND of text width — that is zero-false-positive but
// misses borderline cases. This script renders every diagram in a real
// headless browser and measures actual geometry, so it catches ALL overflow:
//   • a label whose rendered box exceeds the pill/node it sits in
//   • any shape or label drawn outside the SVG viewBox
// Run it pre-merge whenever diagrams change; the Python gate is the CI net.
//
// Usage:
//   python3 -m http.server 8799 &                       # serve repo root
//   chromium --headless --remote-debugging-port=9333 &  # any Chromium
//   node tools/check_diagram_bounds.mjs [route ...]      # default: all diagram docs
//
// Env: CDP_PORT (9333), HTTP_PORT (8799). Exits non-zero on any overflow.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = process.env.CDP_PORT || '9333';
const HTTP = process.env.HTTP_PORT || '8799';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function diagramRoutes() {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'list'), 'utf8'));
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.children) walk(n.children);
      else if (n.name && n.path) {
        const f = path.join(ROOT, 'docs', 'ko', n.path);
        if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('class="diagram"')) out.push(n.name);
      }
    }
  };
  walk(Array.isArray(list) ? list : list.children || []);
  return out;
}

async function main() {
  const routes = process.argv.slice(2).length ? process.argv.slice(2) : diagramRoutes();
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
  const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html#!welcome` });
  await new Promise((r) => setTimeout(r, 2500));

  const findings = [];
  for (const route of routes) {
    const hits = await ev(`(async()=>{
      location.hash='#!${route}';
      for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,60)); if(document.querySelector('#article .diagram svg')) break; }
      await new Promise(r=>setTimeout(r,120));
      const out=[];
      document.querySelectorAll('#article .diagram svg').forEach((svg,di)=>{
        const vb=svg.viewBox.baseVal, EPS=1.5, TOL=1.5;
        const boxes=[...svg.querySelectorAll('rect,circle,ellipse')].map(s=>{const b=s.getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};});
        boxes.forEach(b=>{ if(b.x<vb.x-EPS||b.x+b.w>vb.x+vb.width+EPS||b.y<vb.y-EPS||b.y+b.h>vb.y+vb.height+EPS)
          out.push({di,kind:'viewbox',what:'shape '+Math.round(b.x)+','+Math.round(b.y)+' '+Math.round(b.w)+'x'+Math.round(b.h)}); });
        svg.querySelectorAll('text').forEach(t=>{
          const b=t.getBBox(), cx=b.x+b.width/2, cy=b.y+b.height/2, txt=(t.textContent||'').slice(0,24);
          if(b.x<vb.x-EPS||b.x+b.width>vb.x+vb.width+EPS)
            out.push({di,kind:'viewbox',what:'label "'+txt+'" x'+Math.round(b.x)+'~'+Math.round(b.x+b.width)});
          const h=boxes.find(r=>cx>=r.x-2&&cx<=r.x+r.w+2&&cy>=r.y-2&&cy<=r.y+r.h+2);
          if(h){ const over=Math.max(h.x-b.x,(b.x+b.width)-(h.x+h.w));
            if(over>TOL) out.push({di,kind:'text',what:'label "'+txt+'" +'+Math.round(over)+'px (w'+Math.round(b.width)+' > box '+Math.round(h.w)+')'}); }
        });
      });
      return out;
    })()`);
    for (const h of (hits || [])) findings.push({ route, ...h });
    process.stdout.write(findings.some((f) => f.route === route) ? 'X' : '.');
  }
  ws.close();
  console.log(`\n${routes.length} diagram docs checked.`);
  if (findings.length) {
    console.log(`\n${findings.length} OVERFLOW(S):`);
    for (const f of findings) console.log(`  [${f.kind}] ${f.route} #${f.di}: ${f.what}`);
    process.exit(1);
  }
  console.log('OK: no text or viewBox overflow in any diagram.');
}

main().catch((e) => { console.error(e.message || e); process.exit(2); });
