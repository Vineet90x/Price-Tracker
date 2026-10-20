"""Re-point doc line links after code changed, using git to see what each link USED to point at.

For every link like [file.ts:L40-L46](path#L40-L46) into a file that changed since <ref> (default HEAD):
  1. read the old version of the file from git and take the text at the old start/end lines,
  2. find the same text in the current file (nearest match to the old position),
  3. rewrite the link to the new line numbers.
Links whose old text no longer exists are listed as NEEDS REVIEW and left unchanged.

    python tools/remap_doc_links.py            # dry run: show what would change
    python tools/remap_doc_links.py --write    # apply
"""
import glob
import io
import os
import re
import subprocess
import sys

REF = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--ref=')), 'HEAD')
WRITE = '--write' in sys.argv
DOCS = ['AGENTS.md', 'README.md', *glob.glob('docs/*.md'), *glob.glob('docs/learning/*.md')]
LINK = re.compile(r'\[([^\]]*)\]\(([^)#\s]+)#L(\d+)(?:-L(\d+))?\)')

changed = set(subprocess.run(['git', 'diff', '--name-only', REF], capture_output=True, text=True).stdout.split())
_old, _new = {}, {}


def old_lines(path):
    if path not in _old:
        out = subprocess.run(['git', 'show', f'{REF}:{path}'], capture_output=True, text=True, encoding='utf-8')
        _old[path] = out.stdout.split('\n') if out.returncode == 0 else None
    return _old[path]


def new_lines(path):
    if path not in _new:
        _new[path] = io.open(path, encoding='utf-8').read().split('\n')
    return _new[path]


def relocate(path, line):
    old, new = old_lines(path), new_lines(path)
    if old is None or line > len(old):
        return None
    text = old[line - 1].strip()
    if not text:  # blank line: use the next non-blank line as the anchor, then step back
        for offset in range(1, 6):
            if line - 1 + offset < len(old) and old[line - 1 + offset].strip():
                found = relocate(path, line + offset)
                return found - offset if found else None
        return None
    hits = [i + 1 for i, l in enumerate(new) if l.strip() == text]
    if not hits:
        return None
    return min(hits, key=lambda h: abs(h - line))


tracked = set(subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split())

review, moved = [], 0
for doc in DOCS:
    if doc.replace('\\', '/') not in tracked:
        continue  # a brand-new doc was written against the current code already
    base = os.path.dirname(doc)
    content = io.open(doc, encoding='utf-8').read()

    def fix(m):
        global moved
        label, target, a, b = m.group(1), m.group(2), int(m.group(3)), m.group(4)
        path = os.path.relpath(os.path.normpath(os.path.join(base, target))).replace('\\', '/')
        if path not in changed:
            return m.group(0)
        na = relocate(path, a)
        nb = relocate(path, int(b)) if b else na
        if na is None or nb is None or nb < na:
            review.append(f'{doc}: {label} → {target}#L{a}{"-L" + b if b else ""}')
            return m.group(0)
        old_r = f'L{a}' + (f'-L{b}' if b else '')
        new_r = f'L{na}' + (f'-L{nb}' if b and nb != na else '')
        if new_r == old_r:
            return m.group(0)
        moved += 1
        print(f'{doc}: {target} {old_r} → {new_r}')
        return f'[{label.replace(old_r, new_r)}]({target}#{new_r})'

    updated = LINK.sub(fix, content)
    if WRITE and updated != content:
        io.open(doc, 'w', encoding='utf-8', newline='\n').write(updated)

print(f'\n{moved} links {"moved" if WRITE else "would move"}; {len(review)} need review')
for r in review:
    print('NEEDS REVIEW', r)
