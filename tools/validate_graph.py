"""Validate the structural health of data/knowledge-index.ko.json's doc graph.

Checks operate purely on the index (docs[], stats.clusters) — no filesystem
doc bodies are read here (see validate_docs.py for that). Findings are
heuristics tuned for low false positives; only "dangling-ref" is an
objective-breakage ERROR.
"""
import argparse
import difflib
import importlib.util
import json
import os
import statistics
import sys

GENERIC_CONCEPT_SHARE = 0.20
SYNONYM_RATIO = 0.8
SYNONYM_MAX_LEN_DIFF = 4
WRONG_CLUSTER_MARGIN = 2
WRONG_CLUSTER_MIN_CONCEPTS = 3
OVER_CONNECTED_MIN_INDEGREE = 8


def _load_build_index(root):
    """Load tools/build_index.py as a module to reuse CLUSTER_LABELS_BY_LANG.

    The module has an `if __name__ == '__main__':` guard, so importing it
    under a non-'__main__' name does not trigger CLI execution.
    """
    path = os.path.join(root, 'tools', 'build_index.py')
    spec = importlib.util.spec_from_file_location('build_index_ref', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_index(root):
    path = os.path.join(root, 'data', 'knowledge-index.ko.json')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _finding(level, check, name, message):
    return {'level': level, 'check': check, 'name': name, 'message': message}


def _check_dangling_ref(docs, by_name):
    findings = []
    for d in docs:
        for r in d.get('related', []):
            rn = r.get('name')
            if rn not in by_name:
                findings.append(_finding(
                    'ERROR', 'dangling-ref', d['name'],
                    f"related에 존재하지 않는 문서 '{rn}' 참조"))
    return findings


def _check_isolated_doc(docs, indeg):
    findings = []
    for d in docs:
        name = d['name']
        if indeg.get(name, 0) > 0:
            continue
        related = d.get('related', [])
        has_concept_edge = any(r.get('via') == 'concept' for r in related)
        if has_concept_edge:
            findings.append(_finding(
                'INFO', 'isolated-doc', name,
                "다른 문서가 이 문서를 참조하지 않음(in-degree 0), "
                "본인 concept 연관은 있음"))
        else:
            findings.append(_finding(
                'WARN', 'isolated-doc', name,
                "다른 문서가 이 문서를 참조하지 않고(in-degree 0), "
                "본인 related도 folder 연관뿐(개념 중복 없음)"))
    return findings


def _check_over_connected(docs, indeg):
    findings = []
    values = [indeg.get(d['name'], 0) for d in docs]
    if len(values) < 2:
        return findings
    mean = statistics.mean(values)
    stdev = statistics.pstdev(values)
    threshold = mean + 2 * stdev
    for d in docs:
        name = d['name']
        c = indeg.get(name, 0)
        if c >= OVER_CONNECTED_MIN_INDEGREE and c > threshold:
            findings.append(_finding(
                'INFO', 'over-connected', name,
                f"in-degree {c} > 평균+2*표준편차({threshold:.1f}) — "
                "허브일 수 있으니 검토"))
    return findings


def _check_wrong_cluster(docs, cluster_labels):
    findings = []
    label_of_section = dict(cluster_labels)
    # concept frequency pool per cluster label (section -> label already
    # resolved); docs outside any known cluster label are skipped for pool
    # membership but still checked against pools that do exist.
    docs_by_label = {}
    for d in docs:
        label = label_of_section.get(d.get('section'))
        if label is None:
            continue
        docs_by_label.setdefault(label, []).append(d)

    if len(docs_by_label) < 2:
        return findings

    def pool_for(label, exclude_name):
        pool = {}
        for d in docs_by_label.get(label, []):
            if d['name'] == exclude_name:
                continue
            for c in d.get('concepts', []):
                pool[c] = pool.get(c, 0) + 1
        return pool

    for d in docs:
        name = d['name']
        own_label = label_of_section.get(d.get('section'))
        if own_label is None:
            continue
        concepts = d.get('concepts', [])
        if len(concepts) < WRONG_CLUSTER_MIN_CONCEPTS:
            continue
        own_pool = pool_for(own_label, name)
        own_score = sum(1 for c in concepts if c in own_pool)
        best_other_label, best_other_score = None, -1
        for label in docs_by_label:
            if label == own_label:
                continue
            other_pool = pool_for(label, name)
            score = sum(1 for c in concepts if c in other_pool)
            if score > best_other_score:
                best_other_label, best_other_score = label, score
        if best_other_label is not None and best_other_score >= own_score + WRONG_CLUSTER_MARGIN:
            findings.append(_finding(
                'WARN', 'wrong-cluster', name,
                f"own {own_label} {own_score}점 vs {best_other_label}클러스터 {best_other_score}점"))
    return findings


def _check_generic_concept(docs):
    findings = []
    total = len(docs)
    if total == 0:
        return findings
    freq = {}
    for d in docs:
        for c in set(d.get('concepts', [])):
            freq[c] = freq.get(c, 0) + 1
    threshold = total * GENERIC_CONCEPT_SHARE
    for c, n in sorted(freq.items(), key=lambda t: (-t[1], t[0])):
        if n > threshold:
            share = n / total
            findings.append(_finding(
                'WARN', 'generic-concept', '-',
                f"'{c}' 개념이 {n}/{total}개 문서({share:.0%})에 등장 — 너무 일반적"))
    return findings


def _check_synonym_concept(docs):
    findings = []
    counts = {}
    for d in docs:
        for c in d.get('concepts', []):
            counts[c] = counts.get(c, 0) + 1

    concepts = sorted(counts.keys())
    seen = set()
    for i, a in enumerate(concepts):
        for b in concepts[i + 1:]:
            key = (a, b)
            if key in seen:
                continue
            seen.add(key)
            if counts[a] == 1 and counts[b] == 1:
                continue
            a_l, b_l = a.lower(), b.lower()
            if a_l == b_l:
                continue
            contained = a_l in b_l or b_l in a_l
            len_diff = abs(len(a_l) - len(b_l))
            if contained and len_diff <= SYNONYM_MAX_LEN_DIFF:
                findings.append(_finding(
                    'INFO', 'synonym-concept', '-',
                    f"'{a}'(n={counts[a]}) / '{b}'(n={counts[b]}) — 포함 관계, "
                    "동의어보다 상하위 개념일 수 있음"))
                continue
            ratio = difflib.SequenceMatcher(None, a_l, b_l).ratio()
            if not contained and ratio >= SYNONYM_RATIO:
                findings.append(_finding(
                    'WARN', 'synonym-concept', '-',
                    f"'{a}'(n={counts[a]}) / '{b}'(n={counts[b]}) — 유사도 {ratio:.2f}, 동의어 의심"))
    return findings


def run(root):
    index = _load_index(root)
    docs = index.get('docs', [])
    by_name = {d['name']: d for d in docs}

    indeg = {}
    for d in docs:
        for r in d.get('related', []):
            indeg[r['name']] = indeg.get(r['name'], 0) + 1

    build_index_mod = _load_build_index(root)
    cluster_labels = build_index_mod.CLUSTER_LABELS_BY_LANG.get('ko', [])

    findings = []
    findings += _check_dangling_ref(docs, by_name)
    findings += _check_isolated_doc(docs, indeg)
    findings += _check_over_connected(docs, indeg)
    findings += _check_wrong_cluster(docs, cluster_labels)
    findings += _check_generic_concept(docs)
    findings += _check_synonym_concept(docs)
    return findings


_LEVEL_ORDER = {'ERROR': 0, 'WARN': 1, 'INFO': 2}


def _sort_key(f):
    return (_LEVEL_ORDER.get(f['level'], 3), f['check'], f['name'])


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

    parser = argparse.ArgumentParser(description='Validate the knowledge graph structure.')
    default_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser.add_argument('--repo', default=default_root)
    args = parser.parse_args()

    findings = run(args.repo)
    findings.sort(key=_sort_key)

    counts = {'ERROR': 0, 'WARN': 0, 'INFO': 0}
    for f in findings:
        print(f"[{f['level']}] {f['check']} | {f['name']} | {f['message']}")
        counts[f['level']] = counts.get(f['level'], 0) + 1

    print(f"validate_graph: {counts['ERROR']} errors, {counts['WARN']} warnings, {counts['INFO']} infos")
    sys.exit(1 if counts['ERROR'] else 0)


if __name__ == '__main__':
    main()
