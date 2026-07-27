#!/usr/bin/env python3
"""Validate the i18n side-channels described in tools/i18n.md stay in sync:
translated bodies mirror the Korean path, derived data (label_<lang>, doc
index overlays, map data-topics, STRINGS) travels with the body translation
it belongs to, per the "docs/i18n" rules in CLAUDE.md.

Usage:  python3 tools/validate_i18n.py [--repo PATH]

Exposes run(root) -> list[finding] for tools/validate_all.py to compose with
the other validators; finding = {"level", "check", "name", "message"}.
"""
import argparse
import importlib.util
import json
import os
import re
import sys


def _f(level, check, name, message):
    return {'level': level, 'check': check, 'name': name, 'message': message}


def iter_nodes(nodes):
    for n in nodes:
        if not isinstance(n, dict):
            continue
        yield n
        children = n.get('children')
        if isinstance(children, list):
            yield from iter_nodes(children)


def load_list(root):
    try:
        tree = json.load(open(os.path.join(root, 'list'), encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        return None, [_f('ERROR', 'en-mirror', '-', 'cannot parse list: %s' % e)]
    top = tree if isinstance(tree, list) else tree.get('children', [])
    return [n for n in iter_nodes(top) if 'name' in n], []


def walk_files(base_dir):
    out = set()
    if not os.path.isdir(base_dir):
        return out
    for dirpath, _dirnames, filenames in os.walk(base_dir):
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), base_dir).replace(os.sep, '/')
            out.add(rel)
    return out


def load_cluster_labels(root):
    """Import tools/build_index.py (it has an __main__ guard, so this is
    side-effect-free) and read CLUSTER_LABELS_BY_LANG off it."""
    path = os.path.join(root, 'tools', 'build_index.py')
    spec = importlib.util.spec_from_file_location('build_index_for_validate', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, 'CLUSTER_LABELS_BY_LANG', {})


def galaxy_labels(cluster_labels, lang, galaxy):
    return {label for section, label in cluster_labels.get(lang, [])
            if section.split(' · ')[0] == galaxy}


# --- string-aware brace matcher, used for extracting the STRINGS.<lang>
# object literals out of index.html without a JS parser. ---
def extract_balanced(text, open_brace_index):
    depth = 0
    i = open_brace_index
    in_str = None
    n = len(text)
    while i < n:
        c = text[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == in_str:
                in_str = None
        else:
            if c in ('"', "'"):
                in_str = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return text[open_brace_index:i + 1]
        i += 1
    return None


def extract_strings_keys(index_html_text):
    """Return {lang: set(keys)} parsed from `var STRINGS = {...}`, or None if
    the shape can't be located (best-effort, per the contract)."""
    m = re.search(r'var\s+STRINGS\s*=\s*\{', index_html_text)
    if not m:
        return None
    block = extract_balanced(index_html_text, m.end() - 1)
    if block is None:
        return None
    result = {}
    for lang_m in re.finditer(r'[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{', block):
        lang = lang_m.group(1)
        sub = extract_balanced(block, lang_m.end() - 1)
        if sub is None:
            continue
        keys = set(re.findall(r'[{,]\s*([A-Za-z_][A-Za-z0-9_]*)\s*:', sub))
        result[lang] = keys
    return result or None


def run(root):
    findings = []
    docs, load_findings = load_list(root)
    findings.extend(load_findings)
    if docs is None:
        return findings

    ko_files = walk_files(os.path.join(root, 'docs', 'ko'))
    # 번역 언어는 docs/ 아래 실제 폴더에서 읽는다 — 언어를 하나 늘릴 때
    # 이 파일을 고치지 않아도 같은 검사가 그대로 적용되게.
    tr_langs = sorted(d for d in os.listdir(os.path.join(root, 'docs'))
                      if d != 'ko' and os.path.isdir(os.path.join(root, 'docs', d)))
    lang_files = {l: walk_files(os.path.join(root, 'docs', l)) for l in tr_langs}
    doc_by_name = {n['name']: n for n in docs}
    path_by_name = {n['name']: n.get('path', n['name']) for n in docs}

    # 1. en-mirror: every docs/en file must sit at a docs/ko-relative path
    # that actually exists on disk.
    for lang in tr_langs:
        for rel in sorted(lang_files[lang]):
            if rel not in ko_files:
                findings.append(_f('ERROR', '%s-mirror' % lang, rel,
                                    "docs/%s/%s has no docs/ko/%s twin" % (lang, rel, rel)))

    # 2 & 3: label_en <-> en body presence.
    # 2026-07-26 승격: 인덱스 문서 전체(115편)의 영어 본문이 갖춰졌으므로
    # label-without-en-body를 INFO -> ERROR로 올린다 — 라벨만 영어로 달고
    # 본문을 빼면 영어 사용자에게 "영어인 척하는 한국어 문서"가 되기 때문.
    # 워크로그(work-log/)는 영어 병행 대상이 아니라 라벨만 영어이고 본문은
    # ko로 폴백하는 것이 정상이므로 이 게이트에서 제외한다(i18n.md 정책).
    for lang in tr_langs:
        for n in docs:
            rel = n.get('path', n['name'])
            has_body = rel in lang_files[lang]
            has_label = ('label_%s' % lang) in n
            if has_body and not has_label:
                findings.append(_f('WARN', '%s-body-without-label' % lang, n['name'],
                                    "docs/%s/%s exists but list node has no label_%s"
                                    % (lang, rel, lang)))
            if has_label and not has_body and not rel.startswith('work-log/'):
                findings.append(_f('ERROR', 'label-without-%s-body' % lang, n['name'],
                                    "list node has label_%s but docs/%s/%s is missing "
                                    "(번역 라벨만 달고 본문을 빼면 그 언어인 척하는 "
                                    "한국어 문서가 된다 — tools/i18n.md)" % (lang, lang, rel)))

    # 4. <lang>-entry-orphan: doc-entries.<lang>.json entries must reference a
    # real ko entry name that also has a body in that language.
    ko_entries_path = os.path.join(root, 'tools', 'doc-entries.ko.json')
    try:
        ko_entry_names = {e['name'] for e in json.load(open(ko_entries_path, encoding='utf-8'))}
    except (OSError, json.JSONDecodeError) as e:
        ko_entry_names = None
        findings.append(_f('ERROR', 'entry-orphan', '-',
                            'cannot parse tools/doc-entries.ko.json: %s' % e))
    if ko_entry_names is not None:
        for lang in tr_langs:
            check = '%s-entry-orphan' % lang
            path = os.path.join(root, 'tools', 'doc-entries.%s.json' % lang)
            if not os.path.isfile(path):
                continue   # 아직 오버레이가 없는 언어 — 전부 ko 폴백이라 정상
            try:
                entries = json.load(open(path, encoding='utf-8'))
            except (OSError, json.JSONDecodeError) as e:
                entries = []
                findings.append(_f('ERROR', check, '-',
                                    'cannot parse tools/doc-entries.%s.json: %s' % (lang, e)))
            for e in entries:
                name = e.get('name', '-')
                if name not in ko_entry_names:
                    findings.append(_f('WARN', check, name,
                                        'doc-entries.%s.json entry has no ko counterpart' % lang))
                    continue
                rel = path_by_name.get(name)
                if rel is None or rel not in lang_files[lang]:
                    findings.append(_f('WARN', check, name,
                                        'doc-entries.%s.json entry has no %s body file'
                                        % (lang, lang)))

    # 5. data-topics: map docs' data-topics keys vs. that language's cluster
    # labels for the relevant galaxy.
    try:
        cluster_labels = load_cluster_labels(root)
    except Exception as e:
        cluster_labels = None
        findings.append(_f('ERROR', 'data-topics', '-',
                            'cannot load CLUSTER_LABELS_BY_LANG from build_index.py: %s' % e))

    if cluster_labels is not None:
        topics_re = re.compile(r'data-topics=\'(\{.*?\})\'', re.DOTALL)

        def check_map_doc(lang, rel, doc_label, expected_labels):
            path = os.path.join(root, 'docs', lang, rel)
            if not os.path.isfile(path):
                return  # missing-file is validate_routes' job
            text = open(path, encoding='utf-8').read()
            m = topics_re.search(text)
            if not m:
                findings.append(_f('ERROR', 'data-topics', doc_label,
                                    'no data-topics attribute found'))
                return
            try:
                topics = json.loads(m.group(1))
            except json.JSONDecodeError as e:
                findings.append(_f('ERROR', 'data-topics', doc_label,
                                    'data-topics is not valid JSON: %s' % e))
                return
            keys = set(topics.keys())
            for k in keys - expected_labels:
                findings.append(_f('ERROR', 'data-topics', doc_label,
                                    "data-topics key '%s' is not a known cluster label" % k))
            for k in expected_labels - keys:
                findings.append(_f('WARN', 'data-topics', doc_label,
                                    "cluster label '%s' missing from data-topics" % k))

        check_map_doc('ko', 'ai/map/ai-map', 'ai-map(ko)', galaxy_labels(cluster_labels, 'ko', 'AI'))
        for lang in tr_langs:
            if 'ai/map/ai-map' in lang_files.get(lang, {}):
                check_map_doc(lang, 'ai/map/ai-map', 'ai-map(%s)' % lang,
                              galaxy_labels(cluster_labels, lang, 'AI'))
        # dz-map은 한국어 문서 하나에 각 언어의 클러스터 라벨을 검색 키로 함께
        # 담는다. 그 언어의 Douzone 문서가 아직 없는데 키만 넣으면 검색에는
        # 잡히나 갈 곳이 없으므로, **그 언어에 실제 본문이 있는 갤럭시만** 센다.
        dz_expected = galaxy_labels(cluster_labels, 'ko', 'Douzone')
        for lang in tr_langs:
            if any(r.startswith('douzone/') for r in lang_files.get(lang, {})):
                dz_expected |= galaxy_labels(cluster_labels, lang, 'Douzone')
        check_map_doc('ko', 'douzone/map/dz-map', 'dz-map', dz_expected)

    # 6. strings-parity: STRINGS.ko vs 각 번역 언어의 키 집합.
    # STRINGS lives in i18n.js since the module split; fall back to index.html
    # so the check works across both layouts (older trees / future moves).
    index_text = None
    _read_err = None
    for _cand in ('i18n.js', 'index.html'):
        try:
            _t = open(os.path.join(root, _cand), encoding='utf-8').read()
        except OSError as e:
            _read_err = e
            continue
        if 'STRINGS' in _t:
            index_text = _t
            break
    if index_text is None:
        findings.append(_f('ERROR', 'strings-parity', '-',
                            'cannot read STRINGS source (i18n.js/index.html): %s' % _read_err))

    if index_text is not None:
        parsed = extract_strings_keys(index_text)
        if not parsed or 'ko' not in parsed:
            # A parse failure must fail loudly: silently skipping would turn
            # every future STRINGS refactor into an unchecked i18n blind spot.
            findings.append(_f('ERROR', 'strings-parity', '-',
                                "STRINGS.ko 파싱 실패 — i18n.js의 'var STRINGS = {' 구조가 바뀌었으면 extract_strings_keys를 함께 갱신할 것"))
        else:
            ko_keys = parsed['ko']
            for lang in sorted(k for k in parsed if k != 'ko'):
                keys = parsed[lang]
                for k in sorted(keys - ko_keys):
                    findings.append(_f('WARN', 'strings-parity', k,
                                        'STRINGS.%s has key not present in STRINGS.ko' % lang))
                for k in sorted(ko_keys - keys):
                    findings.append(_f('INFO', 'strings-parity', k,
                                        'STRINGS.ko has key not present in STRINGS.%s (falls back to ko)' % lang))

    return findings


LEVEL_ORDER = {'ERROR': 0, 'WARN': 1, 'INFO': 2}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser.add_argument('--repo', default=default_repo)
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding='utf-8')
    findings = run(args.repo)
    findings.sort(key=lambda f: (LEVEL_ORDER.get(f['level'], 9), f['check'], f['name']))
    for f in findings:
        print('[%s] %s | %s | %s' % (f['level'], f['check'], f['name'], f['message']))

    counts = {'ERROR': 0, 'WARN': 0, 'INFO': 0}
    for f in findings:
        counts[f['level']] = counts.get(f['level'], 0) + 1
    print('validate_i18n: %d errors, %d warnings, %d infos'
          % (counts['ERROR'], counts['WARN'], counts['INFO']))
    return 1 if counts['ERROR'] else 0


if __name__ == '__main__':
    sys.exit(main())
