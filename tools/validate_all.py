"""Aggregate the tools/validate_*.py checks into one report.

Each sibling module (validate_docs, validate_routes, validate_i18n,
validate_graph) exposes run(root) -> list[dict] findings. This script does
not duplicate their logic — it loads whichever ones exist, runs them, and
prints a combined report. Missing modules degrade to a WARN, not a crash.
"""
import argparse
import importlib.util
import json
import os
import sys

MODULE_NAMES = ['validate_docs', 'validate_routes', 'validate_i18n', 'validate_graph']

_LEVEL_ORDER = {'ERROR': 0, 'WARN': 1, 'INFO': 2}


def _sort_key(f):
    return (_LEVEL_ORDER.get(f['level'], 3), f['check'], f['name'])


def _load_module(root, name):
    path = os.path.join(root, 'tools', f'{name}.py')
    if not os.path.isfile(path):
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_all(root):
    """Returns (per_module_findings: dict[str, list[dict]], missing: list[str])."""
    per_module = {}
    missing = []
    for name in MODULE_NAMES:
        try:
            mod = _load_module(root, name)
        except Exception as e:
            per_module[name] = [{
                'level': 'ERROR', 'check': 'validator-crash', 'name': '-',
                'message': f'{name} 로드 실패: {e}',
            }]
            continue
        if mod is None:
            missing.append(name)
            continue
        try:
            per_module[name] = mod.run(root)
        except Exception as e:
            per_module[name] = [{
                'level': 'ERROR', 'check': 'validator-crash', 'name': '-',
                'message': f'{name}.run() 예외: {e}',
            }]
    return per_module, missing


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

    default_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser = argparse.ArgumentParser(description='Run all tools/validate_*.py checks.')
    parser.add_argument('--repo', default=default_root)
    parser.add_argument('--json', action='store_true', help='Dump all findings as a JSON array instead of text.')
    args = parser.parse_args()

    per_module, missing = run_all(args.repo)

    if args.json:
        all_findings = []
        for name, findings in per_module.items():
            for f in findings:
                all_findings.append({'module': name, **f})
        for name in missing:
            all_findings.append({'module': name, 'level': 'WARN', 'check': 'validate-all',
                                  'name': '-', 'message': f'{name} not found'})
        print(json.dumps(all_findings, ensure_ascii=False, indent=2))
        total_errors = sum(1 for f in all_findings if f['level'] == 'ERROR')
        sys.exit(1 if total_errors else 0)

    summary_rows = []
    total = {'ERROR': 0, 'WARN': 0, 'INFO': 0}

    for name in MODULE_NAMES:
        print(f"== {name} ==")
        if name in missing:
            print(f"[WARN] validate-all | - | {name} not found")
            summary_rows.append((name, 0, 1, 0))
            total['WARN'] += 1
            continue
        findings = sorted(per_module.get(name, []), key=_sort_key)
        counts = {'ERROR': 0, 'WARN': 0, 'INFO': 0}
        for f in findings:
            print(f"[{f['level']}] {f['check']} | {f['name']} | {f['message']}")
            counts[f['level']] = counts.get(f['level'], 0) + 1
            total[f['level']] = total.get(f['level'], 0) + 1
        summary_rows.append((name, counts['ERROR'], counts['WARN'], counts['INFO']))

    print()
    print(f"{'module':<16}{'errors':>8}{'warnings':>10}{'infos':>8}")
    for name, e, w, i in summary_rows:
        print(f"{name:<16}{e:>8}{w:>10}{i:>8}")
    print(f"{'TOTAL':<16}{total['ERROR']:>8}{total['WARN']:>10}{total['INFO']:>8}")

    sys.exit(1 if total['ERROR'] else 0)


if __name__ == '__main__':
    main()
