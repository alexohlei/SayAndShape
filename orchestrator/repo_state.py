"""Versioned baseline/archive metadata in a separate Git ref, outside app files."""
import json
from pathlib import Path
import re
import subprocess
import i18n

REF = 'refs/sayandshape/state'
# Names from before the project was renamed (ReShapeAI, earlier PersonaEngine). Existing clones keep
# their baseline and archives there; they are only read, and the next publication writes REF.
LEGACY_REFS = ('refs/reshape/state', 'refs/persona/state')


def git(repo, *args, input=None):
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(repo), '-C', str(repo), *args],
                            input=input, capture_output=True, check=True)
    return result.stdout.decode('utf-8', errors='replace').strip()


def _resolve(repo, ref):
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(repo), '-C', str(repo),
                             'rev-parse', '--verify', '--quiet', ref], capture_output=True)
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        raise RuntimeError('Baseline metadata not readable')
    return result.stdout.decode().strip()


def state_ref(repo):
    for ref in (REF, *LEGACY_REFS):
        commit = _resolve(repo, ref)
        if commit:
            return commit
    return None


def read(repo):
    ref = state_ref(repo)
    if ref:
        state = json.loads(git(repo, 'show', ref + ':state.json'))
        if state.get('version') != 1 or not isinstance(state.get('archives'), list):
            raise ValueError('Invalid baseline metadata')
    else:
        root = git(repo, 'rev-list', '--max-parents=0', 'HEAD').splitlines()[-1]
        state = dict(version=1, base=root, archives=[])
    if not re.fullmatch(r'[0-9a-f]{40,64}', state.get('base', '')):
        raise ValueError('Invalid baseline')
    git(repo, 'merge-base', '--is-ancestor', state['base'], 'HEAD')
    return state


def commits_since(repo, base, head, limit=None):
    args = ['log', '-z', '--format=%H%x00%P%x00%B%x00%aI%x00%an']
    if limit is not None:
        args.append(f'-{limit}')
    # Don't strip the NUL-delimited record fields.
    fields = git(repo, *args, base + '..' + head).split('\0')
    result = []
    for index in range(0, len(fields) - 4, 5):
        sha, parents, message, date, author = fields[index:index + 5]
        result.append(dict(hash=sha, parents=parents.split(), message=message.strip(), date=date, author=author))
    return result


def establish(repo, identifier, created_at, lang='en'):
    """Called only on a disposable workspace. Keep every archived commit reachable."""
    state = read(repo)
    head = git(repo, 'rev-parse', 'HEAD')
    commits = commits_since(repo, state['base'], head)
    if not commits:
        raise ValueError('No new changes to set as the baseline')
    archive = dict(id=identifier, created_at=created_at, base=head, previous_base=state['base'],
                   commits=[{key: c[key] for key in ('hash', 'message', 'date', 'author')} for c in commits])
    updated = dict(version=1, base=head, archives=[archive, *state['archives']])
    blob = git(repo, 'hash-object', '-w', '--stdin', input=json.dumps(updated, ensure_ascii=False).encode())
    tree = git(repo, 'mktree', input=f'100644 blob {blob}\tstate.json\n'.encode())
    args = ['commit-tree', tree, '-p', head]
    previous = state_ref(repo)
    if previous:
        args += ['-p', previous]
    # Only a log message on the metadata ref, in the interface language; nothing parses it (only state.json is read),
    # so the German form of older installations ("SayAndShape: neue Basis …") needs no handling.
    commit = git(repo, *args, '-m', i18n.t('SayAndShape: new baseline {created_at}', lang, created_at=created_at))
    git(repo, 'update-ref', REF, commit)
    return archive


def initialize(repo, base, lang='en'):
    """Fresh metadata for a forked workspace: its baseline is the fork commit, no archives."""
    if state_ref(repo):
        raise ValueError('Baseline metadata already exists')
    if not re.fullmatch(r'[0-9a-f]{40,64}', base):
        raise ValueError('Invalid baseline')
    git(repo, 'merge-base', '--is-ancestor', base, 'HEAD')
    state = dict(version=1, base=base, archives=[])
    blob = git(repo, 'hash-object', '-w', '--stdin', input=json.dumps(state, ensure_ascii=False).encode())
    tree = git(repo, 'mktree', input=f'100644 blob {blob}\tstate.json\n'.encode())
    # Log message only, in the interface language, never parsed (German: "SayAndShape: Abzweigung").
    commit = git(repo, 'commit-tree', tree, '-p', base, '-m', i18n.t('SayAndShape: fork', lang))
    git(repo, 'update-ref', REF, commit)
    return state


def restore_ref(repo, previous):
    if previous:
        git(repo, 'update-ref', REF, previous)
    elif state_ref(repo):
        git(repo, 'update-ref', '-d', REF)


if __name__ == '__main__':
    import sys
    try:
        print(read(Path(sys.argv[1]))['base'])
    except (ValueError, OSError, subprocess.SubprocessError, RuntimeError) as exc:
        print('Baseline not readable: ' + str(exc), file=sys.stderr)
        sys.exit(1)
