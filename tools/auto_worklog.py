#!/usr/bin/env python3
"""Append a Work Log entry for a commit merged to master (run by GitHub Actions).

Called by .github/workflows/auto-worklog.yml on every push to master.
Reads the commit from env (COMMIT_SHA / COMMIT_MSG / COMMIT_TIME), converts the
time to KST (the Work Log date rule), and records it in the daily auto-log doc
`docs/ko/work-log/YYYY/MM/DD/wl-YYYYMMDD-auto` — creating the doc and its
`list` nav node (plus the day/month/year blocks) on the first merge of that day.
The list node carries a "path" field (physical location under docs/<lang>/),
matching the domain-tree layout; `name` stays the logical id / hash route.

The `list` file is hand-formatted JSON, so edits are surgical text insertions
that copy the surrounding indentation; the result is re-parsed with json.loads
before writing — any structural surprise aborts without touching the file.

Idempotent per commit: if the sha is already in the day's doc, exits quietly.
Skips housekeeping commits (Pages redeploy triggers, its own log commits).

Env:  COMMIT_SHA   full sha (required)
      COMMIT_MSG   commit message; only the first line is recorded (required)
      COMMIT_TIME  ISO-8601 commit timestamp; falls back to now (optional)
Exit: 0 = logged or intentionally skipped, 1 = error (fails the workflow run).
"""
import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'list')
KST = timezone(timedelta(hours=9))
# %B is locale-dependent — title_en must always be the English month name.
MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December']
REPO_URL = 'https://github.com/dewytear/dewytear.github.io'

# Housekeeping commits that would only add noise to the log.
SKIP_PREFIXES = (
    'chore: Pages 재배포',
    'Work Log 자동 기록',
)


def kst_time(iso):
    if iso:
        try:
            dt = datetime.fromisoformat(iso)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(KST)
        except ValueError:
            pass
    return datetime.now(KST)


def update_doc(path, when, subject, sha):
    """Add one <li> to the daily doc; create the doc on the day's first merge.
    Returns False when the sha is already logged."""
    line = ('        <li><code>%s</code> %s (<a href="%s/commit/%s" '
            'target="_blank" rel="noopener">%s</a>)</li>' % (
                when.strftime('%H:%M'), html.escape(subject),
                REPO_URL, sha, sha[:7]))
    if os.path.exists(path):
        text = open(path, encoding='utf-8').read()
        if sha[:7] in text:
            return False
        idx = text.rfind('    </ul>')
        if idx < 0:
            raise RuntimeError('%s: closing </ul> not found' % path)
        text = text[:idx] + line + '\n' + text[idx:]
    else:
        text = (
            '<h2>%s · 자동 머지 로그</h2>\n'
            '<p><code>master</code>에 머지된 커밋을 GitHub Actions가 자동으로 기록한 로그입니다. '
            '시각은 <strong>한국 시간(KST)</strong> 기준이며, 상세 맥락은 같은 날짜의 주제별 Work Log 문서를 참고하세요.</p>\n'
            '\n'
            '<h3>머지 기록</h3>\n'
            '<div class="note">\n'
            '    <ul>\n'
            '%s\n'
            '    </ul>\n'
            '</div>\n' % (when.strftime('%Y-%m-%d'), line))
    open(path, 'w', encoding='utf-8').write(text)
    return True


def find_block(text, needle, start):
    """Position of `needle` after `start`, or -1. Matches the `list` file's
    hand-written spacing exactly (one space after the colon)."""
    return text.find(needle, start)


def children_bounds(text, owner_pos):
    """(open, close, item_indent) of the `"children": [` array that belongs to
    the node whose title/name match sits at owner_pos."""
    op = text.find('"children": [', owner_pos)
    if op < 0:
        raise RuntimeError('children array not found')
    line_start = text.rfind('\n', 0, op) + 1
    indent = op - line_start
    depth, i = 0, text.index('[', op)
    while i < len(text):
        if text[i] == '[':
            depth += 1
        elif text[i] == ']':
            depth -= 1
            if depth == 0:
                return op, i, indent + 4
        i += 1
    raise RuntimeError('unbalanced children array')


def insert_into_array(text, close, item_indent, block):
    """Insert `block` (already indented) as the last element of the array whose
    closing bracket is at `close`."""
    before = text[:close].rstrip()
    empty = before.endswith('[')
    sep = '' if empty else ','
    pad = ' ' * (item_indent - 4)
    return before + sep + '\n' + block + '\n' + pad + text[close:]


def node_block(indent, lines):
    pad = ' ' * indent
    return '\n'.join(pad + l for l in lines)


def update_list(when, doc_name, label, doc_rel):
    """Hang the auto-log node at Work Log > YYYY > MM월 > DD일, creating any
    missing year/month/day blocks. No-op if the node is already there."""
    text = open(LIST, encoding='utf-8').read()
    if '"name": "%s"' % doc_name in text:
        return False

    year, month, day = when.strftime('%Y'), when.strftime('%m'), when.strftime('%d')
    wl = find_block(text, '"title": "Work Log"', 0)
    if wl < 0:
        raise RuntimeError('Work Log branch not found in list')
    _, wl_close, wl_indent = children_bounds(text, wl)

    doc_line = ['{ "name": "%s", "path": "%s/%s", "label": "%s", "tags": [] }'
                % (doc_name, doc_rel, doc_name, label)]
    day_lines = ['{',
                 '    "title": "%s일", "title_en": "Day %s",' % (day, day),
                 '    "children": ['] + \
                ['        ' + doc_line[0]] + \
                ['    ]',
                 '}']
    month_lines = ['{',
                   '    "title": "%s월", "title_en": "%s",' % (month, MONTH_EN[when.month - 1]),
                   '    "children": ['] + \
                  ['        ' + l for l in day_lines] + \
                  ['    ]',
                   '}']
    year_lines = ['{',
                  '    "title": "%s",' % year,
                  '    "children": ['] + \
                 ['        ' + l for l in month_lines] + \
                 ['    ]',
                  '}']

    yr = find_block(text, '"title": "%s"' % year, wl)
    if yr < 0 or yr > wl_close:
        text = insert_into_array(text, wl_close, wl_indent,
                                 node_block(wl_indent, year_lines))
    else:
        _, yr_close, yr_indent = children_bounds(text, yr)
        mo = find_block(text, '"title": "%s월"' % month, yr)
        if mo < 0 or mo > yr_close:
            text = insert_into_array(text, yr_close, yr_indent,
                                     node_block(yr_indent, month_lines))
        else:
            _, mo_close, mo_indent = children_bounds(text, mo)
            dy = find_block(text, '"title": "%s일"' % day, mo)
            if dy < 0 or dy > mo_close:
                text = insert_into_array(text, mo_close, mo_indent,
                                         node_block(mo_indent, day_lines))
            else:
                _, dy_close, dy_indent = children_bounds(text, dy)
                text = insert_into_array(text, dy_close, dy_indent,
                                         ' ' * dy_indent + doc_line[0])

    # Any structural mistake must fail loudly BEFORE the file is replaced.
    json.loads(text)
    open(LIST, 'w', encoding='utf-8').write(text)
    return True


def main():
    sha = os.environ.get('COMMIT_SHA', '').strip()
    msg = os.environ.get('COMMIT_MSG', '').strip()
    if not sha or not msg:
        print('COMMIT_SHA / COMMIT_MSG required', file=sys.stderr)
        return 1
    subject = msg.splitlines()[0].strip()
    if any(subject.startswith(p) for p in SKIP_PREFIXES):
        print('skip (housekeeping): %s' % subject)
        return 0

    when = kst_time(os.environ.get('COMMIT_TIME', ''))
    doc_name = 'wl-%s-auto' % when.strftime('%Y%m%d')
    # Physical home in the domain tree: work-log/YYYY/MM/DD/ (the list node's
    # "path"). The hash route stays #!wl-YYYYMMDD-auto — name is the id.
    doc_rel = 'work-log/%s/%s/%s' % (
        when.strftime('%Y'), when.strftime('%m'), when.strftime('%d'))
    doc_path = os.path.join(ROOT, 'docs', 'ko', *doc_rel.split('/'), doc_name)
    os.makedirs(os.path.dirname(doc_path), exist_ok=True)

    if not update_doc(doc_path, when, subject, sha):
        print('skip (already logged): %s' % sha[:7])
        return 0
    update_list(when, doc_name, '자동 머지 로그', doc_rel)
    print('logged %s -> %s' % (sha[:7], doc_name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
