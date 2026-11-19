"""Review all prospective changes against a fixed job baseline."""
import fnmatch
import json
import os
from pathlib import Path
import re
import subprocess
import sys

class Blocked(Exception):
    pass

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)

def review(root, maximum=20, blocked_files=(), baseline='HEAD'):
    root = Path(root)
    new = set(git(root, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0')) - {b''}
    names = set(git(root, 'diff', '--name-only', '-z', baseline, '--').split(b'\0'))
    names.update(git(root, 'diff', '--cached', '--name-only', '-z', baseline, '--').split(b'\0'))
    names.update(new)
    names.discard(b'')
    if len(names) > maximum:
        raise Blocked(f'too many files ({len(names)} > {maximum})')
    sensitive = re.compile(r'(^|/)(\.env(?:\..*)?|config\.php|\.htpasswd|id_rsa)$|\.pem$', re.I)
    dangerous = re.compile(rb'\b(?:system|passthru|proc_open)\s*\(|rm\s+-rf\b|\b(?:DROP|TRUNCATE)\s+TABLE\b', re.I)
    changed = []
    for raw in sorted(names):
        name = os.fsdecode(raw)
        path = root / name
        if '..' in Path(name).parts or Path(name).is_absolute():
            raise Blocked('invalid path')
        if sensitive.search(name) or any(fnmatch.fnmatchcase(name, pat) for pat in blocked_files):
            raise Blocked(f'sensitive file modified: {name}')
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise Blocked(f'symlink not allowed: {name}')
        if path.exists() and not path.is_file():
            raise Blocked(f'unsupported file: {name}')
        diff = git(root, 'diff', '--no-ext-diff', '--no-textconv', '--text', '--unified=0', baseline, '--', name)
        added = b'\n'.join(line[1:] for line in diff.splitlines() if line.startswith(b'+') and not line.startswith(b'+++'))
        if raw in new:
            added = path.read_bytes()
        if dangerous.search(added):
            raise Blocked(f'dangerous pattern in file: {name}')
        changed.append(name)
    return changed

if __name__ == '__main__':
    try:
        config = Path(os.environ.get('SAYANDSHAPE_CONFIG', Path(__file__).resolve().parents[2] / 'config/apps.json'))
        app = os.environ.get('APP_ID', '')
        extra = json.loads(config.read_text())['apps'][app].get('extra_blocked_files', []) if app else []
        files = review(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 20, extra,
                       sys.argv[3] if len(sys.argv) > 3 else 'HEAD')
        print('PASS' if files else 'NO_CHANGES')
    except (Blocked, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(f'BLOCKED: {exc}')
        sys.exit(1)
