#!/usr/bin/env python3
"""Validate that document diagrams follow the wiki's inline-SVG design system.

CLAUDE.md requires document-fragment diagrams to be inline `<svg>` inside
`<div class="diagram">`, colored only through style.css's `.d-box`/`.d-label`/
`.d-edge`/`.d-node` semantic classes (per-theme hex lives in style.css, not
in the doc). This guards the two ways that convention was broken once
already (see docs/ko/work-log/2026/07/09/wl-20260709-fable-diagrams-fix):
an external `<img src="*.svg">` file, or literal hex colors baked into an
otherwise-inline SVG.

It also guards diagram layout (added 2026-07-10): a label must fit inside its
box (diagram-text-overflow) and every shape/label must stay within the viewBox
(diagram-viewbox-overflow), using a zero-false-positive lower-bound text-width
model (tools/diagram_metrics.json). The exact/borderline pass lives in the
browser verifier tools/check_diagram_bounds.mjs.

Usage:  python tools/validate_design.py [--repo PATH]

Exposes run(root) -> list[dict] so validate_all.py can compose this with
other validators. Each finding is
  {"level": "ERROR"|"WARN"|"INFO", "check": "<kebab-id>", "name": "<doc name or '-'>",
   "message": "<one line>"}
"""
import argparse
import json
import os
import re
import sys

LEVEL_RANK = {'ERROR': 0, 'WARN': 1, 'INFO': 2}

# src/fill 값의 따옴표는 "…" · '…' · 없음 세 형태 모두 잡는다 — 다른 AI
# 모델이 작성한 마크업은 따옴표 스타일이 다를 수 있다.
IMG_SVG_RE = re.compile(
    r'<img\b[^>]*\bsrc\s*=\s*(?:"[^"]*\.svg(?:[?#][^"]*)?"'
    r"|'[^']*\.svg(?:[?#][^']*)?'"
    r'|[^\s"\'>]*\.svg(?:[?#][^\s>]*)?)', re.I)
SVG_BLOCK_RE = re.compile(r'<svg\b.*?</svg>', re.S | re.I)
# 속성형(fill="#…"/'#…')과 style 인라인형(style="fill:#…")을 모두 검출.
HARDCODED_COLOR_RE = re.compile(
    r'\b(?:fill|stroke|stop-color)\s*[=:]\s*["\']?\s*(#[0-9a-fA-F]{3,8})', re.I)


# ---------------------------------------------------------------------------
# Loading (mirrors tools/validate_docs.py — modules stay self-contained,
# validate_all.py loads each independently and they don't cross-import)

def load_list_tree(root):
    with open(os.path.join(root, 'list'), encoding='utf-8') as f:
        return json.load(f)


def iter_doc_nodes(tree):
    def walk(nodes):
        for n in nodes:
            if n.get('children'):
                yield from walk(n['children'])
            elif n.get('name') and not n.get('route'):
                yield n
    yield from walk(tree if isinstance(tree, list) else tree.get('children', tree))


def load_doc_bodies(root, doc_nodes):
    bodies = {}
    for n in doc_nodes:
        if not n.get('path'):
            continue
        fpath = os.path.join(root, 'docs', 'ko', n['path'])
        if not os.path.isfile(fpath):
            continue
        with open(fpath, encoding='utf-8') as f:
            bodies[n['name']] = f.read()
    return bodies


# ---------------------------------------------------------------------------
# Checks

def check_external_svg(bodies):
    """Doc body references an external SVG file via <img> instead of an
    inline <svg> — parent-page CSS (.diagram .d-box etc.) can't reach inside
    an <img>, so the diagram is frozen out of theme switching."""
    findings = []
    for name, raw in bodies.items():
        for m in IMG_SVG_RE.finditer(raw):
            findings.append({
                'level': 'ERROR', 'check': 'doc-external-svg', 'name': name,
                'message': f'<img src="*.svg">로 외부 SVG 참조: {m.group(0)[:80]}',
            })
    return findings


def check_diagram_hardcoded_color(bodies):
    """Inline <svg> in a doc body uses a literal hex fill/stroke/stop-color
    instead of the .d-box/.d-label/.d-edge/.d-node semantic classes."""
    findings = []
    for name, raw in bodies.items():
        for svg in SVG_BLOCK_RE.findall(raw):
            hexes = HARDCODED_COLOR_RE.findall(svg)
            if hexes:
                sample = ', '.join(sorted(set(hexes))[:5])
                findings.append({
                    'level': 'ERROR', 'check': 'diagram-hardcoded-color', 'name': name,
                    'message': f'인라인 SVG에 hex 색 직접 사용({sample}) — .d-* 클래스 대신 하드코딩',
                })
    return findings


# ---------------------------------------------------------------------------
# Diagram bounds: text must fit inside its box, and every shape/label must stay
# within the SVG viewBox. Text width can't be rendered without a browser, so we
# use a per-character LOWER BOUND of the rendered advance (measured directly in
# the Pretendard diagram font, tools/diagram_metrics.json). Because the estimate
# never exceeds the true width, "estimate > box" implies a real overflow — the
# check has zero false positives (it may miss borderline cases, which the
# CDP verifier tools/check_diagram_bounds.mjs catches pre-merge). See the
# 2026-07-10 ops Work Log for how the metric table was calibrated.

_ATTR_CACHE = {}


def _attr(tag, name):
    m = re.search(r'\b' + name + r'\s*=\s*"([^"]*)"', tag)
    return m.group(1) if m else None


def _fnum(tag, name, default=None):
    v = _attr(tag, name)
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_diagram_metrics(root):
    path = os.path.join(root, 'tools', 'diagram_metrics.json')
    try:
        with open(path, encoding='utf-8') as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    return {'cjk': m.get('cjk', 0.95), 'fallback': m.get('fallback', 0.0),
            'chars': m.get('chars', {})}


def _is_cjk(ch):
    o = ord(ch)
    return (0xAC00 <= o <= 0xD7A3 or 0x1100 <= o <= 0x11FF or 0x3130 <= o <= 0x318F
            or 0x3400 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF)


def _nominal_fs(cls):
    c = cls or ''
    if 'd-label' in c and 'sm' in c:
        return 11.5
    if 'd-label' in c:
        return 13.0
    return 11.0


def _decode(s):
    import html
    return html.unescape(re.sub(r'<[^>]+>', '', s))


def _text_lines(inner):
    """Split a <text> inner body into rendered lines. A <tspan> with a non-zero
    dy starts a new line; inline tspans (no dy) stay on the current line."""
    parts = re.split(r'(<tspan\b[^>]*>.*?</tspan>)', inner, flags=re.S | re.I)
    lines, cur = [], ''
    for p in parts:
        if not p:
            continue
        if p.lower().startswith('<tspan'):
            dy = _fnum(p, 'dy', 0.0)
            txt = _decode(re.sub(r'</?tspan\b[^>]*>', '', p))
            if dy:
                lines.append(cur)
                cur = txt
            else:
                cur += txt
        else:
            cur += _decode(p)
    lines.append(cur)
    return [ln for ln in lines if ln.strip()] or ['']


def _line_width_lb(line, fs, M):
    total = 0.0
    for ch in line:
        total += M['cjk'] if _is_cjk(ch) else M['chars'].get(ch, M['fallback'])
    return total * fs


def _text_width_lb(inner, cls, M):
    fs = _nominal_fs(cls)
    return max(_line_width_lb(ln, fs, M) for ln in _text_lines(inner))


def _parse_svg(svg):
    vb = None
    m = re.search(r'viewBox\s*=\s*"([-\d.\s]+)"', svg)
    if m:
        nums = [float(x) for x in m.group(1).split()]
        if len(nums) == 4:
            vb = nums
    boxes = []  # (x, y, w, h)
    for tag in re.findall(r'<rect\b[^>]*>', svg):
        x, y = _fnum(tag, 'x'), _fnum(tag, 'y')
        w, h = _fnum(tag, 'width'), _fnum(tag, 'height')
        if None not in (x, y, w, h):
            boxes.append((x, y, w, h))
    for tag in re.findall(r'<circle\b[^>]*>', svg):
        cx, cy, r = _fnum(tag, 'cx'), _fnum(tag, 'cy'), _fnum(tag, 'r')
        if None not in (cx, cy, r):
            boxes.append((cx - r, cy - r, 2 * r, 2 * r))
    for tag in re.findall(r'<ellipse\b[^>]*>', svg):
        cx, cy = _fnum(tag, 'cx'), _fnum(tag, 'cy')
        rx, ry = _fnum(tag, 'rx'), _fnum(tag, 'ry')
        if None not in (cx, cy, rx, ry):
            boxes.append((cx - rx, cy - ry, 2 * rx, 2 * ry))
    texts = []  # (x, y, anchor, cls, inner)
    for m in re.finditer(r'<text\b([^>]*)>(.*?)</text>', svg, flags=re.S | re.I):
        head, inner = m.group(1), m.group(2)
        x, y = _fnum(head, 'x'), _fnum(head, 'y')
        if x is None or y is None:
            continue
        anchor = _attr(head, 'text-anchor') or 'start'
        texts.append((x, y, anchor, _attr(head, 'class') or '', inner))
    return vb, boxes, texts


def check_diagram_bounds(bodies, M):
    """Two gates per inline diagram SVG:
    diagram-text-overflow  — a label whose guaranteed-minimum width exceeds the
                             box it sits in (text spills out of its pill/node).
    diagram-viewbox-overflow — a shape or label that extends outside the viewBox
                             (drawn past the diagram frame)."""
    findings = []
    if not M:
        return findings
    TOL = 1.5
    EPS = 1.5
    for name, raw in bodies.items():
        for svg in SVG_BLOCK_RE.findall(raw):
            vb, boxes, texts = _parse_svg(svg)
            for x, y, anchor, cls, inner in texts:
                wlb = _text_width_lb(inner, cls, M)
                if anchor == 'middle':
                    lo, hi = x - wlb / 2, x + wlb / 2
                elif anchor == 'end':
                    lo, hi = x - wlb, x
                else:
                    lo, hi = x, x + wlb
                # containing box (text anchor point inside a box)
                host = None
                for (bx, by, bw, bh) in boxes:
                    if bx - 2 <= x <= bx + bw + 2 and by - 2 <= y <= by + bh + 2:
                        host = (bx, by, bw, bh)
                        break
                if host:
                    bx, by, bw, bh = host
                    over = max(bx - lo, hi - (bx + bw))
                    if over > TOL:
                        label = _decode(inner)[:22]
                        findings.append({
                            'level': 'ERROR', 'check': 'diagram-text-overflow', 'name': name,
                            'message': f'라벨 &ldquo;{label}&rdquo;이(가) 박스를 최소 {over:.0f}px 벗어남 '
                                       f'(추정폭≥{wlb:.0f} &gt; 박스 {bw:.0f}) — 박스를 넓히거나 문구를 줄일 것',
                        })
                if vb:
                    vx, vy, vw, vh = vb
                    if lo < vx - EPS or hi > vx + vw + EPS:
                        label = _decode(inner)[:22]
                        findings.append({
                            'level': 'ERROR', 'check': 'diagram-viewbox-overflow', 'name': name,
                            'message': f'라벨 &ldquo;{label}&rdquo;이(가) viewBox(0~{vw:.0f})를 벗어남 '
                                       f'(x {lo:.0f}~{hi:.0f}) — 좌표·viewBox 조정',
                        })
            if vb:
                vx, vy, vw, vh = vb
                for (bx, by, bw, bh) in boxes:
                    if bx < vx - EPS or bx + bw > vx + vw + EPS or by < vy - EPS or by + bh > vy + vh + EPS:
                        findings.append({
                            'level': 'ERROR', 'check': 'diagram-viewbox-overflow', 'name': name,
                            'message': f'도형(x{bx:.0f} y{by:.0f} {bw:.0f}×{bh:.0f})이 '
                                       f'viewBox({vw:.0f}×{vh:.0f})를 벗어남 — 좌표·viewBox 조정',
                        })
    return findings


# ---------------------------------------------------------------------------

def run(root):
    tree = load_list_tree(root)
    doc_nodes = list(iter_doc_nodes(tree))
    bodies = load_doc_bodies(root, doc_nodes)

    findings = []
    findings += check_external_svg(bodies)
    findings += check_diagram_hardcoded_color(bodies)
    findings += check_diagram_bounds(bodies, load_diagram_metrics(root))
    return findings


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    default_repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default=default_repo)
    args = parser.parse_args()

    findings = run(args.repo)
    findings.sort(key=lambda f: (LEVEL_RANK.get(f['level'], 9), f['check'], f['name']))

    counts = {'ERROR': 0, 'WARN': 0, 'INFO': 0}
    for f in findings:
        print(f"[{f['level']}] {f['check']} | {f['name']} | {f['message']}")
        counts[f['level']] = counts.get(f['level'], 0) + 1
    print(f"\nERROR {counts['ERROR']} · WARN {counts['WARN']} · INFO {counts['INFO']}")
    sys.exit(1 if counts['ERROR'] else 0)


if __name__ == '__main__':
    main()
