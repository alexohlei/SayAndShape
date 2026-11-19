"""Workspace registry: one JSON file per app, written only by the worker."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import i18n

SLUG = r'[a-z0-9][a-z0-9-]{0,39}'
RESERVED = {'sayandshape', 'api', 'widget', 'admin', 'u', 'w'}
VERSION = 1


def public_slug(app):
    slug = app.get('public_workspace') or 'main'
    if not re.fullmatch(SLUG, slug):
        raise ValueError('Invalid public variant')
    return slug


def path(app):
    return Path(app['clone_dir']) / 'workspaces.json'


def workspace_dir(app, slug):
    if not re.fullmatch(SLUG, slug):
        raise ValueError('Invalid variant')
    return Path(app['clone_dir']) / slug


def empty():
    return dict(version=VERSION, workspaces={})


def read(app):
    file = path(app)
    if not file.exists():
        return empty()
    data = json.loads(file.read_text())
    if not isinstance(data, dict) or data.get('version') != VERSION or not isinstance(data.get('workspaces'), dict):
        raise ValueError('Invalid variant registry')
    for slug, entry in data['workspaces'].items():
        if not re.fullmatch(SLUG, slug) or not isinstance(entry, dict):
            raise ValueError('Invalid variant registry')
    return data


def write(app, data):
    file = path(app)
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.workspaces-', dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.chmod(tmp, 0o664)
        os.replace(tmp, file)
    finally:
        Path(tmp).unlink(missing_ok=True)


def register(app, slug, name, parent, fork_commit, created_at, created_by=None, source='base'):
    data = read(app)
    data['workspaces'][slug] = dict(slug=slug, name=name, parent=parent, fork_commit=fork_commit,
                                    source=source, created_at=created_at, created_by=created_by or '')
    write(app, data)
    return data['workspaces'][slug]


def slugify(name):
    """Stable, URL-safe slug from a display name (German umlauts transliterated)."""
    text = name.strip().lower()
    for src, dst in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')):
        text = text.replace(src, dst)
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')[:40].strip('-')
    if not text or text in RESERVED or not re.fullmatch(SLUG, text):
        return ''
    return text


def git(repo, *args):
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(repo), '-C', str(repo), *args],
                            capture_output=True, check=True)
    return result.stdout.decode('utf-8', errors='replace').strip()


def is_ancestor(repo, commit, head='HEAD'):
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(repo), '-C', str(repo),
                             'merge-base', '--is-ancestor', commit, head], capture_output=True)
    return result.returncode == 0


def promote_start(repo, entry):
    """Where the next promotion starts: after the last promoted commit, else at the fork point, else at the root.
    A rolled-back promoted commit no longer sits in the history; then the fork point is used again and
    commits the target already has are skipped as empty picks."""
    for candidate in (entry.get('promoted_head'), entry.get('fork_commit')):
        if candidate and is_ancestor(repo, candidate):
            return candidate
    return git(repo, 'rev-list', '--max-parents=0', 'HEAD').splitlines()[-1]


def promote_target(entries, public, slug):
    """The variant a promotion lands in: the parent while it exists, otherwise the public variant."""
    if slug == public:
        return None
    parent = entries.get(slug, {}).get('parent')
    if parent and parent in entries and parent != slug:
        return parent
    return public


def describe(app, limit=20, lang='en'):
    """Registry entries plus Git facts for the panel: head, change count, recent commits. Texts are in `lang`."""
    data = read(app)
    public = public_slug(app)
    entries = dict(data['workspaces'])
    if public not in entries:
        entries = {public: dict(slug=public, name=public, parent=None, fork_commit=None, source='base',
                                created_at='', created_by=''), **entries}
    items = []
    for slug, meta in entries.items():
        item = dict(meta)
        item['slug'] = slug
        item['public'] = slug == public
        repo = workspace_dir(app, slug)
        item['exists'] = (repo / '.git').is_dir()
        item['head'] = None
        item['dirty'] = False
        item['changes_since_fork'] = 0
        item['commits'] = []
        item['last_change'] = None
        item['promote'] = None
        if not item['exists']:
            items.append(item)
            continue
        try:
            head = git(repo, 'rev-parse', 'HEAD')
            item['head'] = head
            item['dirty'] = bool(git(repo, 'status', '--porcelain'))
            fork = meta.get('fork_commit')
            if fork:
                span = fork + '..HEAD'
                count = int(git(repo, 'rev-list', '--count', span))
            else:
                span = 'HEAD'
                count = max(0, int(git(repo, 'rev-list', '--count', 'HEAD')) - 1)
            item['changes_since_fork'] = count
            raw = git(repo, 'log', '-z', f'-{limit}', '--format=%H%x00%an%x00%aI%x00%s', span) if count else ''
            fields = raw.split('\0') if raw else []
            for index in range(0, len(fields) - 3, 4):
                sha, author, date, subject = fields[index:index + 4]
                item['commits'].append(dict(hash=sha, author=author, date=date, message=subject.strip()))
            if item['commits']:
                item['last_change'] = item['commits'][0]
            elif not fork:
                root = git(repo, 'log', '-1', '--format=%H%x00%an%x00%aI%x00%s', 'HEAD').split('\0')
                item['last_change'] = dict(hash=root[0], author=root[1], date=root[2], message=root[3].strip())
            target = promote_target(entries, public, slug)
            if target:
                start = promote_start(repo, meta)
                ahead = int(git(repo, 'rev-list', '--count', f'{start}..HEAD'))
                files = []
                for line in git(repo, 'diff', '--numstat', f'{start}..HEAD').splitlines()[:50]:
                    added, deleted, name = (line.split('\t', 2) + ['', '', ''])[:3]
                    files.append(dict(path=name, added=None if added == '-' else int(added),
                                      deleted=None if deleted == '-' else int(deleted)))
                item['promote'] = dict(target=target, commits=ahead, files=files)
        except (subprocess.SubprocessError, ValueError, IndexError):
            item['error'] = i18n.t('Git state not readable', lang)
        items.append(item)
    return dict(success=True, public=public, workspaces=items)


if __name__ == '__main__':
    import sys
    lang = 'en'
    try:
        command, config, app_id = sys.argv[1:4]
        config = json.loads(Path(config).read_text())
        lang = i18n.language(config)
        apps = config['apps']
        if not re.fullmatch(r'[a-z0-9_-]+', app_id) or app_id not in apps:
            raise ValueError('Unknown app')
        if command != 'list':
            raise ValueError('Unknown command')
        print(json.dumps(describe(apps[app_id], lang=lang), ensure_ascii=False))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        message = i18n.t('Variants not readable: {error}', lang, error=i18n.message(exc, lang))
        print(json.dumps(dict(success=False, message=message), ensure_ascii=False))
        sys.exit(1)
