"""Checks every relative link in the project's Markdown docs: the file must exist and any #Lx-Ly line range
must be inside the file. Run after changing code:  python tools/check_doc_links.py
It can't tell whether a range still points at the *right* code. When a file changes, re-read the links into it."""
import glob
import io
import os
import re
import sys

LINK = re.compile(r'\]\(([^)#\s]+)(?:#L(\d+)(?:-L(\d+))?)?\)')
DOCS = ['AGENTS.md', 'README.md', 'frontend/README.md', *sorted(glob.glob('docs/*.md')),
        *sorted(glob.glob('docs/learning/*.md'))]

problems = checked = 0
for doc in DOCS:
    if not os.path.exists(doc):
        continue
    base = os.path.dirname(doc)
    for m in LINK.finditer(io.open(doc, encoding='utf-8').read()):
        target, start, end = m.groups()
        if target.startswith(('http://', 'https://', 'mailto:')):
            continue
        checked += 1
        path = os.path.normpath(os.path.join(base, target))
        if not os.path.exists(path):
            print(f'{doc}: missing file {target}')
            problems += 1
        elif start and os.path.isfile(path):
            length = len(io.open(path, encoding='utf-8').read().split('\n'))
            if int(end or start) > length or (end and int(end) < int(start)):
                print(f'{doc}: {target}#L{start}{"-L" + end if end else ""} is outside the file ({length} lines)')
                problems += 1

print(f'{checked} links checked, {problems} problems')
sys.exit(1 if problems else 0)
