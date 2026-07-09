#!/usr/bin/env python3
"""Validate that document diagrams follow the wiki's inline-SVG design system.

CLAUDE.md requires document-fragment diagrams to be inline `<svg>` inside
`<div class="diagram">`, colored only through style.css's `.d-box`/`.d-label`/
`.d-edge`/`.d-node` semantic classes (per-theme hex lives in style.css, not
in the doc). This guards the two ways that convention was broken once
already (see docs/ko/work-log/2026/07/09/wl-20260709-fable-diagrams-fix):
an external `<img src="*.svg">` file, or literal hex colors baked into an
otherwise-inline SVG.

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

def run(root):
    tree = load_list_tree(root)
    doc_nodes = list(iter_doc_nodes(tree))
    bodies = load_doc_bodies(root, doc_nodes)

    findings = []
    findings += check_external_svg(bodies)
    findings += check_diagram_hardcoded_color(bodies)
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
