"""Register legacy per-user clones (clones/<app>/user_<id>) as workspaces (user-<id>).

Dry run by default; pass --apply to rename the directories and write the registry.
Legacy clones keep their own history and become root variants (no parent), because
they were copied from the source app before the public workspace existed.

Usage: python3 orchestrator/migrate_workspaces.py [--apply] [app_id ...]
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n
import registry


def main(argv):
    apply = '--apply' in argv
    wanted = [arg for arg in argv if not arg.startswith('--')]
    engine = Path(__file__).resolve().parents[1]
    config = json.loads((engine / 'config/apps.json').read_text())
    # The output here is English like the CLI; only the display name shown in the panel follows the language.
    lang = i18n.language(config)
    for app_id, app in config['apps'].items():
        if wanted and app_id not in wanted:
            continue
        clone_dir = Path(app['clone_dir'])
        print(f'App {app_id}: {clone_dir}')
        if not clone_dir.is_dir():
            print('  no clones found')
            continue
        data = registry.read(app)
        for legacy in sorted(clone_dir.glob('user_*')):
            match = re.fullmatch(r'user_(\d+)', legacy.name)
            if not match or not (legacy / '.git').is_dir():
                continue
            slug = 'user-' + match.group(1)
            target = clone_dir / slug
            dirty = subprocess.run(['git', '-c', 'safe.directory=' + str(legacy), '-C', str(legacy), 'status', '--porcelain'],
                                   capture_output=True, text=True).stdout.strip()
            note = ' (has uncommitted changes: please review them before the next job)' if dirty else ''
            if target.exists():
                print(f'  {legacy.name}: target {slug} already exists, skipped')
                continue
            print(f'  {legacy.name} -> {slug}{note}')
            if apply:
                legacy.rename(target)
                data['workspaces'][slug] = dict(slug=slug, name=i18n.t('Variant of user {user}', lang, user=match.group(1)), parent=None,
                                                fork_commit=None, source='legacy', created_by='',
                                                created_at=datetime.now(timezone.utc).isoformat())
        for slug in sorted(p.name for p in clone_dir.iterdir() if (p / '.git').is_dir() and re.fullmatch(registry.SLUG, p.name)):
            if slug not in data['workspaces']:
                print(f'  {slug}: directory without a registry entry, registering it')
                if apply:
                    data['workspaces'][slug] = dict(slug=slug, name=slug, parent=None, fork_commit=None, source='legacy',
                                                    created_by='', created_at=datetime.now(timezone.utc).isoformat())
        if apply:
            registry.write(app, data)
            print(f'  Registry written: {registry.path(app)}')
    if not apply:
        print('\nDry run. Run again with --apply to make these changes.')


if __name__ == '__main__':
    main(sys.argv[1:])
