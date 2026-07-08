#!/usr/bin/env python3
"""One-off PR helper: register the Thariq/Fable 5 article, rebuild indexes, validate.

This file is intentionally temporary and is removed before merge.
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTICLE_NAME = "news-20260709-thariq-fable5-unknowns"
ARTICLE_PATH = f"ai/news/2026/{ARTICLE_NAME}"
LOG_NAME = "wl-20260709-thariq-fable5-article"
LOG_PATH = f"work-log/2026/07/09/{LOG_NAME}"

ARTICLE_NODE = {
    "name": ARTICLE_NAME,
    "path": ARTICLE_PATH,
    "label": "Fable 5 — 지도와 영토, unknown 관리",
    "model": "GPT-5.5 Thinking",
    "tags": [
        "Fable 5", "Claude Code", "capability overhang", "지도와 영토",
        "unknown", "프롬프트", "에이전트"
    ],
}

LOG_NODE = {
    "name": LOG_NAME,
    "path": LOG_PATH,
    "label": "타릭 Fable 5 분석 기사 등록",
    "tags": [],
}

INDEX_ENTRY = {
    "name": ARTICLE_NAME,
    "title": "Fable 5 시대의 병목은 모델이 아니라 인간인가 — 타릭의 지도와 영토 프레임",
    "summary": "타릭의 Fable 5 경험을 바탕으로 capability overhang, 지도와 영토, unknown 관리와 여섯 가지 실전 기법을 사실 검증과 외부 연구로 분석한다.",
    "concepts": [
        "Fable 5", "Claude Code", "capability overhang", "지도와 영토",
        "unknown unknowns", "에이전트", "프롬프트", "도구사용",
        "장기작업", "구현노트"
    ],
}


def run(*cmd: str) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def child(nodes: list[dict], title: str) -> dict:
    for node in nodes:
        if node.get("title") == title:
            return node
    raise KeyError(f"missing branch title: {title}")


def ensure_node(nodes: list[dict], new_node: dict) -> None:
    matches = [n for n in nodes if n.get("name") == new_node["name"]]
    if not matches:
        nodes.append(new_node)
    elif len(matches) > 1:
        raise RuntimeError(f"duplicate node: {new_node['name']}")
    else:
        # Keep the operation idempotent but enforce the required metadata.
        matches[0].update(new_node)


def register_list() -> None:
    path = ROOT / "list"
    tree = json.loads(path.read_text(encoding="utf-8"))

    ai = child(tree, "AI")
    news = child(ai["children"], "News & Articles")
    year = child(news["children"], "2026")
    ensure_node(year["children"], ARTICLE_NODE)

    work = child(tree, "Work Log")
    work_year = child(work["children"], "2026")
    month = child(work_year["children"], "07월")
    day = next((n for n in month["children"] if n.get("title") == "09일"), None)
    if day is None:
        day = {"title": "09일", "children": []}
        month["children"].append(day)
    ensure_node(day["children"], LOG_NODE)

    path.write_text(json.dumps(tree, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")


def register_index_entry() -> None:
    path = ROOT / "tools" / "doc-entries.ko.json"
    entries = json.loads(path.read_text(encoding="utf-8"))
    matches = [e for e in entries if e.get("name") == ARTICLE_NAME]
    if not matches:
        entries.append(INDEX_ENTRY)
    elif len(matches) > 1:
        raise RuntimeError(f"duplicate index entry: {ARTICLE_NAME}")
    else:
        matches[0].update(INDEX_ENTRY)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def replace_first_two_numbers(text: str, a: int, b: int) -> str:
    values = iter((str(a), str(b)))
    return re.sub(r"\d+", lambda m: next(values, m.group(0)), text, count=2)


def update_map_fallback(lang: str) -> None:
    index_path = ROOT / "data" / f"knowledge-index.{lang}.json"
    map_path = ROOT / "docs" / lang / "ai" / "map" / "ai-map"
    if not map_path.exists():
        return

    index = json.loads(index_path.read_text(encoding="utf-8"))
    stats = index.get("stats") or {}
    galaxy = (stats.get("galaxies") or {}).get("AI", stats)
    clusters = {c["label"]: c for c in galaxy.get("clusters", [])}
    text = map_path.read_text(encoding="utf-8")

    for label, cluster in clusters.items():
        label_html = html.escape(label, quote=False)
        # One fallback row per cluster. Keep the human-authored topic cell,
        # refresh only generated count + hub route/title.
        pattern = re.compile(
            r'(<tr><td><strong>' + re.escape(label_html) +
            r'</strong></td><td>)\d+(</td><td>.*?</td><td><a href="#!)[\w-]+(">).*?(</a></td></tr>)'
        )
        replacement = (
            r'\g<1>' + str(cluster["count"]) + r'\g<2>' +
            cluster["hub"]["name"] + r'\g<3>' +
            html.escape(cluster["hub"]["title"], quote=False) + r'\g<4>'
        )
        text, n = pattern.subn(replacement, text, count=1)
        if n != 1:
            raise RuntimeError(f"map fallback row not found: {lang} / {label}")

    totals_re = re.compile(r'(<p class="scn-sub" id="km-totals">)(.*?)(</p>)')
    m = totals_re.search(text)
    if not m:
        raise RuntimeError(f"km-totals not found: {lang}")
    updated = replace_first_two_numbers(
        m.group(2), int(galaxy.get("docCount", 0)), int(galaxy.get("conceptCount", 0))
    )
    text = text[:m.start()] + m.group(1) + updated + m.group(3) + text[m.end():]
    map_path.write_text(text, encoding="utf-8")


def assert_registered() -> None:
    tree = json.loads((ROOT / "list").read_text(encoding="utf-8"))

    def walk(nodes):
        for n in nodes:
            yield n
            if isinstance(n.get("children"), list):
                yield from walk(n["children"])

    all_nodes = list(walk(tree))
    assert sum(n.get("name") == ARTICLE_NAME for n in all_nodes) == 1
    assert sum(n.get("name") == LOG_NAME for n in all_nodes) == 1

    for lang in ("ko", "en"):
        idx = json.loads((ROOT / "data" / f"knowledge-index.{lang}.json").read_text(encoding="utf-8"))
        docs = {d["name"]: d for d in idx["docs"]}
        assert ARTICLE_NAME in docs, f"article missing in {lang} index"
        assert LOG_NAME not in docs, f"work log must stay unindexed ({lang})"
        assert docs[ARTICLE_NAME]["section"] == "AI · News & Articles · 2026"
        assert idx["docCount"] == len(idx["docs"])
        assert docs[ARTICLE_NAME].get("related"), f"article has no related docs ({lang})"

    print("ASSERTIONS: article indexed in ko/en, work log excluded, section/related OK")


def main() -> int:
    register_list()
    register_index_entry()

    run(sys.executable, "tools/build_index.py")
    update_map_fallback("ko")
    update_map_fallback("en")

    # Date metadata is part of the visible document contract.
    dates = ROOT / "tools" / "build_dates.py"
    if dates.exists():
        run(sys.executable, "tools/build_dates.py")

    run(sys.executable, "tools/build_index.py", "--check")
    assert_registered()
    run(sys.executable, "tools/validate_all.py")
    print("REGISTRATION_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
