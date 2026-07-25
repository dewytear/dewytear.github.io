// cosmos2.js — 지식그래프의 두 번째·세 번째 3D 뷰(WebGL).
//   3D-2 궤도계(orbit)   : World=항성 · System=행성 · 문서=위성. 실제로 공전한다.
//   3D-3 계층 스트라타(strata): World→Domain→System→Document 4계층을 유리판으로 쌓고
//                              상하 계보선과 문서층의 개념 엣지를 함께 보여 준다.
// 기존 3D(cosmos.js `startCosmos`)와 데이터·색 규약은 같지만 표현 문법이 다르다.
// 외부 라이브러리·빌드 없음(인라인 GLSL). WebGL이 없으면 start()가 false를 돌려주고
// 호출자(cosmos.js)가 기존 3D로 폴백한다.
(function (window) {
    'use strict';

    // ---- mat4 (열 우선) ----
    function mul(a, b) {
        var o = new Float32Array(16);
        for (var i = 0; i < 4; i++) {
            for (var j = 0; j < 4; j++) {
                var s = 0;
                for (var k = 0; k < 4; k++) { s += a[k * 4 + j] * b[i * 4 + k]; }
                o[i * 4 + j] = s;
            }
        }
        return o;
    }
    function persp(fov, asp, n, f) {
        var t = 1 / Math.tan(fov / 2);
        return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0,
            0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]);
    }
    function look(e, c, u) {
        var z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]];
        var zl = Math.hypot(z[0], z[1], z[2]) || 1;
        z = [z[0] / zl, z[1] / zl, z[2] / zl];
        var x = [u[1] * z[2] - u[2] * z[1], u[2] * z[0] - u[0] * z[2], u[0] * z[1] - u[1] * z[0]];
        var xl = Math.hypot(x[0], x[1], x[2]) || 1;
        x = [x[0] / xl, x[1] / xl, x[2] / xl];
        var y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
            -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]),
            -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]),
            -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1]);
    }

    // 결정적 난수 — 방문마다 같은 배치가 나오도록(기존 3D와 같은 방식).
    function hash(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
        return h;
    }
    function rnd(seed) { var x = Math.sin(seed) * 43758.5453; return x - Math.floor(x); }

    // ---- 색: 기존 3D와 동일한 accent 파생 규약(World 137.5° · System ±11°) ----
    var _cv = null;
    function toHsl(c) {
        _cv = _cv || document.createElement('canvas');
        var x = _cv.getContext('2d');
        x.fillStyle = '#000'; x.fillStyle = c;
        var v = x.fillStyle;
        if (v.charAt(0) !== '#') { return [25, 100, 50]; }
        var r = parseInt(v.substr(1, 2), 16) / 255,
            g = parseInt(v.substr(3, 2), 16) / 255,
            b = parseInt(v.substr(5, 2), 16) / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        var l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
        if (d) {
            s = d / (1 - Math.abs(2 * l - 1));
            h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h *= 60;
        }
        return [h, s * 100, l * 100];
    }
    function hsl2rgb(h, s, l) {
        h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
        var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)),
            m = l - c / 2, r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
        return [r + m, g + m, b + m];
    }

    // ---- 셰이더 ----
    var SOLID_V =
        'attribute vec3 aP; attribute float aSh; attribute vec3 aCol; attribute float aA;' +
        'uniform mat4 uVP; varying vec3 vC; varying float vA;' +
        'void main(){ vC = aCol * aSh; vA = aA; gl_Position = uVP * vec4(aP, 1.0); }';
    var SOLID_F =
        'precision mediump float; varying vec3 vC; varying float vA;' +
        'void main(){ gl_FragColor = vec4(vC, vA); }';
    var BILL_V =
        'attribute vec3 aC; attribute vec2 aO; attribute float aS; attribute vec3 aCol;' +
        'attribute float aA; uniform mat4 uVP; uniform vec3 uR, uU;' +
        'varying vec2 vO; varying vec3 vC; varying float vA;' +
        'void main(){ vO = aO; vC = aCol; vA = aA;' +
        '  gl_Position = uVP * vec4(aC + (uR * aO.x + uU * aO.y) * aS, 1.0); }';
    // uKind 0 = 부드러운 무리(성운·코로나), 1 = 구체(행성·문서), 2 = 별(코어+헤일로)
    var BILL_F =
        'precision mediump float; varying vec2 vO; varying vec3 vC; varying float vA;' +
        'uniform int uKind; uniform int uDay;' +
        'void main(){ float d = length(vO); if(d > 1.0) discard;' +
        '  if(uKind == 0){ float a = exp(-d*d*3.0);' +
        '    gl_FragColor = uDay == 1 ? vec4(vC, a*vA) : vec4(vC*a, a*vA); }' +
        '  else if(uKind == 1){ float e = smoothstep(1.0, 0.82, d);' +
        '    float sh = 0.58 + 0.42 * (1.0 - vO.y*0.85 - vO.x*0.35);' +
        '    gl_FragColor = vec4(vC*sh, e*vA); }' +
        '  else { float core = exp(-d*d*24.0); float halo = exp(-d*d*3.0)*0.5;' +
        '    float a = (core+halo)*vA;' +
        '    gl_FragColor = uDay == 1 ? vec4(vC, a) : vec4(vC*(core+halo), a); } }';
    var LINE_V =
        'attribute vec3 aP; attribute vec3 aCol; attribute float aA; attribute float aT;' +
        'uniform mat4 uVP; varying vec3 vC; varying float vA; varying float vT;' +
        'void main(){ vC = aCol; vA = aA; vT = aT; gl_Position = uVP * vec4(aP, 1.0); }';
    var LINE_F =
        'precision mediump float; varying vec3 vC; varying float vA; varying float vT;' +
        'uniform float uTime; uniform float uPulse;' +
        'void main(){ float a = vA;' +
        '  if(uPulse > 0.5){ float p = fract(vT - uTime * 0.3);' +
        '    a += exp(-p*p*70.0) * 0.85; }' +
        '  gl_FragColor = vec4(vC, a); }';

    function compile(gl, type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { return null; }
        return s;
    }
    function program(gl, v, f) {
        var vs = compile(gl, gl.VERTEX_SHADER, v), fs = compile(gl, gl.FRAGMENT_SHADER, f);
        if (!vs || !fs) { return null; }
        var p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
    }

    // ---- 지오메트리 수집기 ----
    function Solid() { this.P = []; this.S = []; this.C = []; this.A = []; }
    Solid.prototype.tri = function (a, b, c, sh, col, al) {
        var self = this;
        [a, b, c].forEach(function (p) {
            self.P.push(p[0], p[1], p[2]); self.S.push(sh);
            self.C.push(col[0], col[1], col[2]); self.A.push(al);
        });
    };
    Solid.prototype.quad = function (a, b, c, d, sh, col, al) {
        this.tri(a, b, c, sh, col, al); this.tri(a, c, d, sh, col, al);
    };
    Solid.prototype.plate = function (x, y, z, w, dp, col, al) {
        this.quad([x - w / 2, y, z - dp / 2], [x + w / 2, y, z - dp / 2],
                  [x + w / 2, y, z + dp / 2], [x - w / 2, y, z + dp / 2], 1, col, al);
    };
    function Lines() { this.P = []; this.C = []; this.A = []; this.T = []; }
    Lines.prototype.seg = function (a, b, col, al, t0, t1) {
        this.P.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        this.C.push(col[0], col[1], col[2], col[0], col[1], col[2]);
        this.A.push(al, al);
        this.T.push(t0 == null ? 0 : t0, t1 == null ? 1 : t1);
    };
    // 궤도 한 바퀴 — tilt(경사) + yaw(승교점) 두 각으로 궤도면을 서로 어긋나게 한다.
    function orbitPoint(cx, cy, cz, r, tilt, yaw, a) {
        var x = Math.cos(a) * r, y = Math.sin(a) * r * Math.sin(tilt),
            z = Math.sin(a) * r * Math.cos(tilt);
        var cw = Math.cos(yaw), sw = Math.sin(yaw);
        return [cx + x * cw + z * sw, cy + y, cz - x * sw + z * cw];
    }
    Lines.prototype.ring = function (cx, cy, cz, r, tilt, yaw, col, al, seg) {
        seg = seg || 84;
        var prev = null;
        for (var i = 0; i <= seg; i++) {
            var p = orbitPoint(cx, cy, cz, r, tilt, yaw, i / seg * 6.2832);
            if (prev) { this.seg(prev, p, col, al, (i - 1) / seg, i / seg); }
            prev = p;
        }
    };
    Lines.prototype.arc = function (a, b, lift, col, al, seg) {
        seg = seg || 16;
        var prev = null;
        for (var i = 0; i <= seg; i++) {
            var t = i / seg;
            var p = [a[0] + (b[0] - a[0]) * t,
                     a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * lift,
                     a[2] + (b[2] - a[2]) * t];
            if (prev) { this.seg(prev, p, col, al, (i - 1) / seg, i / seg); }
            prev = p;
        }
    };

    // 프레임마다 다시 채우는 빌보드 버퍼(사전 할당 — GC 압력 0).
    function Dyn(gl, maxQuads) {
        this.gl = gl; this.max = maxQuads; this.n = 0;
        this.c = new Float32Array(maxQuads * 18);
        this.o = new Float32Array(maxQuads * 12);
        this.s = new Float32Array(maxQuads * 6);
        this.col = new Float32Array(maxQuads * 18);
        this.a = new Float32Array(maxQuads * 6);
        var q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
        for (var i = 0; i < maxQuads; i++) {
            for (var k = 0; k < 6; k++) {
                this.o[i * 12 + k * 2] = q[k][0];
                this.o[i * 12 + k * 2 + 1] = q[k][1];
            }
        }
        this.bc = gl.createBuffer(); this.bo = gl.createBuffer(); this.bs = gl.createBuffer();
        this.bcol = gl.createBuffer(); this.ba = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bo);
        gl.bufferData(gl.ARRAY_BUFFER, this.o, gl.STATIC_DRAW);
    }
    Dyn.prototype.reset = function () { this.n = 0; };
    Dyn.prototype.add = function (p, size, col, alpha) {
        if (this.n >= this.max) { return; }
        var i = this.n++;
        for (var k = 0; k < 6; k++) {
            this.c[i * 18 + k * 3] = p[0];
            this.c[i * 18 + k * 3 + 1] = p[1];
            this.c[i * 18 + k * 3 + 2] = p[2];
            this.col[i * 18 + k * 3] = col[0];
            this.col[i * 18 + k * 3 + 1] = col[1];
            this.col[i * 18 + k * 3 + 2] = col[2];
            this.s[i * 6 + k] = size;
            this.a[i * 6 + k] = alpha;
        }
    };
    Dyn.prototype.flush = function () {
        var gl = this.gl, n = this.n;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bc);
        gl.bufferData(gl.ARRAY_BUFFER, this.c.subarray(0, n * 18), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bs);
        gl.bufferData(gl.ARRAY_BUFFER, this.s.subarray(0, n * 6), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bcol);
        gl.bufferData(gl.ARRAY_BUFFER, this.col.subarray(0, n * 18), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.ba);
        gl.bufferData(gl.ARRAY_BUFFER, this.a.subarray(0, n * 6), gl.DYNAMIC_DRAW);
    };

    function hasWebGL() {
        try {
            var c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext &&
                      (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }

    // ---- 모델: 기존 3D와 같은 소스·같은 필터(숨긴 대분류 제외) ----
    function buildModel() {
        var K = window.KNOWLEDGE;
        if (!K) { return null; }
        var eff = (typeof effSettings === 'function') ? effSettings() : {};
        var hidden = eff.hiddenCats || [];
        var labelMin = (eff.cosmosLabelMin != null && !isNaN(eff.cosmosLabelMin))
                     ? eff.cosmosLabelMin : 5;
        var names = Object.keys(K).filter(function (n) {
            var top = (K[n].section || '').split(' · ')[0];
            return hidden.indexOf(top) === -1;
        });
        if (!names.length) { return null; }
        var secs = [];
        names.forEach(function (n) {
            var s = K[n].section || '';
            if (secs.indexOf(s) === -1) { secs.push(s); }
        });
        secs.sort();
        var tops = [];
        secs.forEach(function (s) {
            var t = s.split(' · ')[0];
            if (tops.indexOf(t) === -1) { tops.push(t); }
        });
        tops.sort();
        var labelOf = {};
        if (window.KNOWLEDGE_STATS && KNOWLEDGE_STATS.clusters) {
            KNOWLEDGE_STATS.clusters.forEach(function (c) { labelOf[c.section] = c.label; });
        }
        var meta = {};
        tops.forEach(function (t, ti) {
            var mine = secs.filter(function (s) { return s.split(' · ')[0] === t; });
            mine.forEach(function (s, i) {
                meta[s] = { gi: ti, ci: i, cn: mine.length, top: t,
                            label: labelOf[s] || s.split(' · ').pop() };
            });
        });
        var indeg = {};
        names.forEach(function (n) {
            (K[n].related || []).forEach(function (r) { indeg[r.name] = (indeg[r.name] || 0) + 1; });
        });
        var have = {};
        names.forEach(function (n) { have[n] = 1; });
        var nodes = names.map(function (n) {
            return { name: n, title: K[n].title || n, sec: K[n].section || '',
                     concepts: K[n].concepts || [], ref: indeg[n] || 0,
                     rel: (K[n].related || []).filter(function (r) { return have[r.name]; })
                            .map(function (r) { return r.name; }),
                     x: 0, y: 0, z: 0, sx: 0, sy: 0, sw: 1 };
        });
        // 문서는 내비 순서(FOLDER_DOCS)를 따라 섹션 안에서 정렬 — 시리즈 순서가 살아 있게.
        var order = {};
        if (window.FOLDER_DOCS) {
            secs.forEach(function (s) {
                (FOLDER_DOCS[s] || []).forEach(function (d, i) { order[d.name] = i; });
            });
        }
        nodes.sort(function (a, b) {
            if (a.sec !== b.sec) { return a.sec < b.sec ? -1 : 1; }
            var oa = order[a.name] == null ? 999 : order[a.name];
            var ob = order[b.name] == null ? 999 : order[b.name];
            return oa - ob;
        });
        return { nodes: nodes, sections: secs, worlds: tops, meta: meta, labelMin: labelMin };
    }

    function palette(model) {
        var cs = getComputedStyle(document.body);
        var day = document.body.classList.contains('day');
        var base = toHsl((cs.getPropertyValue('--accent') || '#ff6600').trim());
        var sat = day ? Math.max(46, Math.min(66, base[1] * 0.72))
                      : Math.max(48, Math.min(74, base[1] * 1.45));
        var lig = day ? Math.max(44, Math.min(56, base[2] * 0.95))
                      : Math.max(54, Math.min(66, base[2] * 1.18));
        var sec = {}, world = [];
        model.sections.forEach(function (s) {
            var m = model.meta[s];
            sec[s] = hsl2rgb(base[0] + m.gi * 137.5 + (m.ci - (m.cn - 1) / 2) * 11, sat, lig);
            world[m.gi] = hsl2rgb(base[0] + m.gi * 137.5, sat, lig);
        });
        var mut = toHsl((cs.getPropertyValue('--muted') || '#888').trim());
        return { sec: sec, world: world, day: day,
                 ink: hsl2rgb(mut[0], mut[1], mut[2]),
                 bg: (function () {
                     var b = toHsl((cs.getPropertyValue('--bg') || '#fff').trim());
                     return hsl2rgb(b[0], b[1], b[2]);
                 })() };
    }

    // ================= 3D-2 궤도계 =================
    function sceneOrbit(gl, model, pal) {
        var L = new Lines(), suns = [], systems = [];
        // World마다 궤도 반경이 다르므로(=System 수), 항성 간격은 서로의 최외곽
        // 궤도가 겹치지 않을 만큼만 벌린다 — 화면 밖으로 새지 않게 하는 핵심.
        var reach = model.worlds.map(function (t) {
            var n = model.sections.filter(function (s) { return model.meta[s].top === t; }).length;
            return 2.2 + Math.max(0, n - 1) * 0.62 + 0.8;
        });
        var xs = [], cursor = 0;
        reach.forEach(function (r, i) {
            if (i === 0) { xs.push(0); cursor = r; return; }
            cursor += r + 1.6;
            xs.push(cursor);
            cursor += r;
        });
        var mid = (xs[0] - reach[0] + xs[xs.length - 1] + reach[reach.length - 1]) / 2;
        var extent = (xs[xs.length - 1] + reach[reach.length - 1]) - (xs[0] - reach[0]);
        model.worlds.forEach(function (t, ti) {
            var wx = xs[ti] - mid, wz = 0;
            suns.push({ p: [wx, 0, wz], col: pal.world[ti], label: t.toUpperCase() });
            var mine = model.sections.filter(function (s) { return model.meta[s].top === t; });
            mine.forEach(function (s, i) {
                var docs = model.nodes.filter(function (n) { return n.sec === s; });
                var orb = 2.2 + i * 0.62;
                var tilt = 0.2 + (i % 4) * 0.16;
                var oyaw = rnd(hash(s) % 617 + 5) * 6.2832;
                L.ring(wx, 0, wz, orb, tilt, oyaw, pal.sec[s], pal.day ? 0.34 : 0.28);
                systems.push({
                    sec: s, label: model.meta[s].label, col: pal.sec[s],
                    cx: wx, cz: wz, r: orb, tilt: tilt, yaw: oyaw,
                    ph: rnd(hash(s) % 733 + 1) * 6.2832,
                    spd: 0.05 / Math.sqrt(orb),
                    size: 0.2 + Math.min(0.3, docs.length * 0.02),
                    docs: docs.map(function (d, k) {
                        return { node: d, ang: rnd(hash(d.name) % 911 + 1) * 6.2832,
                                 orb: 0.34 + (k % 3) * 0.11 + Math.min(0.3, docs.length * 0.012),
                                 spd: 0.34 + rnd(hash(d.name) % 577 + 2) * 0.4,
                                 tilt: 0.4 + rnd(hash(d.name) % 383 + 3) * 0.8,
                                 yaw: rnd(hash(d.name) % 271 + 7) * 6.2832,
                                 size: 0.055 + d.ref * 0.014 };
                    })
                });
            });
        });
        // 카메라: 전체 폭이 화면에 들어오는 거리 + 상단 HUD를 피하려고 시선을
        // 살짝 위로(=콘텐츠가 아래로 내려온다).
        return { kind: 'orbit', lines: uploadLines(gl, L), suns: suns, systems: systems,
                 camTarget: [0, 0.6, 0], camDist: Math.max(10, extent * 0.98),
                 camPitch: -0.46, camYaw: 0.5 };
    }

    // ================= 3D-3 계층 스트라타 =================
    function sceneStrata(gl, model, pal) {
        var S = new Solid(), L = new Lines(), marks = [];
        var TIER = [4.4, 3.0, 1.6, 0];
        var span = 9;
        var domains = [];
        model.sections.forEach(function (s) {
            var d = s.split(' · ').slice(0, 2).join(' · ');
            if (domains.indexOf(d) === -1) { domains.push(d); }
        });
        var wx = {}, dx = {}, sx = {}, sz = {};
        model.worlds.forEach(function (w, i) {
            wx[w] = (i - (model.worlds.length - 1) / 2) * span * 0.62;
        });
        domains.forEach(function (d) {
            var w = d.split(' · ')[0];
            var sib = domains.filter(function (x) { return x.split(' · ')[0] === w; });
            dx[d] = wx[w] + (sib.indexOf(d) - (sib.length - 1) / 2) * 2.8;
        });
        model.sections.forEach(function (s) {
            var d = s.split(' · ').slice(0, 2).join(' · ');
            var sib = model.sections.filter(function (x) {
                return x.split(' · ').slice(0, 2).join(' · ') === d;
            });
            var k = sib.indexOf(s);
            sx[s] = dx[d] + (k - (sib.length - 1) / 2) * 1.45;
            sz[s] = (k % 2) ? 0.85 : -0.85;
        });
        var hx = span * 0.92, hz = 2.9;
        var tierLabels = ['World', 'Domain', 'System', 'Document'];
        TIER.forEach(function (y, i) {
            S.plate(0, y, 0, hx * 2, hz * 2, pal.ink, pal.day ? 0.05 : 0.07);
            [[-hx, -hz, hx, -hz], [hx, -hz, hx, hz], [hx, hz, -hx, hz], [-hx, hz, -hx, -hz]]
                .forEach(function (e) {
                    L.seg([e[0], y, e[1]], [e[2], y, e[3]], pal.ink, pal.day ? 0.3 : 0.24);
                });
            marks.push({ kind: 'tier', label: tierLabels[i], p: [-hx, y + 0.22, -hz] });
        });
        model.worlds.forEach(function (w, i) {
            marks.push({ kind: 'world', label: w.toUpperCase(), p: [wx[w], TIER[0], 0],
                         col: pal.world[i], size: 0.24 });
        });
        domains.forEach(function (d) {
            var w = d.split(' · ')[0], gi = model.worlds.indexOf(w);
            marks.push({ kind: 'domain', label: d.split(' · ').slice(1).join(' · '),
                         p: [dx[d], TIER[1], 0], col: pal.world[gi], size: 0.16 });
            L.seg([wx[w], TIER[0], 0], [dx[d], TIER[1], 0], pal.world[gi], pal.day ? 0.34 : 0.36);
        });
        model.sections.forEach(function (s) {
            var d = s.split(' · ').slice(0, 2).join(' · ');
            marks.push({ kind: 'system', label: model.meta[s].label, sec: s,
                         p: [sx[s], TIER[2], sz[s]], col: pal.sec[s], size: 0.14 });
            L.seg([dx[d], TIER[1], 0], [sx[s], TIER[2], sz[s]], pal.sec[s], pal.day ? 0.3 : 0.32);
            var docs = model.nodes.filter(function (n) { return n.sec === s; });
            var g = Math.max(1, Math.ceil(Math.sqrt(docs.length)));
            var rows = Math.ceil(docs.length / g);
            docs.forEach(function (n, k) {
                n.x = sx[s] + (k % g - (g - 1) / 2) * 0.32;
                n.y = TIER[3];
                n.z = sz[s] * 1.6 + (Math.floor(k / g) - (rows - 1) / 2) * 0.36;
                L.seg([sx[s], TIER[2], sz[s]], [n.x, n.y, n.z], pal.sec[s], pal.day ? 0.1 : 0.11);
            });
        });
        // 문서층의 개념 엣지 — 바닥 위로 낮게 뜬 호.
        var byName = {};
        model.nodes.forEach(function (n) { byName[n.name] = n; });
        model.nodes.forEach(function (n) {
            n.rel.forEach(function (m) {
                var b = byName[m];
                if (!b || n.name > m) { return; }
                L.arc([n.x, n.y, n.z], [b.x, b.y, b.z], 0.3, pal.sec[n.sec],
                      pal.day ? 0.14 : 0.15, 12);
            });
        });
        return { kind: 'strata', solid: uploadSolid(gl, S), lines: uploadLines(gl, L),
                 marks: marks, camTarget: [0, 2.1, 0], camDist: 16.5,
                 camPitch: -0.3, camYaw: 0.6 };
    }

    function uploadSolid(gl, S) {
        return { p: staticBuf(gl, S.P), s: staticBuf(gl, S.S), c: staticBuf(gl, S.C),
                 a: staticBuf(gl, S.A), n: S.P.length / 3 };
    }
    function uploadLines(gl, L) {
        return { p: staticBuf(gl, L.P), c: staticBuf(gl, L.C), a: staticBuf(gl, L.A),
                 t: staticBuf(gl, L.T), n: L.P.length / 3 };
    }
    function staticBuf(gl, arr) {
        var b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        return b;
    }

    // ---- 런타임 ----
    var RUN = null;

    function stop() {
        if (!RUN) { return; }
        if (RUN.overlay && RUN.overlay.parentNode) { RUN.overlay.parentNode.removeChild(RUN.overlay); }
        RUN.dead = true;
        RUN = null;
    }

    function start(canvas, kind) {
        stop();
        if (!canvas || !hasWebGL()) { return false; }
        var gl = canvas.getContext('webgl', { antialias: true, alpha: false,
                                              powerPreference: 'high-performance' })
              || canvas.getContext('experimental-webgl');
        if (!gl) { return false; }
        var model = buildModel();
        if (!model) { return false; }
        var pS = program(gl, SOLID_V, SOLID_F),
            pB = program(gl, BILL_V, BILL_F),
            pL = program(gl, LINE_V, LINE_F);
        if (!pS || !pB || !pL) { return false; }

        var pal = palette(model);
        var scene = kind === 'strata' ? sceneStrata(gl, model, pal) : sceneOrbit(gl, model, pal);
        var dyn = new Dyn(gl, model.nodes.length + model.sections.length * 2 +
                               model.worlds.length * 3 + 40);
        var focusLines = new Lines();   // 포커스 시에만 채우는 동적 라인

        // HUD 오버레이(라벨·카드) — 캔버스와 같은 부모에 얹는다.
        var overlay = document.createElement('div');
        overlay.className = 'c2-overlay';
        overlay.innerHTML = '<div class="c2-labels"></div>';
        canvas.parentNode.appendChild(overlay);

        var reduce = window.matchMedia
                  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        RUN = { gl: gl, canvas: canvas, overlay: overlay, model: model, pal: pal, scene: scene,
                dyn: dyn, pS: pS, pB: pB, pL: pL, kind: scene.kind, dead: false,
                yaw: scene.camYaw, pitch: scene.camPitch, dist: scene.camDist,
                target: scene.camTarget.slice(), wantTarget: scene.camTarget.slice(),
                wantDist: scene.camDist, drag: null, moved: 0, lastTouch: 0, auto: !reduce,
                hover: null, focus: null, reduce: reduce, t0: 0, focusLines: focusLines,
                labelPool: [], W: 0, H: 0, dpr: Math.min(window.devicePixelRatio || 1, 2),
                theme: document.body.className };

        bindInput(RUN);
        resize(RUN);
        window.addEventListener('resize', function () { if (RUN) { resize(RUN); } });
        if (window.ResizeObserver) {
            RUN.ro = new ResizeObserver(function () { if (RUN) { resize(RUN); } });
            RUN.ro.observe(canvas.parentNode);
        }
        requestAnimationFrame(function (t) { frame(RUN, t); });
        return true;
    }

    function resize(R) {
        var r = R.canvas.parentNode.getBoundingClientRect();
        R.W = Math.max(1, r.width); R.H = Math.max(1, r.height);
        R.canvas.width = Math.round(R.W * R.dpr);
        R.canvas.height = Math.round(R.H * R.dpr);
        R.canvas.style.width = R.W + 'px';
        R.canvas.style.height = R.H + 'px';
    }

    function bindInput(R) {
        var c = R.canvas;
        c.addEventListener('pointerdown', function (e) {
            R.drag = { x: e.clientX, y: e.clientY, yaw: R.yaw, pitch: R.pitch };
            R.moved = 0;
            try { c.setPointerCapture(e.pointerId); } catch (err) {}
        });
        c.addEventListener('pointermove', function (e) {
            R.lastTouch = performance.now();
            var r = c.getBoundingClientRect();
            if (R.drag) {
                var dx = e.clientX - R.drag.x, dy = e.clientY - R.drag.y;
                R.moved = Math.max(R.moved, Math.abs(dx) + Math.abs(dy));
                R.yaw = R.drag.yaw + dx * 0.006;
                R.pitch = Math.max(-1.35, Math.min(1.35, R.drag.pitch - dy * 0.005));
                R.auto = false;
            } else {
                R.hover = pick(R, e.clientX - r.left, e.clientY - r.top);
                c.style.cursor = R.hover ? 'pointer' : 'grab';
            }
        });
        c.addEventListener('pointerup', function (e) {
            if (R.drag && R.moved < 6) {
                var r = c.getBoundingClientRect();
                var hit = pick(R, e.clientX - r.left, e.clientY - r.top);
                if (hit) { setFocus(R, hit); } else { setFocus(R, null); }
            }
            R.drag = null;
        });
        c.addEventListener('pointercancel', function () { R.drag = null; });
        c.addEventListener('dblclick', function (e) {
            var r = c.getBoundingClientRect();
            var hit = pick(R, e.clientX - r.left, e.clientY - r.top);
            if (hit) { location.hash = '#!' + hit.name; }
        });
        c.addEventListener('wheel', function (e) {
            e.preventDefault();
            R.lastTouch = performance.now();
            R.wantDist = Math.max(R.scene.camDist * 0.28,
                          Math.min(R.scene.camDist * 2.2,
                                   R.wantDist * (e.deltaY > 0 ? 1.09 : 0.92)));
        }, { passive: false });
        R.keyHandler = function (e) {
            if (!RUN || RUN !== R) { return; }
            if (e.key === 'Escape' && R.focus) { setFocus(R, null); }
        };
        document.addEventListener('keydown', R.keyHandler);
    }

    // 화면 좌표 기준 최근접 문서 노드(반경 20px 안).
    function pick(R, mx, my) {
        var best = null, bd = 20 * 20;
        R.model.nodes.forEach(function (n) {
            if (!n.vis) { return; }
            var dx = n.sx - mx, dy = n.sy - my, dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = n; }
        });
        return best;
    }

    function setFocus(R, node) {
        R.focus = node;
        var card = R.overlay.querySelector('.c2-card');
        if (card) { card.parentNode.removeChild(card); }
        if (!node) {
            R.wantTarget = R.scene.camTarget.slice();
            R.wantDist = R.scene.camDist;
            return;
        }
        R.nbr = {};
        node.rel.forEach(function (m) { R.nbr[m] = 1; });
        R.model.nodes.forEach(function (n) {
            if (n.rel.indexOf(node.name) !== -1) { R.nbr[n.name] = 1; }
        });
        R.wantTarget = [node.x, node.y, node.z];
        R.wantDist = R.scene.camDist * 0.55;
        R.auto = false;
        R.overlay.appendChild(buildCard(R, node));
    }

    function S(key, fallback) {
        var v = (typeof STR === 'function') ? STR(key) : null;
        return (v && v !== key) ? v : fallback;
    }
    function esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(s)
             : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildCard(R, node) {
        var m = R.model.meta[node.sec] || {};
        var names = Object.keys(R.nbr || {});
        var byName = {};
        R.model.nodes.forEach(function (n) { byName[n.name] = n; });
        var items = names.slice(0, 6).map(function (k) {
            var t = byName[k];
            return '<li><a href="#!' + esc(k) + '">' + esc(t ? t.title : k) + '</a></li>';
        }).join('');
        var d = document.createElement('div');
        d.className = 'c2-card';
        d.innerHTML =
            '<button type="button" class="c2-close" aria-label="' + esc(S('c2Close', '닫기')) + '">&times;</button>'
          + '<div class="c2-eyebrow">' + esc((m.top || '') + (m.label ? ' · ' + m.label : '')) + '</div>'
          + '<h3 class="c2-title">' + esc(node.title) + '</h3>'
          + '<div class="c2-meta">' + esc(S('c2Refs', '피참조') + ' ' + node.ref + ' · '
              + S('c2Nbr', '이웃') + ' ' + names.length) + '</div>'
          + (node.concepts.length
              ? '<div class="c2-concepts">' + node.concepts.slice(0, 6).map(function (c) {
                    return '<span>' + esc(c) + '</span>';
                }).join('') + '</div>'
              : '')
          + (items ? '<ul class="c2-links">' + items + '</ul>' : '')
          + '<a class="c2-open" href="#!' + esc(node.name) + '">' + esc(S('c2Open', '문서 열기')) + ' &rarr;</a>';
        d.querySelector('.c2-close').addEventListener('click', function () { setFocus(R, null); });
        return d;
    }

    function project(VP, p, out) {
        var x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12];
        var y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13];
        var w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
        out[0] = x; out[1] = y; out[2] = w;
        return w > 0;
    }

    function frame(R, ms) {
        if (!R || R.dead || !R.canvas.isConnected) {
            if (R) {
                document.removeEventListener('keydown', R.keyHandler);
                if (R.ro) { R.ro.disconnect(); }
                if (R === RUN) { stop(); }
            }
            return;
        }
        // 테마·accent가 바뀌면 팔레트와 정적 지오메트리를 다시 만든다.
        if (document.body.className !== R.theme) {
            R.theme = document.body.className;
            R.pal = palette(R.model);
            R.scene = R.kind === 'strata' ? sceneStrata(R.gl, R.model, R.pal)
                                          : sceneOrbit(R.gl, R.model, R.pal);
        }
        var gl = R.gl, pal = R.pal, t = ms / 1000;
        if (!R.t0) { R.t0 = t; }
        var age = R.reduce ? 0 : (t - R.t0);

        // 카메라 이징
        for (var i = 0; i < 3; i++) {
            R.target[i] += (R.wantTarget[i] - R.target[i]) * 0.08;
        }
        R.dist += (R.wantDist - R.dist) * 0.1;
        if (!R.drag && !R.reduce && (R.auto || performance.now() - R.lastTouch > 5000)) {
            R.auto = true;
            R.yaw += 0.0015;
        }
        var eye = [R.target[0] + Math.cos(R.pitch) * Math.sin(R.yaw) * R.dist,
                   R.target[1] + Math.sin(-R.pitch) * R.dist,
                   R.target[2] + Math.cos(R.pitch) * Math.cos(R.yaw) * R.dist];
        var V = look(eye, R.target, [0, 1, 0]);
        var VP = mul(persp(Math.PI / 4.4, R.canvas.width / R.canvas.height, 0.1, 240), V);
        var right = [V[0], V[4], V[8]], up = [V[1], V[5], V[9]];

        gl.viewport(0, 0, R.canvas.width, R.canvas.height);
        gl.clearColor(pal.bg[0], pal.bg[1], pal.bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        var addBlend = pal.day ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE;

        R.dyn.reset();
        var labels = [];
        var dim = R.focus ? (pal.day ? 0.22 : 0.16) : 1;
        var tmp = [0, 0, 0];

        function screenOf(p) {
            if (!project(VP, p, tmp)) { return null; }
            return [(tmp[0] / tmp[2] * 0.5 + 0.5) * R.W, (-tmp[1] / tmp[2] * 0.5 + 0.5) * R.H, tmp[2]];
        }
        function nodeAlpha(n) {
            if (!R.focus) { return 1; }
            if (n === R.focus) { return 1; }
            return R.nbr && R.nbr[n.name] ? 0.92 : dim;
        }

        if (R.kind === 'orbit') {
            R.scene.suns.forEach(function (s) {
                R.dyn.add(s.p, 1.15, s.col, pal.day ? 0.1 : 0.2);
                R.dyn.add(s.p, 0.42, s.col, R.focus ? dim : 1);
                var sc = screenOf(s.p);
                if (sc) { labels.push({ cls: 'world', text: s.label, x: sc[0], y: sc[1] - 26, w: sc[2] }); }
            });
            R.scene.systems.forEach(function (sy) {
                var a = sy.ph + age * sy.spd;
                var p = orbitPoint(sy.cx, 0, sy.cz, sy.r, sy.tilt, sy.yaw, a);
                sy.pos = p;
                R.dyn.add(p, sy.size * 2.1, sy.col, (pal.day ? 0.07 : 0.14) * (R.focus ? 0.4 : 1));
                var sc = screenOf(p);
                if (sc) { labels.push({ cls: 'sys', text: sy.label, x: sc[0], y: sc[1] - 16, w: sc[2] }); }
                sy.docs.forEach(function (d) {
                    var b = d.ang + age * d.spd;
                    var q = orbitPoint(p[0], p[1], p[2], d.orb, d.tilt, d.yaw, b);
                    var n = d.node;
                    n.x = q[0]; n.y = q[1]; n.z = q[2];
                    var al = nodeAlpha(n);
                    R.dyn.add(q, d.size, n.col || sy.col, al);
                    var s2 = screenOf(q);
                    n.vis = !!s2;
                    if (s2) {
                        n.sx = s2[0]; n.sy = s2[1]; n.sw = s2[2];
                        var show = n === R.focus || n === R.hover
                                || (!R.focus && n.ref >= R.model.labelMin)
                                || (R.focus && R.nbr && R.nbr[n.name]);
                        if (show) {
                            labels.push({ cls: 'doc' + (n === R.focus ? ' on' : ''),
                                          text: n.title, x: s2[0], y: s2[1] - 12, w: s2[2] });
                        }
                    }
                });
            });
            // 행성 본체는 구체 스타일로 한 번 더(코어) — 위성보다 크게.
            R.scene.systems.forEach(function (sy) {
                if (!sy.pos) { return; }
                R.dyn.add(sy.pos, sy.size, sy.col, R.focus ? 0.5 : 1);
            });
        } else {
            R.scene.marks.forEach(function (mk) {
                if (mk.kind === 'tier') {
                    var s0 = screenOf(mk.p);
                    if (s0) { labels.push({ cls: 'tier', text: mk.label, x: s0[0], y: s0[1], w: s0[2] }); }
                    return;
                }
                R.dyn.add(mk.p, mk.size * (mk.kind === 'world' ? 2.6 : 1.9), mk.col,
                          (pal.day ? 0.1 : 0.2) * (R.focus ? 0.4 : 1));
                R.dyn.add(mk.p, mk.size, mk.col, R.focus ? 0.55 : 1);
                var sc = screenOf(mk.p);
                if (sc) {
                    labels.push({ cls: mk.kind === 'world' ? 'world' : 'sys', text: mk.label,
                                  x: sc[0], y: sc[1] - (mk.kind === 'world' ? 22 : 13), w: sc[2] });
                }
            });
            R.model.nodes.forEach(function (n) {
                var p = [n.x, n.y, n.z];
                R.dyn.add(p, 0.075 + n.ref * 0.016, n.col || pal.sec[n.sec], nodeAlpha(n));
                var sc = screenOf(p);
                n.vis = !!sc;
                if (sc) {
                    n.sx = sc[0]; n.sy = sc[1]; n.sw = sc[2];
                    var show = n === R.focus || n === R.hover
                            || (!R.focus && n.ref >= R.model.labelMin)
                            || (R.focus && R.nbr && R.nbr[n.name]);
                    if (show) {
                        labels.push({ cls: 'doc' + (n === R.focus ? ' on' : ''),
                                      text: n.title, x: sc[0], y: sc[1] - 12, w: sc[2] });
                    }
                }
            });
        }

        // --- 그리기: 정적 지오메트리 → 동적 빌보드 → 포커스 라인
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        if (R.scene.solid) { drawSolid(gl, R.pS, R.scene.solid, VP); }
        if (R.scene.lines) {
            drawLines(gl, R.pL, R.scene.lines, VP, t, 0, R.focus ? 0.35 : 1);
        }
        gl.blendFunc(gl.SRC_ALPHA, addBlend);
        R.dyn.flush();
        drawDyn(gl, R.pB, R.dyn, VP, right, up, R.kind === 'orbit' ? 1 : 1, pal.day);
        if (R.focus) {
            var FL = R.focusLines;
            FL.P.length = 0; FL.C.length = 0; FL.A.length = 0; FL.T.length = 0;
            var byName = {};
            R.model.nodes.forEach(function (n) { byName[n.name] = n; });
            Object.keys(R.nbr || {}).forEach(function (k) {
                var b = byName[k];
                if (!b) { return; }
                FL.arc([R.focus.x, R.focus.y, R.focus.z], [b.x, b.y, b.z],
                       R.kind === 'orbit' ? 0.2 : 0.35, R.pal.sec[R.focus.sec] || [1, 1, 1],
                       pal.day ? 0.7 : 0.8, 14);
            });
            if (FL.P.length) {
                var fb = uploadLines(gl, FL);
                gl.blendFunc(gl.SRC_ALPHA, addBlend);
                drawLines(gl, R.pL, fb, VP, t, 1, 1);
                gl.deleteBuffer(fb.p); gl.deleteBuffer(fb.c);
                gl.deleteBuffer(fb.a); gl.deleteBuffer(fb.t);
            }
        }
        paintLabels(R, labels);
        requestAnimationFrame(function (ts) { frame(R, ts); });
    }

    function attr(gl, p, name, b, size) {
        var l = gl.getAttribLocation(p, name);
        if (l < 0) { return; }
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
    }
    function drawSolid(gl, p, s, VP) {
        gl.useProgram(p);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uVP'), false, VP);
        attr(gl, p, 'aP', s.p, 3); attr(gl, p, 'aSh', s.s, 1);
        attr(gl, p, 'aCol', s.c, 3); attr(gl, p, 'aA', s.a, 1);
        gl.drawArrays(gl.TRIANGLES, 0, s.n);
    }
    function drawLines(gl, p, l, VP, time, pulse, scale) {
        gl.useProgram(p);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uVP'), false, VP);
        gl.uniform1f(gl.getUniformLocation(p, 'uTime'), time);
        gl.uniform1f(gl.getUniformLocation(p, 'uPulse'), pulse);
        attr(gl, p, 'aP', l.p, 3); attr(gl, p, 'aCol', l.c, 3);
        attr(gl, p, 'aA', l.a, 1); attr(gl, p, 'aT', l.t, 1);
        gl.drawArrays(gl.LINES, 0, l.n);
    }
    function drawDyn(gl, p, d, VP, right, up, kind, day) {
        gl.useProgram(p);
        gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uVP'), false, VP);
        gl.uniform3fv(gl.getUniformLocation(p, 'uR'), right);
        gl.uniform3fv(gl.getUniformLocation(p, 'uU'), up);
        gl.uniform1i(gl.getUniformLocation(p, 'uKind'), kind);
        gl.uniform1i(gl.getUniformLocation(p, 'uDay'), day ? 1 : 0);
        attr(gl, p, 'aC', d.bc, 3); attr(gl, p, 'aO', d.bo, 2); attr(gl, p, 'aS', d.bs, 1);
        attr(gl, p, 'aCol', d.bcol, 3); attr(gl, p, 'aA', d.ba, 1);
        gl.drawArrays(gl.TRIANGLES, 0, d.n * 6);
    }

    // HTML 라벨 — 캔버스 텍스트 대신 DOM으로 그려 테마 토큰·폰트를 그대로 쓴다.
    // 풀을 재사용하고 화면 격자 충돌 검사로 겹치는 라벨은 감춘다.
    function paintLabels(R, labels) {
        var host = R.overlay.firstChild;
        var pool = R.labelPool;
        while (pool.length < labels.length) {
            var el = document.createElement('div');
            el.className = 'c2-label';
            host.appendChild(el);
            pool.push(el);
        }
        var taken = [], used = 0;
        labels.sort(function (a, b) {
            var rank = { world: 0, tier: 1, sys: 2 };
            var ra = rank[a.cls.split(' ')[0]] == null ? 3 : rank[a.cls.split(' ')[0]];
            var rb = rank[b.cls.split(' ')[0]] == null ? 3 : rank[b.cls.split(' ')[0]];
            if (ra !== rb) { return ra - rb; }
            return a.w - b.w;
        });
        labels.forEach(function (L) {
            if (L.x < -140 || L.x > R.W + 140 || L.y < -40 || L.y > R.H + 40) { return; }
            var el = pool[used];
            el.className = 'c2-label ' + L.cls;
            if (el.textContent !== L.text) { el.textContent = L.text; }
            el.style.display = '';
            var hw = el.offsetWidth / 2 + 5, hh = el.offsetHeight / 2 + 3;
            var hit = false;
            for (var i = 0; i < taken.length; i++) {
                var tk = taken[i];
                if (Math.abs(L.x - tk.x) < hw + tk.hw && Math.abs(L.y - tk.y) < hh + tk.hh) {
                    hit = true; break;
                }
            }
            if (hit) { el.style.display = 'none'; return; }
            taken.push({ x: L.x, y: L.y, hw: hw, hh: hh });
            el.style.left = L.x + 'px';
            el.style.top = L.y + 'px';
            el.style.opacity = Math.max(0.2, Math.min(1, 2.3 - L.w / (R.dist * 0.9)));
            used++;
        });
        for (var k = used; k < pool.length; k++) { pool[k].style.display = 'none'; }
    }

    window.Cosmos2 = { start: start, stop: stop, supported: hasWebGL };
})(typeof window !== 'undefined' ? window : this);
