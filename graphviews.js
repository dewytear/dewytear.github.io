/* graphviews.js
 * Vanilla-JS knowledge-graph renderers, ported from gen_graph_previews.py.
 * No external libraries, no build step.
 *
 * Usage:
 *   window.GraphViews.render('bundling', mountEl, model);
 *
 * model = {
 *   docs: [{name, title, clusterIndex, concepts: [string]}, ...],  // nav order
 *   edges: [[nameA, nameB], ...],                                  // undirected, deduped
 *   clusters: [{label, color, count, galaxy?}, ...],                // fixed order
 *   ink: {text, muted, grid, panel, surface},
 *   onDocClick: function(name) {}
 * }
 */
(function (window) {
  'use strict';

  function escapeHtml(s) {
    s = s == null ? '' : String(s);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Localized count strings arrive on model.strings (caller injects from its
  // i18n dictionary); {n} is the count. Korean fallbacks keep direct callers
  // and older models working.
  function fmt(tpl, n) {
    return String(tpl == null ? '' : tpl).replace('{n}', n);
  }
  function strings(P) {
    return (P && P.strings) || {};
  }

  // Clamp v into [lo, hi]; if the range is inverted (box too small to hold
  // both margins) fall back to the midpoint instead of producing NaN/garbage.
  function clampRange(v, lo, hi) {
    if (lo > hi) return (lo + hi) / 2;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function svg(w, h, parts) {
    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" ' +
      'style="width:100%;height:100%;display:block" font-family="inherit">' +
      parts.join('') +
      '</svg>'
    );
  }

  // ---------------------------------------------------------------- helpers

  // Build stable per-doc data: ordered array with clusterIndex, plus lookups.
  function prep(model) {
    var docs = model.docs || [];
    var clusters = model.clusters || [];
    var byName = {};
    var i;
    for (i = 0; i < docs.length; i++) byName[docs[i].name] = docs[i];
    // dedupe edges defensively, drop edges referencing unknown docs
    var seen = {};
    var edges = [];
    var rawEdges = model.edges || [];
    for (i = 0; i < rawEdges.length; i++) {
      var a = rawEdges[i][0], b = rawEdges[i][1];
      if (!byName[a] || !byName[b]) continue;
      var key = a < b ? a + '' + b : b + '' + a;
      if (seen[key]) continue;
      seen[key] = true;
      edges.push(a < b ? [a, b] : [b, a]);
    }
    edges.sort(function (x, y) {
      if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
      if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1;
      return 0;
    });
    return { docs: docs, clusters: clusters, byName: byName, edges: edges };
  }

  function cidx(byName, name) {
    return byName[name].clusterIndex;
  }

  // Delegated click handling: attach one listener on the svg root that
  // looks for a data-doc attribute on the clicked element or its ancestors.
  function wireClicks(rootEl, onDocClick) {
    if (typeof onDocClick !== 'function') return;
    rootEl.addEventListener('click', function (evt) {
      var el = evt.target;
      while (el && el !== rootEl) {
        var name = el.getAttribute && el.getAttribute('data-doc');
        if (name) {
          onDocClick(name);
          return;
        }
        el = el.parentNode;
      }
    });
  }

  // ---------------------------------------------------------------- A. bundling

  function figBundling(P) {
    var docs = P.docs, clusters = P.clusters, byName = P.byName, edges = P.edges;
    var ink = P.ink;
    var N = docs.length;
    var K = clusters.length;
    var W = P.W, H = P.H, cx = W / 2, cy = H / 2;
    var LABEL_PAD = 120;
    var R = Math.max(60, Math.min(W, H) / 2 - LABEL_PAD);
    var gap = (5 * Math.PI) / 180;
    var step = (2 * Math.PI - gap * K) / N;
    var ang = {};
    var a = -Math.PI / 2;
    var clusterSpan = {};
    var cur = null;
    var i, d, ci;
    for (i = 0; i < N; i++) {
      d = docs[i];
      ci = d.clusterIndex;
      if (ci !== cur) {
        if (cur !== null) a += gap;
        clusterSpan[ci] = [a, a];
        cur = ci;
      }
      ang[d.name] = a + step / 2;
      a += step;
      clusterSpan[ci][1] = a;
    }
    function pt(name, r) {
      r = r == null ? R : r;
      var t = ang[name];
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    }
    var s = [];
    for (i = 0; i < edges.length; i++) {
      var a1 = edges[i][0], b1 = edges[i][1];
      var p1 = pt(a1), p2 = pt(b1);
      var mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
      var qx = cx + (mx - cx) * 0.18, qy = cy + (my - cy) * 0.18;
      var col = clusters[cidx(byName, a1)].color;
      s.push(
        '<path d="M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) +
        ' Q' + qx.toFixed(1) + ' ' + qy.toFixed(1) + ' ' +
        p2[0].toFixed(1) + ' ' + p2[1].toFixed(1) +
        '" fill="none" stroke="' + col + '" stroke-width="1.1" opacity="0.38"/>'
      );
    }
    for (i = 0; i < N; i++) {
      d = docs[i];
      var p = pt(d.name);
      var color = clusters[d.clusterIndex].color;
      s.push(
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
        '" r="3.2" fill="' + color + '" style="cursor:pointer" data-doc="' +
        escapeHtml(d.name) + '"><title>' + escapeHtml(d.title) + '</title></circle>'
      );
    }
    for (ci in clusterSpan) {
      if (!Object.prototype.hasOwnProperty.call(clusterSpan, ci)) continue;
      var span = clusterSpan[ci];
      var mid = (span[0] + span[1]) / 2;
      var lx = cx + (R + 26) * Math.cos(mid), ly = cy + (R + 26) * Math.sin(mid);
      var anchor = Math.cos(mid) > 0.25 ? 'start' : Math.cos(mid) < -0.25 ? 'end' : 'middle';
      var halfW = Math.max(8, (clusters[ci].label || '').length * 4);
      lx = clampRange(lx, 8 + halfW, W - 8 - halfW);
      ly = clampRange(ly, 14, H - 8);
      s.push(
        '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="' + ink.text +
        '" font-size="13" font-weight="600" text-anchor="' + anchor +
        '" dominant-baseline="middle">' + escapeHtml(clusters[ci].label) + '</text>'
      );
    }
    return svg(W, H, s);
  }

  // ---------------------------------------------------------------- B. chord

  function figChord(P) {
    var clusters = P.clusters, byName = P.byName, edges = P.edges;
    var ink = P.ink;
    var st = strings(P);
    var K = clusters.length;
    var W = P.W, H = P.H, cx = W / 2, cy = H / 2;
    var LABEL_PAD = 120;
    var R = Math.max(60, Math.min(W, H) / 2 - LABEL_PAD);
    var TH = 18;
    var i, j;
    var M = [];
    for (i = 0; i < K; i++) {
      M.push([]);
      for (j = 0; j < K; j++) M[i].push(0);
    }
    for (i = 0; i < edges.length; i++) {
      var ei = cidx(byName, edges[i][0]), ej = cidx(byName, edges[i][1]);
      if (ei !== ej) {
        M[ei][ej] += 1;
        M[ej][ei] += 1;
      }
    }
    var totals = [];
    var grand = 0;
    for (i = 0; i < K; i++) {
      var sum = 0;
      for (j = 0; j < K; j++) sum += M[i][j];
      totals.push(Math.max(1, sum));
      grand += Math.max(1, sum);
    }
    var gap = (3 * Math.PI) / 180;
    var avail = 2 * Math.PI - gap * K;
    var s = [];
    var start = -Math.PI / 2;
    var arc = [];
    for (i = 0; i < K; i++) {
      var span = (avail * totals[i]) / grand;
      arc.push([start, start + span]);
      start += span + gap;
    }
    function xy(t, r) {
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    }
    function arcpath(a0, a1, r0, r1) {
      var large = a1 - a0 > Math.PI ? 1 : 0;
      var p0 = xy(a0, r1), p1 = xy(a1, r1), p2 = xy(a1, r0), p3 = xy(a0, r0);
      return (
        'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) +
        ' A' + r1.toFixed(1) + ' ' + r1.toFixed(1) + ' 0 ' + large + ' 1 ' +
        p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) +
        ' L' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1) +
        ' A' + r0.toFixed(1) + ' ' + r0.toFixed(1) + ' 0 ' + large + ' 0 ' +
        p3[0].toFixed(1) + ' ' + p3[1].toFixed(1) + ' Z'
      );
    }
    var cursor = [];
    var unit = [];
    for (i = 0; i < K; i++) {
      cursor.push(arc[i][0]);
      unit.push((arc[i][1] - arc[i][0]) / totals[i]);
    }
    for (i = 0; i < K; i++) {
      for (j = i + 1; j < K; j++) {
        if (!M[i][j]) continue;
        var a0 = cursor[i], a1v = a0 + unit[i] * M[i][j];
        cursor[i] = a1v;
        var b0 = cursor[j], b1 = b0 + unit[j] * M[i][j];
        cursor[j] = b1;
        var r = R - TH - 2;
        var pA0 = xy(a0, r), pA1 = xy(a1v, r);
        var pB0 = xy(b0, r), pB1 = xy(b1, r);
        var p =
          'M' + pA0[0].toFixed(1) + ' ' + pA0[1].toFixed(1) +
          ' A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 0 1 ' +
          pA1[0].toFixed(1) + ' ' + pA1[1].toFixed(1) +
          ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' +
          pB0[0].toFixed(1) + ' ' + pB0[1].toFixed(1) +
          ' A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 0 1 ' +
          pB1[0].toFixed(1) + ' ' + pB1[1].toFixed(1) +
          ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' +
          pA0[0].toFixed(1) + ' ' + pA0[1].toFixed(1) + ' Z';
        s.push(
          '<path d="' + p + '" fill="' + clusters[i].color + '" opacity="0.42" stroke="none"><title>' +
          escapeHtml(clusters[i].label) + ' ↔ ' + escapeHtml(clusters[j].label) +
          ' · ' + escapeHtml(fmt(st.linksN || '연관 {n}건', M[i][j])) + '</title></path>'
        );
      }
    }
    for (i = 0; i < K; i++) {
      var a0b = arc[i][0], a1b = arc[i][1];
      s.push(
        '<path d="' + arcpath(a0b, a1b, R - TH, R) + '" fill="' + clusters[i].color +
        '"><title>' + escapeHtml(clusters[i].label) + ' · ' +
        escapeHtml(fmt(st.crossN || 'System 간 연관 {n}건', totals[i])) + '</title></path>'
      );
      var mid = (a0b + a1b) / 2;
      var lp = xy(mid, R + 22);
      var anchor = Math.cos(mid) > 0.25 ? 'start' : Math.cos(mid) < -0.25 ? 'end' : 'middle';
      var halfW = Math.max(8, (clusters[i].label || '').length * 4);
      lp[0] = clampRange(lp[0], 8 + halfW, W - 8 - halfW);
      lp[1] = clampRange(lp[1], 14, H - 8);
      s.push(
        '<text x="' + lp[0].toFixed(1) + '" y="' + lp[1].toFixed(1) + '" fill="' + ink.text +
        '" font-size="13" font-weight="600" text-anchor="' + anchor +
        '" dominant-baseline="middle">' + escapeHtml(clusters[i].label) + '</text>'
      );
    }
    return svg(W, H, s);
  }

  // ---------------------------------------------------------------- C. packing

  function figPacking(P) {
    var docs = P.docs, clusters = P.clusters, ink = P.ink;
    var st = strings(P);
    var W = P.W, H = P.H;
    var s = [];
    var K = clusters.length;
    var i;

    // group clusters into galaxies by cluster.galaxy; clusters without one
    // share a single default galaxy that fills the whole canvas.
    var galaxyOrder = [];
    var galaxyMembers = {};
    var hasGalaxy = false;
    for (i = 0; i < K; i++) {
      if (clusters[i].galaxy) hasGalaxy = true;
    }
    for (i = 0; i < K; i++) {
      var g = hasGalaxy ? (clusters[i].galaxy || 'default') : 'all';
      if (!galaxyMembers[g]) {
        galaxyMembers[g] = [];
        galaxyOrder.push(g);
      }
      galaxyMembers[g].push(i);
    }

    // per-cluster doc counts
    var counts = [];
    for (i = 0; i < K; i++) counts.push(0);
    for (i = 0; i < docs.length; i++) counts[docs[i].clusterIndex] += 1;

    // per-galaxy doc totals -> size galaxies side by side. Slot widths use the
    // sqrt of doc share (not raw share) so a small World keeps enough room for
    // its circle and label instead of being squeezed to the very edge.
    var galDocs = [];
    var galWeight = [];
    var totalWeight = 0;
    for (i = 0; i < galaxyOrder.length; i++) {
      var members = galaxyMembers[galaxyOrder[i]];
      var n = 0;
      for (var m = 0; m < members.length; m++) n += counts[members[m]];
      n = Math.max(1, n);
      galDocs.push(n);
      var w = Math.sqrt(n);
      galWeight.push(w);
      totalWeight += w;
    }

    var margin = 20;
    var innerW = W - margin * 2;
    var cy = H / 2;
    // Reserve room above (WORLD label) and below (cluster name + count
    // labels) the galaxy circle so nothing sits outside the viewBox.
    var TOPPAD = 44, BOTTOMPAD = 44;
    var vertR = Math.max(40, H / 2 - TOPPAD - BOTTOMPAD);
    var maxR = Math.max(40, Math.min(vertR, W / 2 - margin));
    var x = margin;
    for (i = 0; i < galaxyOrder.length; i++) {
      var share = galWeight[i] / totalWeight;
      var slotW = innerW * share;
      var gr = Math.min(maxR, slotW / 2 - 10);
      gr = Math.max(gr, 40);
      var cgx = x + slotW / 2;
      // Keep the World label (drawn centered on cgx) inside the viewBox.
      cgx = clampRange(cgx, margin + gr, W - margin - gr);
      var cgy = cy;
      var gname = galaxyOrder[i] === 'all' || galaxyOrder[i] === 'default'
        ? null
        : galaxyOrder[i];

      s.push(
        '<circle cx="' + cgx.toFixed(1) + '" cy="' + cgy.toFixed(1) + '" r="' + gr.toFixed(1) +
        '" fill="' + ink.panel + '" stroke="' + ink.grid + '" stroke-width="1.5"/>'
      );
      if (gname) {
        var wy = clampRange(cgy - gr + 26, 14, H - 8);
        s.push(
          '<text x="' + cgx.toFixed(1) + '" y="' + wy.toFixed(1) + '" fill="' + ink.muted +
          '" font-size="15" font-weight="700" text-anchor="middle" letter-spacing="2">' +
          escapeHtml(gname.toUpperCase()) + ' WORLD</text>'
        );
      }

      var members = galaxyMembers[galaxyOrder[i]];
      var radii = {};
      var k = 3.4;
      for (var mi = 0; mi < members.length; mi++) {
        var ci = members[mi];
        // Cap the cluster circle so it (plus its label band below) stays
        // inside the galaxy circle, which is itself bounded to the box.
        radii[ci] = Math.max(18, Math.min(k * Math.sqrt(counts[ci]) * 2.4, gr - 34));
      }
      var centers = {};
      if (members.length === 1) {
        var soloR = radii[members[0]];
        var soloY = clampRange(cgy + 10, cgy - gr + soloR + 4, cgy + gr - soloR - 34);
        centers[members[0]] = [cgx, soloY];
      } else {
        var maxRadius = 0;
        for (var mr = 0; mr < members.length; mr++) {
          if (radii[members[mr]] > maxRadius) maxRadius = radii[members[mr]];
        }
        var ring = Math.max(0, gr - maxRadius - 18);
        for (var n_ = 0; n_ < members.length; n_++) {
          var ci2 = members[n_];
          var t = -Math.PI / 2 + (2 * Math.PI * n_) / members.length;
          var rr = members.length > 5 ? ring : ring * 0.8;
          centers[ci2] = [cgx + rr * 0.72 * Math.cos(t), cgy + 12 + rr * 0.72 * Math.sin(t)];
        }
      }

      for (var mj = 0; mj < members.length; mj++) {
        var ciX = members[mj];
        var center = centers[ciX];
        var ccx = center[0], ccy = center[1], cr = radii[ciX];
        var color = clusters[ciX].color;
        s.push(
          '<circle cx="' + ccx.toFixed(1) + '" cy="' + ccy.toFixed(1) + '" r="' + cr.toFixed(1) +
          '" fill="' + color + '" opacity="0.14"/>'
        );
        s.push(
          '<circle cx="' + ccx.toFixed(1) + '" cy="' + ccy.toFixed(1) + '" r="' + cr.toFixed(1) +
          '" fill="none" stroke="' + color + '" stroke-width="1.4" opacity="0.8"/>'
        );
        var memberDocs = [];
        for (var di = 0; di < docs.length; di++) {
          if (docs[di].clusterIndex === ciX) memberDocs.push(docs[di]);
        }
        var golden = Math.PI * (3 - Math.sqrt(5));
        for (var dn = 0; dn < memberDocs.length; dn++) {
          var rr2 = (cr - 9) * Math.sqrt((dn + 0.6) / memberDocs.length);
          var tt = dn * golden;
          var px = ccx + rr2 * Math.cos(tt), py = ccy + rr2 * Math.sin(tt);
          var doc = memberDocs[dn];
          s.push(
            '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3.4" fill="' + color +
            '" style="cursor:pointer" data-doc="' + escapeHtml(doc.name) + '"><title>' +
            escapeHtml(doc.title) + '</title></circle>'
          );
        }
        var lblHalfW = Math.max(8, (clusters[ciX].label || '').length * 3.5);
        var lblX = clampRange(ccx, margin + lblHalfW, W - margin - lblHalfW);
        var lblY1 = clampRange(ccy + cr + 13, 14, H - 8);
        var lblY2 = clampRange(ccy + cr + 26, 14, H - 8);
        s.push(
          '<text x="' + lblX.toFixed(1) + '" y="' + lblY1.toFixed(1) + '" fill="' + ink.text +
          '" font-size="11.5" font-weight="600" text-anchor="middle">' +
          escapeHtml(clusters[ciX].label) + '</text>'
        );
        s.push(
          '<text x="' + lblX.toFixed(1) + '" y="' + lblY2.toFixed(1) + '" fill="' + ink.muted +
          '" font-size="10.5" text-anchor="middle">' +
          escapeHtml(fmt(st.docsN || '{n}편', memberDocs.length)) + '</text>'
        );
      }

      x += slotW;
    }
    return svg(W, H, s);
  }

  // ---------------------------------------------------------------- D. concepts

  function figConcepts(P) {
    var docs = P.docs, clusters = P.clusters, ink = P.ink;
    var st = strings(P);
    var i, j, d;
    var df = {};
    var clusterOf = {}; // concept -> clusterIndex -> count
    for (i = 0; i < docs.length; i++) {
      d = docs[i];
      var seenHere = {};
      for (j = 0; j < d.concepts.length; j++) {
        var c = d.concepts[j];
        if (seenHere[c]) continue;
        seenHere[c] = true;
        df[c] = (df[c] || 0) + 1;
        if (!clusterOf[c]) clusterOf[c] = {};
        clusterOf[c][d.clusterIndex] = (clusterOf[c][d.clusterIndex] || 0) + 1;
      }
    }
    var nodes = [];
    for (var c2 in df) {
      if (Object.prototype.hasOwnProperty.call(df, c2) && df[c2] >= 4) nodes.push(c2);
    }
    nodes.sort(function (a, b) {
      return df[b] - df[a];
    });
    var nodeSet = {};
    for (i = 0; i < nodes.length; i++) nodeSet[nodes[i]] = true;

    var co = {};
    for (i = 0; i < docs.length; i++) {
      d = docs[i];
      var cs = [];
      var seenC = {};
      for (j = 0; j < d.concepts.length; j++) {
        var cc = d.concepts[j];
        if (nodeSet[cc] && !seenC[cc]) {
          seenC[cc] = true;
          cs.push(cc);
        }
      }
      cs.sort();
      for (var p1 = 0; p1 < cs.length; p1++) {
        for (var p2 = p1 + 1; p2 < cs.length; p2++) {
          var key = cs[p1] + '' + cs[p2];
          co[key] = (co[key] || 0) + 1;
        }
      }
    }
    var links = [];
    for (var key in co) {
      if (!Object.prototype.hasOwnProperty.call(co, key)) continue;
      if (co[key] >= 2) {
        var parts = key.split('');
        links.push([parts[0], parts[1], co[key]]);
      }
    }

    var W = P.W, H = P.H;
    // Concept-name labels sit ABOVE each node; leave enough top margin for
    // the tallest label plus half its width on the sides so it never spills
    // past the viewBox edges, whatever the box's aspect ratio.
    var maxNameLen = 0;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].length > maxNameLen) maxNameLen = nodes[i].length;
    }
    var PADX = clampRange(Math.max(50, maxNameLen * 4 + 20), 24, Math.max(24, W / 2 - 20));
    var PADTOP = 40;
    var PADBOTTOM = 40;
    var rng = mulberry32(42);
    function uniform(lo, hi) {
      return lo + rng() * (hi - lo);
    }
    var spanX = Math.min(200, Math.max(20, W / 2 - PADX));
    var spanY = Math.min(160, Math.max(20, H / 2 - PADTOP));
    var Pp = {};
    for (i = 0; i < nodes.length; i++) {
      Pp[nodes[i]] = [W / 2 + uniform(-spanX, spanX), H / 2 + uniform(-spanY, spanY)];
    }
    for (var iter = 0; iter < 320; iter++) {
      // repulsion
      for (i = 0; i < nodes.length; i++) {
        for (j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = Pp[b][0] - Pp[a][0], dy = Pp[b][1] - Pp[a][1];
          var d2 = Math.max(80.0, dx * dx + dy * dy);
          var f = 5200.0 / d2;
          var d_ = Math.sqrt(d2);
          var fx = (f * dx) / d_, fy = (f * dy) / d_;
          Pp[a][0] -= fx;
          Pp[a][1] -= fy;
          Pp[b][0] += fx;
          Pp[b][1] += fy;
        }
      }
      // springs
      for (i = 0; i < links.length; i++) {
        var la = links[i][0], lb = links[i][1], ln = links[i][2];
        var ddx = Pp[lb][0] - Pp[la][0], ddy = Pp[lb][1] - Pp[la][1];
        var dd_ = Math.max(1.0, Math.sqrt(ddx * ddx + ddy * ddy));
        var ff = ((dd_ - 130) * 0.012) * Math.min(ln, 4);
        var ffx = (ff * ddx) / dd_, ffy = (ff * ddy) / dd_;
        Pp[la][0] += ffx;
        Pp[la][1] += ffy;
        Pp[lb][0] -= ffx;
        Pp[lb][1] -= ffy;
      }
      // gravity + bounds
      for (i = 0; i < nodes.length; i++) {
        var cn = nodes[i];
        Pp[cn][0] += (W / 2 - Pp[cn][0]) * 0.012;
        Pp[cn][1] += (H / 2 - Pp[cn][1]) * 0.012;
        Pp[cn][0] = clampRange(Pp[cn][0], PADX, W - PADX);
        Pp[cn][1] = clampRange(Pp[cn][1], PADTOP, H - PADBOTTOM);
      }
    }

    var s = [];
    for (i = 0; i < links.length; i++) {
      var A = links[i][0], B = links[i][1], n = links[i][2];
      s.push(
        '<line x1="' + Pp[A][0].toFixed(1) + '" y1="' + Pp[A][1].toFixed(1) +
        '" x2="' + Pp[B][0].toFixed(1) + '" y2="' + Pp[B][1].toFixed(1) +
        '" stroke="' + ink.muted + '" stroke-width="' + Math.min(3.2, 0.8 + n * 0.55).toFixed(1) +
        '" opacity="0.3"><title>' + escapeHtml(A) + ' ↔ ' + escapeHtml(B) + '</title></line>'
      );
    }
    for (i = 0; i < nodes.length; i++) {
      var cn2 = nodes[i];
      var dom = 0, domCount = -1;
      for (var ck in clusterOf[cn2]) {
        if (!Object.prototype.hasOwnProperty.call(clusterOf[cn2], ck)) continue;
        if (clusterOf[cn2][ck] > domCount) {
          domCount = clusterOf[cn2][ck];
          dom = parseInt(ck, 10);
        }
      }
      var r = 5 + 2.1 * Math.sqrt(df[cn2]);
      var pos = Pp[cn2];
      s.push(
        '<circle cx="' + pos[0].toFixed(1) + '" cy="' + pos[1].toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + clusters[dom].color + '" stroke="' + ink.surface + '" stroke-width="2"><title>' +
        escapeHtml(cn2) + ' · ' + escapeHtml(fmt(st.conceptIn || '{n}편에 등장', df[cn2])) + '</title></circle>'
      );
      var nHalfW = Math.max(8, cn2.length * 4);
      var nlx = clampRange(pos[0], nHalfW + 4, W - nHalfW - 4);
      var nly = clampRange(pos[1] - r - 5, 12, H - 8);
      s.push(
        '<text x="' + nlx.toFixed(1) + '" y="' + nly.toFixed(1) + '" fill="' + ink.text +
        '" font-size="12" font-weight="600" text-anchor="middle">' + escapeHtml(cn2) + '</text>'
      );
    }
    return svg(W, H, s);
  }

  // ---------------------------------------------------------------- E. arc

  function figArc(P) {
    var docs = P.docs, clusters = P.clusters, ink = P.ink, edges = P.edges;
    var N = docs.length;
    var W = P.W, H = P.H;
    // BOTTOMPAD holds the doc tick (14px) + gap + cluster label (at base+34);
    // TOPPAD caps how tall an arc's apex may rise above the baseline.
    var BOTTOMPAD = Math.max(50, Math.min(80, H * 0.19));
    var TOPPAD = Math.max(16, H * 0.05);
    var base = H - BOTTOMPAD;
    var x0 = Math.max(24, Math.min(40, W * 0.05)), x1 = W - x0;
    var step = N > 1 ? (x1 - x0) / (N - 1) : 0;
    var X = {};
    var i;
    for (i = 0; i < N; i++) X[docs[i].name] = x0 + i * step;

    var s = [];
    for (i = 0; i < edges.length; i++) {
      var a = edges[i][0], b = edges[i][1];
      var xa = X[a], xb = X[b];
      if (xa > xb) {
        var tmp = xa; xa = xb; xb = tmp;
      }
      var r = (xb - xa) / 2;
      var ry = Math.max(4, Math.min(r, base - TOPPAD));
      s.push(
        '<path d="M' + xa.toFixed(1) + ' ' + base + ' A' + r.toFixed(1) + ' ' +
        ry.toFixed(1) + ' 0 0 1 ' + xb.toFixed(1) + ' ' + base +
        '" fill="none" stroke="' + clusters[P.byName[a].clusterIndex].color +
        '" stroke-width="1" opacity="0.35"/>'
      );
    }
    for (i = 0; i < N; i++) {
      var d = docs[i];
      var color = clusters[d.clusterIndex].color;
      s.push(
        '<rect x="' + (X[d.name] - 1.7).toFixed(1) + '" y="' + (base + 4) +
        '" width="3.4" height="14" rx="1.5" fill="' + color +
        '" style="cursor:pointer" data-doc="' + escapeHtml(d.name) + '"><title>' +
        escapeHtml(d.title) + '</title></rect>'
      );
    }
    var cur = null, startx = null, prev = null;
    for (i = 0; i <= N; i++) {
      var d2 = i < N ? docs[i] : null;
      var ci = d2 ? d2.clusterIndex : null;
      if (ci !== cur) {
        if (cur !== null) {
          var midx = (startx + X[prev]) / 2;
          var alHalfW = Math.max(8, (clusters[cur].label || '').length * 3.5);
          var alx = clampRange(midx, alHalfW + 4, W - alHalfW - 4);
          var aly = clampRange(base + 34, base + 14, H - 8);
          s.push(
            '<text x="' + alx.toFixed(1) + '" y="' + aly.toFixed(1) + '" fill="' + ink.muted +
            '" font-size="10.5" font-weight="600" text-anchor="middle">' +
            escapeHtml(clusters[cur].label) + '</text>'
          );
        }
        cur = ci;
        startx = d2 ? X[d2.name] : null;
      }
      if (d2) prev = d2.name;
    }
    return svg(W, H, s);
  }

  // ---------------------------------------------------------------- F. matrix

  function figMatrix(P) {
    var docs = P.docs, clusters = P.clusters, ink = P.ink, edges = P.edges;
    var N = docs.length;
    var K = clusters.length;
    var posInOrder = {};
    var i;
    for (i = 0; i < N; i++) posInOrder[docs[i].name] = i;
    var W = P.W, H = P.H;
    var pad = 8, LABELPAD = 16;
    // Fill the box: grow the cell to the largest square grid that fits,
    // then center it so the border margin is even on every side.
    var avail = Math.max(20, Math.min(W, H) - LABELPAD - pad * 2);
    var cell = N > 0 ? Math.max(2, avail / N) : avail;
    var gridSize = N * cell;
    var offX = (W - gridSize) / 2;
    var offY = (H - gridSize) / 2;
    var Sset = {};
    var Slist = [];
    for (i = 0; i < edges.length; i++) {
      var a = edges[i][0], b = edges[i][1];
      var ia = posInOrder[a], ib = posInOrder[b];
      var k1 = ia + '_' + ib, k2 = ib + '_' + ia;
      if (!Sset[k1]) { Sset[k1] = true; Slist.push([ia, ib]); }
      if (!Sset[k2]) { Sset[k2] = true; Slist.push([ib, ia]); }
    }
    Slist.sort(function (x, y) {
      if (x[0] !== y[0]) return x[0] - y[0];
      return x[1] - y[1];
    });

    var s = [
      '<rect x="' + offX.toFixed(1) + '" y="' + offY.toFixed(1) + '" width="' + gridSize.toFixed(1) +
      '" height="' + gridSize.toFixed(1) + '" fill="' + ink.panel + '" rx="4"/>'
    ];
    for (i = 0; i < N; i++) {
      s.push(
        '<rect x="' + (offX + i * cell).toFixed(1) + '" y="' + (offY + i * cell).toFixed(1) +
        '" width="' + (cell - 1).toFixed(1) + '" height="' + (cell - 1).toFixed(1) +
        '" fill="' + ink.grid + '" opacity="0.5"/>'
      );
    }
    for (i = 0; i < Slist.length; i++) {
      var ii = Slist[i][0], jj = Slist[i][1];
      var rowDoc = docs[ii], colDoc = docs[jj];
      s.push(
        '<rect x="' + (offX + jj * cell).toFixed(1) + '" y="' + (offY + ii * cell).toFixed(1) +
        '" width="' + (cell - 1).toFixed(1) + '" height="' + (cell - 1).toFixed(1) +
        '" fill="' + clusters[rowDoc.clusterIndex].color + '" style="cursor:pointer" data-doc="' +
        escapeHtml(rowDoc.name) + '"><title>' + escapeHtml(rowDoc.title) + ' ↔ ' +
        escapeHtml(colDoc.title) + '</title></rect>'
      );
    }
    var b = 0;
    for (var ci = 0; ci < K; ci++) {
      var n = 0;
      for (i = 0; i < N; i++) if (docs[i].clusterIndex === ci) n++;
      s.push(
        '<rect x="' + (offX + b * cell).toFixed(1) + '" y="' + (offY + b * cell).toFixed(1) +
        '" width="' + (n * cell).toFixed(1) + '" height="' + (n * cell).toFixed(1) +
        '" fill="none" stroke="' + clusters[ci].color + '" stroke-width="1.2" opacity="0.75"/>'
      );
      b += n;
    }
    return svg(W, H, s);
  }

  // ---------------------------------------------------------------- dispatch

  var RENDERERS = {
    bundling: figBundling,
    chord: figChord,
    packing: figPacking,
    concepts: figConcepts,
    arc: figArc,
    matrix: figMatrix
  };

  var KINDS = ['bundling', 'chord', 'packing', 'concepts', 'arc', 'matrix'];

  function render(kind, mountEl, model) {
    var fn = RENDERERS[kind];
    if (!fn) throw new Error('GraphViews.render: unknown kind "' + kind + '"');
    var P = prep(model);
    P.ink = model.ink || {};
    P.strings = model.strings || {};
    var W = Math.max(280, (model && model.width) || 760);
    var H = Math.max(280, (model && model.height) || W);
    P.W = W;
    P.H = H;
    var html = fn(P);
    mountEl.innerHTML = html;
    // Bind the click listener once per mount and re-read the latest model on
    // every click, so switching kinds on the same mount never stacks up
    // duplicate listeners (which would fire onDocClick more than once).
    mountEl.__gvModel = model;
    if (!mountEl.__gvWired) {
      mountEl.__gvWired = true;
      wireClicks(mountEl, function (name) {
        var m = mountEl.__gvModel;
        if (m && typeof m.onDocClick === 'function') m.onDocClick(name);
      });
    }
  }

  window.GraphViews = {
    KINDS: KINDS,
    render: render
  };
})(typeof window !== 'undefined' ? window : this);
